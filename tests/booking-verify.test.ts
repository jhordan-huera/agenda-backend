// Reserva «Por verificar» (spec 009): con la cédula de un paciente y un email y un teléfono que no
// coinciden, la reserva sale igual que con una cédula nueva (nadie de fuera nota la diferencia) y queda
// en un paciente aparte que no da acceso a la ficha. El negocio la une a la ficha o cancela la cita.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, login, sql } from "./helpers/harness.ts";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PublicBusinessProfile } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { pool, transaction } = await import("../src/db/pool.ts");
const { findOnlineBookings, onlineBookingNotice } = await import("../src/services/booking-alerts.ts");
const { runReminderJob } = await import("../src/services/notifications.ts");

const ricardo = await login("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa
const elena = await login("elena@demo.com"); // Recepción
const valeria = await login("valeria@demo.com"); // rol Profesional
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const business = (await ricardo("GET", B)).body;
const tagEarly = Date.now().toString(36);
sql(
  `update businesses set professional_scope = 'own', email = 'clinica.${tagEarly}@correo.ec',
          notification_settings = notification_settings || '{"confirmations": true, "cancellations": true, "reminders": true, "reminderHoursBefore": 24}'
    where id = '${businessId}'`,
);
await ricardo("PATCH", B, { bookingSettings: { ...business.bookingSettings, chooseProfessional: true, maxClientBookingsPerDay: 1, minNoticeHours: 0 } });
const agendas = (await ricardo("GET", `${B}/professionals`)).body as { id: string; displayName: string }[];
const valeriaAgenda = agendas.find((p) => p.displayName === "Dra. Valeria Cruz")!;
sql(`update professionals set all_services = true where id = '${valeriaAgenda.id}'`);
const slug: string = business.slug;
const visitor = agent();
const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${slug}`)).body;
const service = profile.services.find((s) => s.modes.includes("business") && s.peoplePerSession === 1)!;

const tag = Date.now().toString(36);
let seed = 300;
const person = (name: string) => {
  seed++;
  return { documentId: cedulaFor(`${tag}-${seed}`), name, email: `${name.split(" ")[0].toLowerCase()}.${seed}.${tag}@correo.ec`, phone: `+593 98 ${seed} 4567` };
};
type Person = ReturnType<typeof person>;
const used = new Set<string>();
/** Una hora libre de la agenda de Valeria, de pasado mañana en adelante, una por día (una cita por persona al día). */
async function freeSlot(): Promise<{ date: string; startTime: string }> {
  const current: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
  const now = getZonedNow(current.business.timezone);
  const context = scopeToProfessional({ ...current, settings: current.business.bookingSettings, now }, valeriaAgenda.id);
  for (let d = 2; d < 120; d++) {
    const date = addDaysISO(now.date, d);
    if (used.has(date)) continue;
    const [startTime] = getAvailableSlots(date, service.durationMinutes, context);
    if (startTime) {
      used.add(date);
      return { date, startTime };
    }
  }
  throw new Error("No hay horas libres");
}
const book = (slot: { date: string; startTime: string }, who: Person) =>
  visitor("POST", `/public/businesses/${slug}/bookings`, { serviceId: service.id, ...slot, professionalId: valeriaAgenda.id, notes: "", ...who, extraPatients: [] });
/** Los emails de una cita, con el correo del paciente que reservó como «PACIENTE». */
const emailsOf = (appointmentId: string, typed: string) =>
  sql(`select type || '|' || to_email from notifications where appointment_id = '${appointmentId}' order by type, to_email`)
    .split("\n")
    .filter(Boolean)
    .map((row) => row.replace(typed, "PACIENTE"));
const shape = (body: Record<string, unknown>) => ({
  keys: Object.keys(body).sort().join(","),
  emailSent: body.emailSent,
  hasPayment: body.payment !== null,
  paymentByEmail: body.paymentByEmail,
});

// Una paciente de la clínica, registrada por el propietario (no es de la agenda de Valeria).
const real = person("Rosa Real");
const realId: string = (await ricardo("POST", `${B}/clients`, { ...real, address: "", notes: "", isActive: true })).body.id;

console.log("Nadie de fuera nota la diferencia");
const claimer = { ...person("Otra Persona"), documentId: real.documentId };
const newcomer = person("Nueva Persona");
const slotA = await freeSlot();
const slotB = await freeSlot();
const a = await book(slotA, claimer);
const b = await book(slotB, newcomer);
ok(a.status === 200 && b.status === 200, "con la cédula de una paciente y otros datos, la reserva sale como con una cédula nueva", { a: a.body, b: b.body });
ok(JSON.stringify(shape(a.body)) === JSON.stringify(shape(b.body)), "la misma respuesta (los mismos campos, email, pago)", { a: shape(a.body), b: shape(b.body) });
ok(a.body.clientEmail === claimer.email && b.body.clientEmail === newcomer.email, "y el email que se escribió en las dos", { a: a.body.clientEmail, b: b.body.clientEmail });
ok(!JSON.stringify(a.body).includes("Rosa") && !JSON.stringify(a.body).includes(real.email), "sin nada de la ficha", a.body);
ok(
  JSON.stringify(emailsOf(a.body.appointmentId, claimer.email)) === JSON.stringify(emailsOf(b.body.appointmentId, newcomer.email)),
  "los mismos emails, al correo escrito",
  { a: emailsOf(a.body.appointmentId, claimer.email), b: emailsOf(b.body.appointmentId, newcomer.email) },
);
const takenA = await book(slotA, person("Tercera Persona"));
const takenB = await book(slotB, person("Cuarta Persona"));
ok(takenA.status === 409 && takenB.status === 409, "y la hora queda ocupada en los dos casos", { a: takenA.status, b: takenB.status });
const retryA = await book(slotA, claimer);
const retryB = await book(slotB, newcomer);
ok(
  retryA.status === 200 && retryA.body.appointmentId === a.body.appointmentId && retryB.body.appointmentId === b.body.appointmentId,
  "reenviar la misma reserva da la misma cita en los dos casos",
  { a: retryA.body, b: retryB.body },
);

console.log("El paciente aparte");
const provisional = sql(`select c.id || '|' || c.document_id || '|' || coalesce(c.claimed_client_id::text, '') from appointments a join clients c on c.id = a.client_id where a.id = '${a.body.appointmentId}'`).split("|");
ok(provisional[1] === "" && provisional[2] === realId, "la cita es de un paciente aparte, sin cédula, que apunta a la ficha", provisional);
ok(sql(`select email || '|' || phone || '|' || name from clients where id = '${realId}'`) === `${real.email}|${real.phone}|Rosa Real`, "la ficha no cambia");
ok(count(`select count(*) from notifications where to_email = '${real.email}'`) === 0, "y no le llega ningún email");
const notice = onlineBookingNotice((await findOnlineBookings(pool, null, new Date().toISOString(), 200)).bookings.find((x) => x.clients[0]?.name === "Otra Persona")!);
ok(/Por verificar \(la cédula es de un paciente con otros datos\)/.test(notice.message) && !notice.message.includes("Rosa"), "el aviso de ntfy dice «Por verificar»", notice.message);
ok(
  /Por verificar/.test(sql(`select body from notifications where appointment_id = '${a.body.appointmentId}' and type = 'booking_received'`)) &&
    !/Por verificar/.test(sql(`select body from notifications where appointment_id = '${b.body.appointmentId}' and type = 'booking_received'`)),
  "y el email al negocio también (y no en la de la cédula nueva)",
);
const reused = await book(await freeSlot(), claimer);
ok(sql(`select client_id from appointments where id = '${reused.body.appointmentId}'`) === provisional[0], "otra reserva con los mismos datos usa el mismo paciente aparte", reused.body);

// El recordatorio de la cita: al correo escrito, nunca al de la ficha.
const [date, time] = sql(`select a.date || ' ' || to_char(a.start_time, 'HH24:MI') from appointments a where a.id = '${a.body.appointmentId}'`).split(" ");
await transaction((db) => runReminderJob(db, businessId, new Date(new Date(`${date}T${time}:00-05:00`).getTime() - 20 * 3_600_000)));
const reminders = sql(`select to_email from notifications where appointment_id = '${a.body.appointmentId}' and type = 'appointment_reminder'`).split("\n").filter(Boolean);
ok(reminders.length === 1 && reminders[0] === claimer.email, "el recordatorio va al correo escrito, nunca al de la ficha", reminders);

console.log("Los topes, iguales");
sql(
  `insert into clients (business_id, name, email, source, created_at)
   select '${businessId}', 'Relleno ' || g, 'relleno' || g || '.${tag}@correo.ec', 'booking_page', now() from generate_series(1, 15) g`,
);
const cappedA = await book(await freeSlot(), { ...person("Quinta Persona"), documentId: real.documentId });
const cappedB = await book(await freeSlot(), person("Sexta Persona"));
ok(
  cappedA.status === 429 && cappedB.status === 429 && cappedA.body.error.message === cappedB.body.error.message,
  "con el negocio en su tope de pacientes nuevos, la misma respuesta",
  { a: cappedA.body, b: cappedB.body },
);
sql(`delete from clients where business_id = '${businessId}' and name like 'Relleno %'`);

console.log("El rol Profesional");
const ownClients = (await valeria("GET", `${B}/clients`)).body as { id: string; claimedClientId: string | null }[];
ok(
  ownClients.some((c) => c.id === provisional[0] && c.claimedClientId === realId) && !ownClients.some((c) => c.id === realId),
  "Valeria ve al paciente aparte (es de su agenda) pero no la ficha de Rosa",
  ownClients.map((c) => c.id),
);
let r = await valeria("POST", `${B}/clients/${provisional[0]}/confirm-claim`, { updateEmail: true });
ok(r.status === 403 && /recepción o al propietario/.test(r.body.error.message), "y no lo puede unir a la ficha", r.body);

console.log("«Tu cita» de una reserva por verificar (spec 010)");
const tokenA = sql(`select payment_token from appointments where id = '${a.body.appointmentId}'`);
const createdMail = sql(`select body from notifications where appointment_id = '${a.body.appointmentId}' and type = 'booking_created' and to_email = '${claimer.email}'`);
ok(createdMail.includes(`/cita/${tokenA}`), "el enlace a «Tu cita» llega al correo escrito al reservar", createdMail.slice(0, 300));
r = await visitor("POST", `/public/appointments/${tokenA}/confirm`);
ok(r.status === 200 && r.body.appointment.confirmedAt, "y con él confirma que va", r.body);
const confirmedA = sql(`select client_confirmed_at::text from appointments where id = '${a.body.appointmentId}'`);
// También es otra persona de una sesión de la clínica, ya confirmada (como la deja «Confirmo que voy»).
const [companionAppointment, companionToken, companionConfirmed] = sql(
  `insert into appointment_clients (appointment_id, client_id, business_id, confirmed_at)
   select id, '${provisional[0]}', business_id, now() from appointments
    where business_id = '${businessId}' and client_id <> '${provisional[0]}' and client_id <> '${realId}' and status = 'confirmed'
    order by date desc limit 1
   returning appointment_id || '|' || access_token || '|' || confirmed_at::text`,
)
  .split("\n")[0]
  .split("|");

console.log("Unir a la ficha");
r = await elena("POST", `${B}/clients/${provisional[0]}/confirm-claim`, { updateEmail: true });
ok(r.status === 200 && r.body.id === realId && r.body.email === claimer.email && r.body.phone === real.phone, "Recepción lo une: la ficha se queda con el email nuevo y su teléfono", r.body);
ok(
  sql(`select string_agg(distinct client_id::text, ',') from appointments where id in ('${a.body.appointmentId}', '${reused.body.appointmentId}')`) === realId,
  "las dos citas pasan a la ficha",
);
ok(count(`select count(*) from clients where id = '${provisional[0]}'`) === 0, "y el paciente aparte desaparece");
ok(
  sql(`select payment_token || '|' || coalesce(client_confirmed_at::text, '') from appointments where id = '${a.body.appointmentId}'`) === `${tokenA}|${confirmedA}`,
  "unir a la ficha conserva el enlace a «Tu cita» y la confirmación",
);
ok(
  sql(`select access_token || '|' || coalesce(confirmed_at::text, '') from appointment_clients where appointment_id = '${companionAppointment}' and client_id = '${realId}'`) ===
    `${companionToken}|${companionConfirmed}`,
  "también los de otra persona de una sesión",
);
r = await visitor("GET", `/public/appointments/${tokenA}`);
ok(r.status === 200 && r.body.confirmedAt && (await visitor("GET", `/public/appointments/${companionToken}`)).status === 200, "y los enlaces de los emails siguen funcionando", r.body);
ok(count(`select count(*) from audit_logs where action = 'client.claim_confirmed' and entity_id = '${realId}'`) === 1, "queda en la actividad");
r = await elena("POST", `${B}/clients/${realId}/confirm-claim`, {});
ok(r.status === 409, "una ficha normal no se «une»", r.body);

console.log("Con historia clínica, cancelar");
const other = person("Gloria Ficha");
const otherId: string = (await ricardo("POST", `${B}/clients`, { ...other, address: "", notes: "", isActive: true })).body.id;
const claimer2 = { ...person("Intento Dos"), documentId: other.documentId };
const c = await book(await freeSlot(), claimer2);
const provisional2 = sql(`select client_id from appointments where id = '${c.body.appointmentId}'`);
sql(`insert into clinical_profiles (business_id, client_id, updated_by_name) values ('${businessId}', '${provisional2}', 'Prueba')`);
r = await elena("POST", `${B}/clients/${provisional2}/confirm-claim`, {});
ok(r.status === 409 && /historia clínica/.test(r.body.error.message), "si el paciente aparte ya tiene historia clínica, no se une", r.body);
ok(sql(`select claimed_client_id from clients where id = '${provisional2}'`) === otherId, "y sigue por verificar");
r = await elena("PATCH", `${B}/appointments/${c.body.appointmentId}/status`, { status: "cancelled" });
ok(
  r.status === 200 && count(`select count(*) from notifications where appointment_id = '${c.body.appointmentId}' and type = 'appointment_cancelled' and to_email = '${claimer2.email}'`) === 1,
  "al cancelar la cita, la cancelación llega al correo escrito",
  r.body,
);
ok(count(`select count(*) from notifications where to_email = '${other.email}'`) === 0, "y nada a la ficha de Gloria");

console.log("Un paciente antiguo sin cédula");
const legacyId = sql(
  `insert into clients (business_id, name, email, phone) values ('${businessId}', 'Antiguo Sin Cedula', 'antiguo.${tag}@correo.ec', '0990001111') returning id`,
).split("\n")[0];
const legacyBooking = await book(await freeSlot(), { documentId: cedulaFor(`${tag}-antiguo`), name: "Antiguo Sin Cedula", email: `antiguo.${tag}@correo.ec`, phone: "+593 98 222 3333" });
ok(legacyBooking.status === 200, "con su nombre y su email pero otro teléfono, la reserva sale", legacyBooking.body);
ok(sql(`select document_id from clients where id = '${legacyId}'`) === "", "pero su ficha no recibe esa cédula");

await pool.end();
done("de las reservas por verificar");
