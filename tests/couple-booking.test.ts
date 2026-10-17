// Servicios en pareja o en familia y su reserva online (spec 005): el servicio dice para cuántas
// personas es (sólo con el interruptor del super admin); la página pide los datos de cada una, las
// reconoce por su cédula como a quien reserva y registra a las nuevas; una sola cita con todas; los
// límites cuentan a cada persona; el reintento; los emails (los datos de pago, sólo al principal); y un
// profesional con «sólo sus pacientes» no abre la ficha de la otra persona hasta que el negocio la gestione.
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { Appointment, Client, PublicBusinessProfile, Service } from "../src/shared/types/index.ts";
import { viaProxy } from "./helpers/proxy.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 500));
  }
};
let ipCounter = 40;
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        // Cada petición desde una IP distinta: no se gasta el límite por conexión.
        ...viaProxy(`198.51.100.${ipCounter++ % 250}`),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const count = (query: string) => Number(sql(query));
const login = async (email: string) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: "demo1234", remember: true })).body;
  return { a, session };
};

const { pool } = await import("../src/db/pool.ts");
const { findOnlineBookings } = await import("../src/services/booking-alerts.ts");

const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa
const { a: elena } = await login("elena@demo.com"); // Recepción
const { a: valeria } = await login("valeria@demo.com"); // rol Profesional
const { a: admin } = await login("admin@demo.com"); // super admin
const visitor = agent();
const businessId: string = rs.businessId;
const B = `/businesses/${businessId}`;
const SWITCH = `/admin/businesses/${businessId}/multi-client-appointments`;
const business = (await ricardo("GET", B)).body;
const slug: string = business.slug;

// Emails de confirmación activos, elegir profesional y una cita por persona al día.
sql(`update businesses set notification_settings = notification_settings || '{"confirmations": true, "cancellations": true}' where id = '${businessId}'`);
await ricardo("PATCH", B, { bookingSettings: { ...business.bookingSettings, chooseProfessional: true, maxClientBookingsPerDay: 1, minNoticeHours: 0 } });
const professionals = (await ricardo("GET", `${B}/professionals`)).body as { id: string; displayName: string }[];
const ricardoAgenda = professionals.find((p) => p.displayName === "Ricardo Paredes")!;
const valeriaAgenda = professionals.find((p) => p.displayName === "Dra. Valeria Cruz")!;
// Las dos agendas atienden todos los servicios y cobran por transferencia (para ver a quién llegan los datos de pago).
sql(`update professionals set all_services = true,
       bank_accounts = '[{"bank":"Produbanco","accountType":"checking","number":"0200123456","holder":"Clínica Demo","holderId":""}]'::jsonb
      where id in ('${ricardoAgenda.id}', '${valeriaAgenda.id}')`);

const tag = Date.now().toString(36);
let seed = 900;
/** Una persona para la página (cédula válida y única). */
const person = (name: string) => {
  const first = name.split(" ")[0].toLowerCase();
  seed++;
  return { documentId: cedulaFor(`${tag}-${seed}`), name, email: `${first}.${seed}.${tag}@correo.ec`, phone: `+593 99 ${String(seed).padStart(3, "0")} 4567` };
};
type Person = ReturnType<typeof person>;
/** Un paciente que ya existe en el negocio (lo registra el propietario). */
async function existing(name: string): Promise<Person & { id: string }> {
  const p = person(name);
  const r = await ricardo("POST", `${B}/clients`, { ...p, address: "", notes: "", isActive: true });
  if (r.status !== 200) throw new Error(`No se pudo crear ${name}: ${JSON.stringify(r.body)}`);
  return { ...p, id: r.body.id };
}

const serviceBody = (fields: Record<string, unknown>) => ({
  name: `Terapia de pareja ${tag}`,
  description: "",
  durationMinutes: 60,
  price: 40,
  showPrice: true,
  modes: ["business"],
  homeVisitFee: 0,
  isActive: true,
  ...fields,
});

