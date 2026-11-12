// Lista de espera (spec 047). El interruptor (sólo el propietario, con su entrada en la actividad); anotarse desde
// la página de reservas (apagada: 404; el mismo email actualiza; el tope de 5; la validación; el email «Te anotamos»
// sin copia; el aviso de la campana sin nombres); el enlace personal (ver y «Salir de la lista»); el disparador que
// anota la hora liberada (cancelar, cambiar la hora, borrar al paciente; no con la lista apagada); el aviso del cron
// (queueWaitlistOffers, con el momento como parámetro): a quién le sirve, todos a la vez, varias horas en un email,
// el tope de 3 al día, la anticipación mínima (sin email pero con aviso), sin copia al profesional y el descarte a
// las 3 horas; reservar cierra la espera; la lista del panel (anotar, quitar, agendar; el rol Profesional, sólo su
// agenda; otro negocio, 403). Datos inventados en una fecha a unas semanas, sin las citas demo de esa agenda.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, login, sql } from "./helpers/harness.ts";
import { DISCARD_REASONS } from "../src/services/email-limits.ts";
import type { OutgoingEmail } from "../src/services/mailer.ts";
import { addDaysISO, getDayOfWeek } from "../src/shared/lib/time.ts";
import type { Business, PublicWaitlistEntry, WaitlistEntry } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { queueWaitlistOffers } = await import("../src/jobs/scheduled-tasks.ts");
const { processEmailQueue } = await import("../src/services/mailer.ts");

let ipSeq = 0;
const nextIp = () => `198.19.0.${(ipSeq++ % 250) + 1}`;
const as = (email: string) => login(email, { ip: nextIp() });
const anonymous = () => agent({ ip: nextIp() });

