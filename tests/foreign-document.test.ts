// Cualquier documento de identidad, de cualquier país (spec 038): un negocio de Ecuador acepta en el campo
// de siempre la cédula, el pasaporte o el documento de otro país (de 5 a 20 letras y números), en la
// reserva online (también para la otra persona de una sesión en pareja) y en la ficha del panel. Quien
// vuelve con el mismo documento es el mismo paciente o queda «Por verificar», como con una cédula.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, login, sql } from "./helpers/harness.ts";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PublicBusinessProfile } from "../src/shared/types/index.ts";

const { ok, done } = checks();

const ricardo = await login("ricardo@demo.com"); // propietario de la Clínica Dental Sonrisa
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const business = (await ricardo("GET", B)).body;
ok(business.timezone === "America/Guayaquil", "la clínica es de Ecuador", business.timezone);
sql(`update businesses set multi_client_appointments = true where id = '${businessId}'`);
await ricardo("PATCH", B, { bookingSettings: { ...business.bookingSettings, chooseProfessional: true, maxClientBookingsPerDay: 1, minNoticeHours: 0 } });
const agendas = (await ricardo("GET", `${B}/professionals`)).body as { id: string; displayName: string }[];
const agenda = agendas.find((p) => p.displayName === "Ricardo Paredes")!;
sql(`update professionals set all_services = true where id = '${agenda.id}'`);
const slug: string = business.slug;

const tag = Date.now().toString(36);
const digits = String(Date.now()).slice(-7);
const couple = sql(
  `insert into services (business_id, name, duration_minutes, price, people_per_session) values ('${businessId}', 'Terapia de pareja ${tag}', 60, 40, 2) returning id`,
).split("\n")[0];
let ipCounter = 10;
/** Cada reserva desde otra IP: no gasta los límites por visitante. */
const visitor = () => agent({ ip: `203.0.113.${ipCounter++ % 250}` });
const profile: PublicBusinessProfile = (await visitor()("GET", `/public/businesses/${slug}`)).body;
const single = profile.services.find((s) => s.modes.includes("business") && s.peoplePerSession === 1)!;

let seed = 500;
const person = (name: string, documentId: string) => {
  seed++;
  return { documentId, name, email: `${name.split(" ")[0].toLowerCase()}.${seed}.${tag}@correo.ec`, phone: `+593 98 ${seed} 4567` };
};
type Person = ReturnType<typeof person>;

/** Una hora libre de la agenda de Ricardo, de pasado mañana en adelante, un día distinto por reserva. */
const usedDays = new Set<string>();
async function freeSlot(serviceId: string): Promise<{ date: string; startTime: string }> {
  const current: PublicBusinessProfile = (await visitor()("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
  const now = getZonedNow(current.business.timezone);
  const service = current.services.find((s) => s.id === serviceId)!;
  const context = scopeToProfessional({ ...current, settings: current.business.bookingSettings, now }, agenda.id);
  for (let d = 2; d < 120; d++) {
    const date = addDaysISO(now.date, d);
    if (usedDays.has(date)) continue;
    const [startTime] = getAvailableSlots(date, service.durationMinutes, context);
    if (startTime) {
      usedDays.add(date);
      return { date, startTime };
    }
  }
  throw new Error("No hay horas libres");
}
const book = async (serviceId: string, main: Person, extraPatients: Person[] = []) =>
  visitor()("POST", `/public/businesses/${slug}/bookings`, {
    serviceId,
    ...(await freeSlot(serviceId)),
    professionalId: agenda.id,
    notes: "",
    ...main,
    extraPatients,
  });
const clientsWith = (documentId: string) =>
  count(`select count(*) from clients where business_id = '${businessId}' and document_id = '${documentId}'`);
const clientOf = (appointmentId: string) => sql(`select client_id from appointments where id = '${appointmentId}'`);

console.log("Reserva online con un documento de otro país");
const venezuelan = person("Ana Venezolana", `V-${digits.slice(0, 1)}.${digits.slice(1, 4)}.${digits.slice(4)}`);
let r = await book(single.id, venezuelan);
ok(r.status === 200, "una cédula venezolana, con su letra, puntos y guión: la reserva sale", r.body);
ok(clientsWith(`V${digits}`) === 1, "y se guarda en mayúsculas y sin puntos ni guiones", sql(`select document_id from clients where name = 'Ana Venezolana'`));

const passport = person("Bruno Pasaporte", `ab${digits}`);
r = await book(single.id, passport);
ok(r.status === 200 && clientsWith(`AB${digits}`) === 1, "un pasaporte en minúsculas: la reserva sale y se guarda en mayúsculas", r.body);
const passportClient = clientOf(r.body.appointmentId);

r = await book(single.id, { ...passport, documentId: `AB${digits}` });
ok(
  r.status === 200 && clientOf(r.body.appointmentId) === passportClient && clientsWith(`AB${digits}`) === 1,
  "vuelve con el mismo pasaporte y el mismo email: es el mismo paciente",
  r.body,
);
r = await book(single.id, { ...person("Otra Persona", `AB${digits}`) });
ok(
  r.status === 200 &&
    clientOf(r.body.appointmentId) !== passportClient &&
    count(`select count(*) from clients where claimed_client_id = '${passportClient}'`) === 1,
  "con el mismo pasaporte y otro email y teléfono: la reserva sale y queda «Por verificar», como con una cédula",
  r.body,
);

r = await book(single.id, person("Con Signos", "AB#12345"));
ok(r.status === 400 && /letras y números/.test(r.body.error?.message ?? ""), "con signos → 400", r.body);
r = await book(single.id, person("Muy Corto", "AB12"));
ok(r.status === 400, "con menos de 5 caracteres → 400", r.body);

console.log("Sesión en pareja");
const partner = person("Carla Extranjera", `X${digits}9`);
r = await book(couple, person("Diego Local", cedulaFor(`${tag}-pareja`)), [partner]);
ok(r.status === 200, "quien reserva con cédula ecuatoriana y la otra persona con un documento de otro país", r.body);
ok(
  clientsWith(`X${digits}9`) === 1 &&
    count(
      `select count(*) from appointment_clients ac join clients c on c.id = ac.client_id
        where ac.appointment_id = '${r.body.appointmentId}' and c.document_id = 'X${digits}9'`,
    ) === 1,
  "la otra persona queda en la cita con su ficha y su documento",
  r.body,
);

console.log("Panel");
const newClient = (name: string, documentId: string) => ({
  name,
  documentId,
  email: `${name.split(" ")[0].toLowerCase()}.${tag}@correo.ec`,
  phone: "",
  address: "",
  notes: "",
  isActive: true,
});
r = await ricardo("POST", `${B}/clients`, newClient("Elena Peruana", `pe-${digits}1`));
ok(r.status === 200 && r.body.documentId === `PE${digits}1`, "un documento de otro país en la ficha: se guarda", r.body);
r = await ricardo("POST", `${B}/clients`, newClient("Fabio Repetido", `PE${digits}1`));
ok(r.status === 409 && /Elena Peruana/.test(r.body.error?.message ?? ""), "repetido → 409 con el nombre del paciente", r.body);
const elenaClient = (await ricardo("GET", `${B}/clients`)).body.find((c: { name: string }) => c.name === "Elena Peruana");
r = await ricardo("PUT", `${B}/clients/${elenaClient.id}`, { ...elenaClient, notes: "Viene de Lima" });
ok(r.status === 200 && r.body.documentId === `PE${digits}1`, "editar su ficha conserva el documento", r.body);

done("de los documentos de otro país");