/** Una hora libre de esa agenda (de pasado mañana en adelante), que no se haya usado en la prueba. */
const used = new Set<string>();
async function freeSlot(serviceId: string, professionalId: string, date?: string): Promise<{ date: string; time: string }> {
  const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
  const now = getZonedNow(profile.business.timezone);
  const service = profile.services.find((s) => s.id === serviceId)!;
  const context = scopeToProfessional({ ...profile, settings: profile.business.bookingSettings, now }, professionalId);
  for (let d = 2; d < 120; d++) {
    const day = date ?? addDaysISO(now.date, d);
    for (const time of getAvailableSlots(day, service.durationMinutes, context)) {
      const key = `${professionalId}|${day}|${time}`;
      if (!used.has(key)) {
        used.add(key);
        return { date: day, time };
      }
    }
    if (date) break;
  }
  throw new Error("No hay horas libres");
}
const book = (serviceId: string, slot: { date: string; time: string }, main: Person, extraPatients: Person[], professionalId = ricardoAgenda.id) =>
  visitor("POST", `/public/businesses/${slug}/bookings`, {
    serviceId,
    date: slot.date,
    startTime: slot.time,
    professionalId,
    notes: "",
    ...main,
    extraPatients,
  });
const appointmentOf = async (id: string) => (await ricardo("GET", `${B}/appointments/${id}`)).body as Appointment;
const emailsOf = (appointmentId: string) =>
  sql(`select type || '|' || to_email from notifications where appointment_id = '${appointmentId}' order by created_at, to_email`)
    .split("\n")
    .filter(Boolean);
const bodyOf = (appointmentId: string, to: string, type = "booking_created") =>
  sql(`select body from notifications where appointment_id = '${appointmentId}' and type = '${type}' and to_email = '${to}'`);
const clientsCount = () => count(`select count(*) from clients where business_id = '${businessId}'`);
const appointmentsCount = () => count(`select count(*) from appointments where business_id = '${businessId}'`);