const ricardo = await as("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional
const laura = await as("laura@demo.com"); // propietaria de otro negocio
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const slug = sql(`select slug from businesses where id = '${businessId}'`);
const zone = sql(`select timezone from businesses where id = '${businessId}'`);
const today = sql(`select (now() at time zone '${zone}')::date`);
const agendaOf = (email: string) =>
  sql(`select id from professionals where business_id = '${businessId}' and user_id = (select id from users where email = '${email}')`);
const valeriaAgenda = agendaOf("valeria@demo.com");
const ricardoAgenda = agendaOf("ricardo@demo.com");
const service = sql(`select id from services where business_id = '${businessId}' and name = 'Consulta odontológica'`);
const duration = Number(sql(`select duration_minutes from services where id = '${service}'`));
ok(Boolean(valeriaAgenda && ricardoAgenda && service), "las agendas y el servicio", { valeriaAgenda, ricardoAgenda, service });

// Un día a unas semanas en que Valeria atiende, sin sus citas demo (antes de encender la lista: no deja horas).
const schedule = sql(
  `select day_of_week || '|' || (intervals -> 0 ->> 'start') from schedules
    where professional_id = '${valeriaAgenda}' and is_active and jsonb_array_length(intervals) > 0 order by day_of_week limit 1`,
).split("|");
const workDay = Number(schedule[0]);
const T1 = schedule[1];
let D = addDaysISO(today, 21);
while (getDayOfWeek(D) !== workDay) D = addDaysISO(D, 1);
const plus = (time: string, minutes: number) => sql(`select to_char(time '${time}' + make_interval(mins => ${minutes}), 'HH24:MI')`);
const T2 = plus(T1, duration * 2);
const partOf = (time: string) => (Number(time.slice(0, 2)) < 12 ? "morning" : Number(time.slice(0, 2)) < 18 ? "afternoon" : "evening");
const otherPart = (part: string) => (part === "morning" ? "evening" : "morning");
sql(`delete from appointments where professional_id = '${valeriaAgenda}' and date between '${addDaysISO(D, -1)}' and '${addDaysISO(D, 1)}'`);
const at = (date: string, time: string) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${zone}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`));

const tag = Date.now().toString(36);
let seq = 0;
const mail = () => `espera.${++seq}.${tag}@correo.ec`;
const businessNow = async () => (await ricardo("GET", B)).body as Business;
const setWaitlist = async (browser: typeof ricardo, on: boolean) => {
  const current = await businessNow();
  return browser("PATCH", B, { bookingSettings: { ...current.bookingSettings, waitlist: on } });
};
const join = (body: Record<string, unknown>) =>
  anonymous()("POST", `/public/businesses/${slug}/waitlist`, {
    serviceId: service,
    professionalId: valeriaAgenda,
    days: [workDay],
    dayParts: [partOf(T1)],
    until: addDaysISO(D, 5),
    name: "Ana Espera",
    email: mail(),
    phone: "+593 98 765 4321",
    ...body,
  });
const entryOf = (email: string) =>
  sql(`select id || '|' || token || '|' || coalesce(closed_reason, '') from waitlist_entries where email = '${email}' order by created_at desc limit 1`).split("|");
const emailsTo = (email: string, type: string) => count(`select count(*) from notifications where to_email = '${email}' and type = '${type}'`);
const auditCount = (action: string) => count(`select count(*) from audit_logs where business_id = '${businessId}' and action = '${action}'`);
const appointment = (time: string, status = "confirmed", client?: string) => {
  const clientId =
    client ??
    sql(
      `insert into clients (business_id, name, email, phone, document_id)
       values ('${businessId}', 'Paciente ${++seq}', 'paciente.${seq}.${tag}@correo.ec', '+593 98 111 ${String(1000 + seq)}', '${cedulaFor(`${tag}-${seq}`)}')
       returning id`,
    ).split("\n")[0];
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${clientId}', '${service}', '${valeriaAgenda}', '${D}', '${time}', '${plus(time, duration)}', '${status}', 20, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
const freedSlots = () => count(`select count(*) from waitlist_freed_slots where business_id = '${businessId}' and processed_at is null`);

/* ======================================================================================== */
console.log("El interruptor");
let r = await join({});
ok(r.status === 404, "con la lista apagada, anotarse responde como un negocio que no existe", r.status);
const before = appointment(T1);
r = await ricardo("PATCH", `${B}/appointments/${before}/status`, { status: "cancelled", notify: false });
ok(r.status === 200 && freedSlots() === 0, "con la lista apagada, cancelar no anota la hora", [r.status, freedSlots()]);
r = await setWaitlist(elena, true);
ok(r.status === 403, "Recepción no la enciende", r.status);
r = await setWaitlist(ricardo, true);
ok(r.status === 200 && (await businessNow()).bookingSettings.waitlist === true, "el propietario la enciende", r.body);
ok(
  count(`select count(*) from audit_logs where business_id = '${businessId}' and action = 'business.updated' and changes::text like '%Lista de espera%'`) >= 1,
  "y queda en la actividad",
);

/* ======================================================================================== */
console.log("\nAnotarse desde la página de reservas");
const anaEmail = mail();
r = await join({ email: anaEmail });
ok(r.status === 200 && r.body.until === addDaysISO(D, 5), "se anota", r.body);
const [anaId, anaToken] = entryOf(anaEmail);
ok(Boolean(anaId) && /^[0-9a-f]{32}$/.test(anaToken), "la espera queda guardada con su enlace");
ok(emailsTo(anaEmail, "waitlist_joined") === 1, "le llega «Te anotamos»");
ok(count(`select count(*) from notifications where business_id = '${businessId}' and type = 'appointment_copy' and created_at > now() - interval '1 minute'`) === 0, "sin copia al profesional");
const joinedNotice = sql(`select data::text from panel_notices where business_id = '${businessId}' and kind = 'waitlist_joined' order by created_at desc limit 1`);
ok(joinedNotice.includes("Consulta") && !joinedNotice.includes("Ana"), "la campana avisa sin el nombre", joinedNotice);
ok(auditCount("waitlist.joined") === 1, "queda en la actividad");
r = await join({ email: anaEmail, days: [workDay, (workDay + 1) % 7] });
ok(r.status === 200 && count(`select count(*) from waitlist_entries where email = '${anaEmail}' and closed_at is null`) === 1, "el mismo email actualiza, no repite");
ok(sql(`select cardinality(days) from waitlist_entries where id = '${anaId}'`) === "2", "con los días nuevos");
r = await join({ until: addDaysISO(today, 400) });
ok(r.status === 400, "una fecha más allá de los días hacia adelante, rechazada", r.status);
r = await join({ days: [] });
ok(r.status === 400, "sin días, rechazada", r.status);
const busy = mail();
// Cinco esperas abiertas de la misma persona (otro servicio, cada agenda y «Cualquiera»; y este servicio sin agenda).
const otherService = sql(`select id from services where business_id = '${businessId}' and is_active and id <> '${service}' order by created_at limit 1`);
const agendas = sql(`select id from professionals where business_id = '${businessId}' order by sort_order`).split("\n");
for (const [serviceId, professionalId] of [
  [otherService, null],
  [otherService, agendas[0]],
  [otherService, agendas[1]],
  [otherService, agendas[2]],
  [service, null],
]) {
  sql(`insert into waitlist_entries (business_id, service_id, professional_id, name, email, phone, days, day_parts, until, source)
       values ('${businessId}', '${serviceId}', ${professionalId ? `'${professionalId}'` : "null"}, 'Muchas', '${busy}', '', '{${(workDay + 3) % 7}}', '{morning}', '${D}', 'booking_page')`);
}
r = await join({ email: busy });
ok(r.status === 400 && /5 listas de espera/.test(r.body?.error?.message ?? ""), "más de 5 esperas abiertas, rechazada", r.body);

/* ======================================================================================== */
console.log("\nEl enlace personal");
const link = anonymous();
r = await link("GET", `/public/waitlist/${anaToken}`);
const page = r.body as PublicWaitlistEntry;
ok(r.status === 200 && page.serviceName === "Consulta odontológica" && page.email === anaEmail && !page.closed, "muestra lo que pidió y sus datos", r.body);
ok(/no-store/.test(r.headers.get("cache-control") ?? ""), "sin caché");
r = await link("GET", "/public/waitlist/00000000000000000000000000000000");
ok(r.status === 404, "un enlace que no existe, 404", r.status);
const leaver = mail();
await join({ email: leaver });
const [, leaverToken] = entryOf(leaver);
r = await link("POST", `/public/waitlist/${leaverToken}/leave`);
ok(r.status === 200 && entryOf(leaver)[2] === "left", "«Salir de la lista» la cierra", entryOf(leaver));
ok(auditCount("waitlist.left") === 1, "con su entrada en la actividad");
r = await link("POST", `/public/waitlist/${leaverToken}/leave`);
ok(r.status === 200 && auditCount("waitlist.left") === 1, "salir dos veces no hace nada");
ok(((await link("GET", `/public/waitlist/${leaverToken}`)).body as PublicWaitlistEntry).closed, "el enlace dice que ya no está");

/* ======================================================================================== */
console.log("\nLa lista del panel");
r = await ricardo("POST", `${B}/waitlist`, {
  serviceId: service,
  professionalId: valeriaAgenda,
  days: [workDay],
  dayParts: [partOf(T1)],
  until: addDaysISO(D, 3),
  name: "Bruno Teléfono",
  email: "",
  phone: "+593 99 222 3333",
});
ok(r.status === 200 && (r.body as WaitlistEntry).email === null, "el propietario anota a alguien sin email", r.body);
const brunoId = (r.body as WaitlistEntry).id;
ok(auditCount("waitlist.added") === 1, "queda en la actividad");
r = await ricardo("POST", `${B}/waitlist`, { serviceId: service, days: [1], dayParts: ["morning"], until: D, name: "Sin Contacto" });
ok(r.status === 400, "sin email ni teléfono, rechazada", r.status);
const ricardoOnly = mail();
r = await ricardo("POST", `${B}/waitlist`, {
  serviceId: service,
  professionalId: ricardoAgenda,
  days: [workDay],
  dayParts: [partOf(T1)],
  until: addDaysISO(D, 3),
  name: "Carla Ricardo",
  email: ricardoOnly,
});
ok(r.status === 200, "y a alguien en la agenda de Ricardo", r.body);
let list = (await valeria("GET", `${B}/waitlist`)).body as WaitlistEntry[];
ok(list.length > 0 && list.every((entry) => entry.professionalId === valeriaAgenda), "el rol Profesional ve sólo las de su agenda", list.length);
list = (await elena("GET", `${B}/waitlist`)).body as WaitlistEntry[];
ok(list.some((entry) => entry.professionalId === ricardoAgenda) && list.some((entry) => entry.professionalId === valeriaAgenda), "Recepción ve todas");
r = await laura("GET", `${B}/waitlist`);
ok(r.status === 403, "otro negocio, 403", r.status);
r = await valeria("POST", `${B}/waitlist/${entryOf(ricardoOnly)[0]}/close`, { reason: "removed" });
ok(r.status === 404, "el rol Profesional no quita las de otra agenda", r.status);

/* ======================================================================================== */
console.log("\nSe libera una hora y se avisa");
// Quién espera el día D a la hora T1 en la agenda de Valeria (Ana ya está, con email).
const anyEmail = mail(); // «Cualquiera»
await join({ email: anyEmail, professionalId: null });
const otherPartEmail = mail();
await join({ email: otherPartEmail, dayParts: [otherPart(partOf(T1))] });
const otherDayEmail = mail();
await join({ email: otherDayEmail, days: [(workDay + 2) % 7] });
const shortEmail = mail();
await join({ email: shortEmail, until: addDaysISO(D, -1) });

const x = appointment(T1);
r = await ricardo("PATCH", `${B}/appointments/${x}/status`, { status: "cancelled", notify: false });
ok(r.status === 200 && freedSlots() === 1, "cancelar desde el panel (sin avisar) anota la hora", [r.status, freedSlots()]);
let result = await queueWaitlistOffers(at(addDaysISO(D, -2), "08:00"));
ok(result.queued === 2 && result.failures === 0, "el cron avisa a dos personas", result);
ok(emailsTo(anaEmail, "waitlist_offer") === 1 && emailsTo(anyEmail, "waitlist_offer") === 1, "a Ana y a quien pidió «Cualquiera»");
ok(
  [otherPartEmail, otherDayEmail, shortEmail, ricardoOnly].every((email) => emailsTo(email, "waitlist_offer") === 0),
  "no a quien pidió otra parte del día, otro día, una fecha anterior ni otra agenda",
);
const offerBody = sql(`select body from notifications where to_email = '${anaEmail}' and type = 'waitlist_offer'`);
ok(
  offerBody.includes(`/book/${slug}?`) && offerBody.includes(`fecha=${D}`) && offerBody.includes(`hora=${T1.replace(":", "%3A")}`) && offerBody.includes(`espera=${anaToken}`),
  "con «Reservar esta hora»: el día, la hora y su enlace",
  offerBody.slice(0, 400),
);
const slotNotice = sql(`select data::text from panel_notices where business_id = '${businessId}' and kind = 'waitlist_slot' order by created_at desc limit 1`);
ok(/"count": 3/.test(slotNotice) && !/Ana|Bruno/.test(slotNotice), "la campana dice 3 personas (también la sin email), sin nombres", slotNotice);
ok(freedSlots() === 0, "la hora queda procesada");
result = await queueWaitlistOffers(at(addDaysISO(D, -2), "08:10"));
ok(result.queued === 0, "la pasada siguiente no repite", result);

console.log("\nVarias horas en un email y el tope de 3 al día");
const y = appointment(T1);
const z = appointment(T2);
await ricardo("PATCH", `${B}/appointments/${y}/status`, { status: "cancelled", notify: false });
// Cambiar la hora también libera la anterior.
sql(`update appointments set start_time = '${plus(T2, duration)}', end_time = '${plus(T2, duration * 2)}' where id = '${z}'`);
ok(freedSlots() === 2, "cancelar y cambiar la hora anotan dos horas", freedSlots());
result = await queueWaitlistOffers(at(addDaysISO(D, -2), "09:00"));
const latest = sql(`select body from notifications where to_email = '${anaEmail}' and type = 'waitlist_offer' order by created_at desc limit 1`);
ok(emailsTo(anaEmail, "waitlist_offer") === 2 && latest.includes(`hora=${T1.replace(":", "%3A")}`), "Ana recibe un solo email más con las horas que le sirven", [emailsTo(anaEmail, "waitlist_offer")]);
sql(`update waitlist_entries set offers_on = '${addDaysISO(D, -2)}', offers_today = 3 where id = '${anaId}'`);
const w = appointment(T1);
await ricardo("PATCH", `${B}/appointments/${w}/status`, { status: "cancelled", notify: false });
await queueWaitlistOffers(at(addDaysISO(D, -2), "10:00"));
ok(emailsTo(anaEmail, "waitlist_offer") === 2, "con 3 en el día, no le llega otro");

console.log("\nLa anticipación mínima");
const v = appointment(T1);
await ricardo("PATCH", `${B}/appointments/${v}/status`, { status: "cancelled", notify: false });
const anyBefore = emailsTo(anyEmail, "waitlist_offer");
const noticesBefore = count(`select count(*) from panel_notices where business_id = '${businessId}' and kind = 'waitlist_slot'`);
await queueWaitlistOffers(at(D, plus(T1, -120)));
ok(emailsTo(anyEmail, "waitlist_offer") === anyBefore, "a dos horas de la cita (menos que la anticipación mínima) no sale email");
ok(count(`select count(*) from panel_notices where business_id = '${businessId}' and kind = 'waitlist_slot'`) === noticesBefore + 1, "pero la campana avisa");

console.log("\nBorrar al paciente también libera su hora");
const u = appointment(T1);
const uClient = sql(`select client_id from appointments where id = '${u}'`);
r = await ricardo("DELETE", `${B}/clients/${uClient}`);
ok(r.status === 204 && freedSlots() === 1, "la hora queda anotada", [r.status, freedSlots()]);
await queueWaitlistOffers(at(addDaysISO(D, -2), "11:00"));

/* ======================================================================================== */
console.log("\nEl descarte a las 3 horas");
const stale = sql(`select id from notifications where to_email = '${anyEmail}' and type = 'waitlist_offer' order by created_at limit 1`);
sql(`update notifications set status = 'queued', attempts = 0, created_at = now() - interval '4 hours', next_attempt_at = now() where id = '${stale}'`);
const fresh = sql(`select id from notifications where to_email = '${anyEmail}' and type = 'waitlist_offer' order by created_at desc limit 1`);
sql(`update notifications set status = 'queued', attempts = 0, next_attempt_at = now() where id = '${fresh}'`);
const sent: OutgoingEmail[] = [];
await processEmailQueue({ send: async (email: OutgoingEmail) => void sent.push(email) });
ok(
  sql(`select status || '|' || coalesce(last_error, '') from notifications where id = '${stale}'`) === `failed|${DISCARD_REASONS.staleWaitlistOffer}`,
  "el aviso que esperó más de 3 horas se descarta",
  sql(`select status || '|' || coalesce(last_error, '') from notifications where id = '${stale}'`),
);
ok(sent.some((email) => email.to === anyEmail), "el reciente sale");

/* ======================================================================================== */
console.log("\nReservar cierra la espera y el panel");
const bookedEmail = mail();
await join({ email: bookedEmail });
r = await anonymous()("POST", `/public/businesses/${slug}/bookings`, {
  serviceId: service,
  professionalId: valeriaAgenda,
  date: D,
  startTime: T1,
  documentId: cedulaFor(`${tag}-reserva`),
  name: "Reserva Desde Email",
  email: bookedEmail,
  phone: "+593 98 333 4444",
  notes: "",
});
ok(r.status === 200 || r.status === 201, "reserva la hora libre", r.body);
ok(entryOf(bookedEmail)[2] === "booked", "y su espera se cierra", entryOf(bookedEmail));
r = await anonymous()("POST", `/public/businesses/${slug}/bookings`, {
  serviceId: service,
  professionalId: valeriaAgenda,
  date: D,
  startTime: T1,
  documentId: cedulaFor(`${tag}-tarde`),
  name: "Llego Tarde",
  email: mail(),
  phone: "+593 98 333 5555",
  notes: "",
});
ok(r.status === 409, "la misma hora ya no se reserva dos veces", r.status);

r = await elena("POST", `${B}/waitlist/${brunoId}/close`, { reason: "scheduled" });
ok(r.status === 200 && auditCount("waitlist.scheduled") === 1, "Recepción la cierra al agendarla", r.body);
r = await ricardo("POST", `${B}/waitlist/${entryOf(ricardoOnly)[0]}/close`, { reason: "removed" });
ok(r.status === 200 && auditCount("waitlist.removed") === 1 && entryOf(ricardoOnly)[2] === "removed", "el propietario la quita");

/* ======================================================================================== */
console.log("\nLa descarga de datos");
r = await ricardo("GET", `${B}/export`);
ok(r.status === 200 && r.body.counts.waitlist > 0, "el resumen cuenta la lista de espera", r.body?.counts);
r = await ricardo("GET", `${B}/export/waitlist`);
const exported = (r.body?.items ?? []) as { email: string; professional: string; closedReason: string | null }[];
ok(
  r.status === 200 && exported.some((item) => item.email === bookedEmail && item.closedReason === "booked") && exported.some((item) => item.closedReason === null),
  "lista-de-espera.xlsx trae las abiertas y las cerradas",
  exported.length,
);
r = await valeria("GET", `${B}/export/waitlist`);
ok(
  r.status === 200 && (r.body.items as { professional: string }[]).every((item) => item.professional === "Dra. Valeria Cruz"),
  "el rol Profesional, sólo las de su agenda",
  r.body?.items?.length,
);
r = await elena("GET", `${B}/export/waitlist`);
ok(r.status === 403, "Recepción no descarga", r.status);

/* ======================================================================================== */
console.log("\nVencidas, inactivas y borrados");
sql(`update waitlist_entries set until = '${addDaysISO(D, -10)}' where id = '${anaId}'`);
await queueWaitlistOffers(at(addDaysISO(D, -2), "12:00"));
ok(entryOf(anaEmail)[2] === "expired", "la vencida se cierra", entryOf(anaEmail));
sql(`update waitlist_entries set closed_at = now() - interval '31 days' where id = '${anaId}'`);
await queueWaitlistOffers(at(addDaysISO(D, -2), "12:10"));
ok(count(`select count(*) from waitlist_entries where id = '${anaId}'`) === 0, "a los 30 días de cerrada se borra");
r = await setWaitlist(ricardo, false);
const off = appointment(T2);
await ricardo("PATCH", `${B}/appointments/${off}/status`, { status: "cancelled", notify: false });
ok(freedSlots() === 0, "con la lista apagada, nada se anota");

done("de la lista de espera");
// La tarea del cron y el envío abren su conexión a la base: sin esto, la suite espera a que se cierre sola.
process.exit();