console.log("Personas por sesión del servicio");
let r = await ricardo("POST", `${B}/services`, serviceBody({ peoplePerSession: 2 }));
ok(r.status === 200 && r.body.peoplePerSession === 1, "sin el interruptor, el servicio nace individual aunque pida 2", r.body);
const couple: Service = r.body;
r = await ricardo("PUT", `${B}/services/${couple.id}`, serviceBody({ peoplePerSession: 2 }));
ok(r.status === 200 && r.body.peoplePerSession === 1, "y tampoco se cambia al editarlo", r.body);
r = await admin("PUT", SWITCH, { enabled: true });
ok(r.status === 200 && r.body.multiClientAppointments === true, "el super admin enciende las citas con varios pacientes", r.body);
r = await ricardo("PUT", `${B}/services/${couple.id}`, serviceBody({ peoplePerSession: 2 }));
ok(r.status === 200 && r.body.peoplePerSession === 2, "con el interruptor, el servicio pasa a 2 personas", r.body);
r = await ricardo("PUT", `${B}/services/${couple.id}`, serviceBody({}));
ok(r.status === 200 && r.body.peoplePerSession === 2, "un panel anterior (sin el campo) no lo pisa", r.body);
r = await ricardo("PUT", `${B}/services/${couple.id}`, serviceBody({ peoplePerSession: 4 }));
ok(r.status === 400, "más de 3 personas no", r.body);
r = await ricardo("POST", `${B}/services`, serviceBody({ name: `Terapia familiar ${tag}`, peoplePerSession: 3 }));
ok(r.status === 200 && r.body.peoplePerSession === 3, "un servicio de familia, para 3", r.body);
const family: Service = r.body;
const changes = (await ricardo("GET", `${B}/audit-logs?entityId=${couple.id}`)).body.entries.flatMap((e: { changes?: { label: string }[] }) => e.changes ?? []);
ok(changes.some((c: { label: string }) => c.label === "Personas por sesión"), "el cambio queda en la actividad", changes);
const publicPeople = async (id: string) =>
  ((await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body as PublicBusinessProfile).services.find((s) => s.id === id)?.peoplePerSession;
ok((await publicPeople(couple.id)) === 2, "la página de reservas lo ve para 2 personas");
await admin("PUT", SWITCH, { enabled: false });
ok((await publicPeople(couple.id)) === 1, "con el interruptor apagado, la página lo ve individual");
ok(
  ((await ricardo("GET", `${B}/services`)).body as Service[]).find((s) => s.id === couple.id)?.peoplePerSession === 2,
  "pero el servicio conserva sus 2 personas",
);
let slot = await freeSlot(couple.id, ricardoAgenda.id);
r = await book(couple.id, slot, person("Sola Apagado"), [person("Otra Apagado")]);
ok(r.status === 400 && /para una persona/.test(r.body?.error?.message), "y una reserva con otra persona se rechaza", r.body);
r = await book(couple.id, slot, person("Sola Apagado"), []);
ok(r.status === 200, "sola, sí se reserva", r.body);
await admin("PUT", SWITCH, { enabled: true });
ok((await publicPeople(couple.id)) === 2, "al encenderlo de nuevo, vuelve a ser para 2");

console.log("Reservar una sesión de pareja");
const ana = await existing("Ana Existente");
const bruno = person("Bruno Nuevo");
let before = clientsCount();
slot = await freeSlot(couple.id, ricardoAgenda.id);
r = await book(couple.id, slot, ana, [bruno]);
ok(r.status === 200 && r.body.appointmentId, "Ana (ya es paciente) reserva para ella y Bruno (nuevo)", r.body);
const coupleBooking = r.body.appointmentId as string;
let appointment = await appointmentOf(coupleBooking);
const brunoId = sql(`select id from clients where business_id = '${businessId}' and document_id = '${bruno.documentId}'`);
ok(
  appointment.status === "pending" && appointment.clientId === ana.id && JSON.stringify(appointment.extraClientIds) === JSON.stringify([brunoId]),
  "una sola cita pendiente: Ana es la principal y Bruno el otro paciente",
  appointment,
);
ok(clientsCount() === before + 1, "Ana no se duplicó; sólo se registró Bruno", clientsCount() - before);
ok(sql(`select source from clients where id = '${brunoId}'`) === "booking_page", "Bruno queda creado desde la página");
ok(count(`select count(*) from clients where document_id = '${ana.documentId}'`) === 1, "la ficha de Ana sigue siendo una");
let mails = emailsOf(coupleBooking);
ok(
  mails.includes(`booking_created|${ana.email}`) && mails.includes(`booking_created|${bruno.email}`),
  "cada uno recibe su email de solicitud",
  mails,
);
ok(mails.filter((m) => m.startsWith("appointment_copy|")).length === 1, "una sola copia al profesional", mails);
const copy = sql(`select subject from notifications where appointment_id = '${coupleBooking}' and type = 'appointment_copy'`);
ok(copy.includes("Ana Existente y Bruno Nuevo"), "la copia nombra a los dos", copy);
const brunoMail = bodyOf(coupleBooking, bruno.email);
const anaMail = bodyOf(coupleBooking, ana.email);
ok(/Hola Bruno Nuevo:/.test(brunoMail) && /Ana Existente reservó para ti una cita/.test(brunoMail), "el de Bruno le dice que Ana reservó para él", brunoMail.slice(0, 300));
ok(!brunoMail.includes(ana.email) && !brunoMail.includes(ana.phone), "sin el contacto de Ana", brunoMail.slice(0, 300));
ok(/comprobante/i.test(anaMail) && !/comprobante/i.test(brunoMail), "los datos de pago, sólo a Ana (la principal)", { ana: /comprobante/i.test(anaMail), bruno: /comprobante/i.test(brunoMail) });
// Spec 010: cada una con su enlace a «Tu cita»; el de Ana es el del pago y sólo ella cancela y paga desde ahí.
const anaToken = sql(`select payment_token from appointments where id = '${coupleBooking}'`);
const brunoToken = sql(`select access_token from appointment_clients where appointment_id = '${coupleBooking}' and client_id = '${brunoId}'`);
ok(
  anaToken !== brunoToken && anaMail.includes(`/cita/${anaToken}`) && brunoMail.includes(`/cita/${brunoToken}`) && !brunoMail.includes(anaToken),
  "cada uno recibe su propio enlace a «Tu cita»",
  { ana: anaMail.match(/\/cita\/\w+/)?.[0], bruno: brunoMail.match(/\/cita\/\w+/)?.[0] },
);
ok(!sql(`select body from notifications where appointment_id = '${coupleBooking}' and type in ('appointment_copy', 'booking_received')`).includes("/cita/"), "la copia y el aviso al negocio, sin enlaces del paciente");
const anaPage = (await visitor("GET", `/public/appointments/${anaToken}`)).body;
const brunoPage = (await visitor("GET", `/public/appointments/${brunoToken}`)).body;
ok(
  anaPage.payment === true && anaPage.cancellation.status !== "not_main" && brunoPage.payment === false && brunoPage.cancellation.status === "not_main",
  "en «Tu cita», sólo Ana tiene el pago y puede cancelar",
  { ana: [anaPage.payment, anaPage.cancellation?.status], bruno: [brunoPage.payment, brunoPage.cancellation?.status] },
);
const audit = (await ricardo("GET", `${B}/audit-logs?entityId=${coupleBooking}`)).body.entries as { summary: string }[];
ok(audit.some((e) => /Ana Existente y Bruno Nuevo/.test(e.summary)), "la actividad nombra a los dos", audit.map((e) => e.summary));

const carla = await existing("Carla Existente");
const diego = await existing("Diego Existente");
before = clientsCount();
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), carla, [diego]);
ok(r.status === 200 && clientsCount() === before, "los dos ya son pacientes: no se crea ninguno", { status: r.status, nuevos: clientsCount() - before });
before = clientsCount();
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), person("Elisa Nueva"), [person("Fabian Nuevo")]);
ok(r.status === 200 && clientsCount() === before + 2, "ninguno existe: se registran los dos", { status: r.status, nuevos: clientsCount() - before });

// Una pareja con un solo email y un solo teléfono: se registran los dos y les llega un email.
const shared = person("Wendy Compartido");
before = clientsCount();
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), shared, [{ ...person("Walter Compartido"), email: shared.email, phone: shared.phone }]);
ok(r.status === 200 && clientsCount() === before + 2, "dos personas con el mismo email y teléfono: se registran las dos", { status: r.status, nuevos: clientsCount() - before });
ok(
  emailsOf(r.body.appointmentId).filter((m) => m === `booking_created|${shared.email}`).length === 1,
  "y a ese email le llega una sola solicitud",
  emailsOf(r.body.appointmentId),
);

console.log("Los datos de cada persona");
const gina = await existing("Gina Victima");
before = clientsCount();
let appointmentsBefore = appointmentsCount();
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), person("Hector Intento"), [
  { ...person("Gina Escrita"), documentId: gina.documentId },
]);
// Con la cédula de otra paciente y otro contacto, la reserva sale igual y esa persona queda «Por
// verificar» (spec 009): antes un 403 decía que la cédula era de una paciente.
ok(r.status === 200, "con la cédula de otra paciente y otro contacto: la reserva sale igual que con una cédula nueva", r.body);
ok(!JSON.stringify(r.body).includes(gina.email) && !JSON.stringify(r.body).includes("Victima"), "sin ningún dato de su ficha", r.body);
ok(
  clientsCount() === before + 2 && appointmentsCount() === appointmentsBefore + 1,
  "se crean Héctor y la otra persona aparte, con la cita",
  { nuevos: clientsCount() - before },
);
ok(
  sql(`select c.name from appointment_clients ac join clients c on c.id = ac.client_id where ac.appointment_id = '${r.body.appointmentId}' and c.claimed_client_id = '${gina.id}' and c.document_id = ''`) ===
    "Gina Escrita",
  "la otra persona queda «Por verificar», aparte de la ficha de Gina",
);
ok(!emailsOf(r.body.appointmentId).some((m) => m.endsWith(`|${gina.email}`)), "y a la ficha de Gina no le llega nada", emailsOf(r.body.appointmentId));
// Unir a la ficha a la otra persona de la sesión (spec 009): la ficha de Gina ocupa su lugar en la cita.
const ginaAppointment = r.body.appointmentId;
const provisionalGina = sql(`select c.id from appointment_clients ac join clients c on c.id = ac.client_id where ac.appointment_id = '${ginaAppointment}' and c.claimed_client_id = '${gina.id}'`);
const merged = await ricardo("POST", `${B}/clients/${provisionalGina}/confirm-claim`, { updatePhone: true });
ok(merged.status === 200 && merged.body.id === gina.id, "el negocio une a la otra persona a la ficha de Gina", merged.body);
ok(
  sql(`select string_agg(client_id::text, ',') from appointment_clients where appointment_id = '${ginaAppointment}'`) === gina.id &&
    count(`select count(*) from clients where id = '${provisionalGina}'`) === 0,
  "Gina ocupa su lugar en la sesión y el paciente aparte desaparece",
);
// Fuera de los topes del día (pacientes nuevos y reservas online): las pruebas de abajo cuentan con ellos.
sql(`update clients set created_at = now() - interval '2 days' where business_id = '${businessId}' and created_at = (select created_at from appointments where id = '${ginaAppointment}')`);
sql(`update appointments set created_at = now() - interval '2 days' where id = '${ginaAppointment}'`);
const repeatedDoc = person("Ivan Repetido");
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), repeatedDoc, [{ ...person("Juana Repetida"), documentId: repeatedDoc.documentId }]);
ok(r.status === 400 && /propia cédula/.test(r.body?.error?.message ?? JSON.stringify(r.body)), "la misma cédula dos veces no", r.body);
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), person("Karla Sola"), []);
ok(r.status === 400 && /para 2 personas: faltan los datos de la otra persona\. Recarga la página/.test(r.body?.error?.message), "un servicio en pareja sin la otra persona (página anterior): pide recargar", r.body);
const individual = ((await ricardo("GET", `${B}/services`)).body as Service[]).find((s) => s.isActive && s.peoplePerSession === 1 && s.modes.includes("business"))!;
r = await book(individual.id, await freeSlot(individual.id, ricardoAgenda.id), person("Luis Individual"), [person("Mara Extra")]);
ok(r.status === 400 && /para una persona/.test(r.body?.error?.message), "un servicio individual no acepta otras personas", r.body);
r = await book(family.id, await freeSlot(family.id, ricardoAgenda.id), person("Nina Familia"), [person("Oscar Familia")]);
ok(r.status === 400 && /para 3 personas: faltan los datos de una de las personas/.test(r.body?.error?.message), "uno de familia con una persona de menos", r.body);

console.log("Límites");
/** Un día con al menos `needed` horas libres (sin usar en la prueba) en esa agenda, y esas horas. */
async function freeDay(serviceId: string, professionalId: string, needed: number) {
  const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
  const now = getZonedNow(profile.business.timezone);
  const service = profile.services.find((s) => s.id === serviceId)!;
  const context = scopeToProfessional({ ...profile, settings: profile.business.bookingSettings, now }, professionalId);
  for (let d = 2; d < 120; d++) {
    const date = addDaysISO(now.date, d);
    const times = getAvailableSlots(date, service.durationMinutes, context).filter((time) => !used.has(`${professionalId}|${date}|${time}`));
    // Horas que no se pisan entre sí (el servicio dura 60 minutos).
    const apart = times.filter((time, index) => index % 2 === 0);
    if (apart.length >= needed) {
      apart.slice(0, needed).forEach((time) => used.add(`${professionalId}|${date}|${time}`));
      return apart.slice(0, needed).map((time) => ({ date, time }));
    }
  }
  throw new Error("No hay días libres");
}
// Mateo tiene una sesión de pareja ese día (como el otro paciente): no reserva otra por la página.
const limitDay = await freeDay(couple.id, ricardoAgenda.id, 3);
const mateo = person("Mateo Nuevo");
r = await book(couple.id, limitDay[0], person("Lia Nueva"), [mateo]);
ok(r.status === 200, "Lia reserva una sesión de pareja con Mateo", r.body);
before = clientsCount();
r = await book(couple.id, limitDay[1], mateo, [person("Nadia Nueva")]);
ok(r.status === 409 && /^Ya tienes una cita ese día/.test(r.body?.error?.message), "Mateo ya tiene la sesión ese día: no reserva otra", r.body);
r = await book(couple.id, limitDay[2], person("Pablo Nuevo"), [mateo]);
ok(
  r.status === 409 && r.body?.error?.message.startsWith("Mateo Nuevo ya tiene una cita ese día con") && /escríbanle al negocio/.test(r.body?.error?.message),
  "ni como la otra persona de otra sesión (el mensaje lo nombra)",
  r.body,
);
ok(clientsCount() === before, "y Nadia y Pablo, que eran nuevos, no quedaron creados", clientsCount() - before);
// El tope de pacientes nuevos del día cuenta a cada persona: con 14 ya creados, la pareja de dos nuevos no entra.
const fresh = count(`select count(*) from clients where business_id = '${businessId}' and source = 'booking_page' and created_at > now() - interval '24 hours'`);
const filler = Math.max(0, 14 - fresh);
sql(`insert into clients (business_id, name, document_id, email, phone, source)
     select '${businessId}', 'Relleno ' || g, '', '', '', 'booking_page' from generate_series(1, ${filler}) g`);
before = clientsCount();
appointmentsBefore = appointmentsCount();
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), person("Quim Nuevo"), [person("Rosa Nueva")]);
ok(r.status === 429 && /no puede recibir más reservas online por hoy/.test(r.body?.error?.message), "dos pacientes nuevos cuentan dos para el tope del día", r.body);
ok(clientsCount() === before && appointmentsCount() === appointmentsBefore, "y no queda ninguno a medias");
sql(`delete from clients where business_id = '${businessId}' and name like 'Relleno %'`);
const sinceStart = appointmentsCount();
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), person("Sara Nueva"), [person("Tomas Nuevo")]);
ok(r.status === 200 && appointmentsCount() === sinceStart + 1, "la sesión cuenta como una sola cita", r.body);

console.log("Reintento");
const [xavi, yoli] = [await existing("Xavi Familia"), person("Yoli Familia")];
const zoe = person("Zoe Familia");
const familySlot = await freeSlot(family.id, ricardoAgenda.id);
r = await book(family.id, familySlot, zoe, [xavi, yoli]);
ok(r.status === 200, "una sesión de familia de 3", r.body);
const familyBooking = r.body.appointmentId;
const familyEmails = emailsOf(familyBooking).length;
before = clientsCount();
r = await book(family.id, familySlot, zoe, [yoli, xavi]);
ok(r.status === 200 && r.body.appointmentId === familyBooking, "repetida (las otras personas en otro orden): la misma confirmación", r.body);
ok(clientsCount() === before && emailsOf(familyBooking).length === familyEmails, "sin otra cita, otros pacientes ni más emails");
r = await book(family.id, familySlot, zoe, [yoli, person("Otra Persona")]);
ok(r.status === 409 && /acaba de ocuparse/.test(r.body?.error?.message) && clientsCount() === before, "con otra persona ya no es la misma reserva: la hora está ocupada", r.body);

console.log("Datos de pago en las citas del panel");
const panelSlot = await freeSlot(couple.id, ricardoAgenda.id);
r = await elena("POST", `${B}/appointments`, {
  clientId: carla.id,
  extraClientIds: [diego.id],
  serviceId: couple.id,
  date: panelSlot.date,
  startTime: panelSlot.time,
  durationMinutes: 60,
  price: 40,
  status: "confirmed",
  notes: "",
  homeVisit: null,
  isVirtual: false,
  professionalId: ricardoAgenda.id,
});
ok(r.status === 200, "recepción agenda una sesión de pareja confirmada", r.body);
const panelSession = r.body.id;
const carlaMail = bodyOf(panelSession, carla.email, "appointment_confirmed");
const diegoMail = bodyOf(panelSession, diego.email, "appointment_confirmed");
ok(/comprobante/i.test(carlaMail) && diegoMail !== "" && !/comprobante/i.test(diegoMail), "la confirmación lleva los datos de pago sólo para la principal", { carla: /comprobante/i.test(carlaMail), diego: diegoMail.slice(0, 120) });
ok(!/reservó para ti/.test(diegoMail), "y no dice que alguien la reservó (la agendó el negocio)");

console.log("Profesional con «sólo sus pacientes»");
await ricardo("PATCH", B, { professionalScope: "own" });
const hilda = await existing("Hilda Paciente");
const hidden = (res: { status: number; body: unknown }) => res.status === 404 || res.body === null;
r = await valeria("GET", `${B}/clients/${hilda.id}`);
ok(hidden(r), "Valeria no ve a Hilda (no es su paciente)", r.status);
// Alguien que sabe la cédula y el teléfono de Hilda se reserva una sesión de pareja con Valeria.
const attacker = person("Ivan Atacante");
r = await book(couple.id, await freeSlot(couple.id, valeriaAgenda.id), attacker, [{ ...person("Hilda Escrita"), documentId: hilda.documentId, phone: hilda.phone }], valeriaAgenda.id);
ok(r.status === 200, "la reserva se hace (coincide el teléfono, como con quien reserva)", r.body);
const attack = r.body.appointmentId;
ok(sql(`select client_access_pending from appointment_clients where appointment_id = '${attack}'`) === "t", "Hilda queda con el acceso pendiente");
r = await valeria("GET", `${B}/clients/${hilda.id}`);
ok(hidden(r), "Valeria sigue sin poder abrir la ficha de Hilda", r.status);
let valeriaClients = (await valeria("GET", `${B}/clients`)).body as Client[];
const shown = valeriaClients.find((c) => c.id === hilda.id);
ok(shown?.restricted === true && shown.email === "" && shown.documentId === "" && shown.phone === "", "en su lista sólo ve su nombre (para la cita)", shown);
const attackerId = sql(`select id from clients where document_id = '${attacker.documentId}' and business_id = '${businessId}'`);
r = await valeria("GET", `${B}/clients/${attackerId}`);
ok(r.status === 200, "al nuevo, creado con la reserva, sí lo ve (no tenía historia)", r.status);
r = await valeria("PATCH", `${B}/appointments/${attack}/status`, { status: "confirmed" });
ok(r.status === 200 && hidden(await valeria("GET", `${B}/clients/${hilda.id}`)), "si la confirma ella misma, sigue sin abrirla", r.body);
// Recepción la gestiona confirmándola otra vez (una confirmada ya no vuelve a Pendiente, spec 020).
r = await elena("PATCH", `${B}/appointments/${attack}/status`, { status: "confirmed" });
ok(r.status === 200, "recepción la gestiona", r.body);
r = await valeria("GET", `${B}/clients/${hilda.id}`);
ok(r.status === 200 && r.body?.id === hilda.id, "ahora sí la ve: el negocio gestionó la cita", r.status);
valeriaClients = (await valeria("GET", `${B}/clients`)).body as Client[];
ok(valeriaClients.some((c) => c.id === hilda.id && !c.restricted), "y en su lista, con sus datos");
await ricardo("PATCH", B, { professionalScope: "all" });

console.log("Aviso por ntfy");
const { bookings } = await findOnlineBookings(pool, null, new Date().toISOString(), 200);
const noticed = bookings.find((b) => b.clients[0]?.name === "Ana Existente");
ok(
  noticed?.clients.length === 2 && noticed.clients[0].newClient === false && noticed.clients[1].name === "Bruno Nuevo" && noticed.clients[1].newClient === true,
  "la reserva de Ana y Bruno trae a los dos: Ana ya era paciente y Bruno es nuevo",
  noticed?.clients,
);

console.log("Tope de emails a pacientes nuevos");
// 20 emails ya enviados a Bruno (otro paciente nuevo de una reserva cuya principal ya existía): antes no contaban.
sql(`insert into notifications (business_id, type, to_email, subject, body, appointment_id, status)
     select '${businessId}', 'booking_created', '${bruno.email}', 'Relleno', 'Relleno', '${coupleBooking}', 'sent' from generate_series(1, 20)`);
r = await book(couple.id, await freeSlot(couple.id, ricardoAgenda.id), person("Ulises Nuevo"), [person("Vera Nueva")]);
ok(r.status === 200, "la reserva se hace igual", r.body);
const held = sql(`select string_agg(status || ':' || coalesce(last_error, ''), ' | ') from notifications where appointment_id = '${r.body.appointmentId}' and type = 'booking_created'`);
ok(/failed:.*pacientes nuevos/.test(held) && !/sent|queued/.test(held), "y los emails a las dos personas nuevas quedan frenados por el tope", held);
sql(`delete from notifications where subject = 'Relleno'`);

await admin("PUT", SWITCH, { enabled: false });
await pool.end();
console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de servicios en pareja pasaron");
process.exitCode = failures ? 1 : 0;
