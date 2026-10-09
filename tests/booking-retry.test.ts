// Página de reservas: repetir la misma reserva (se perdió la respuesta) devuelve la misma cita, y un
// cliente antiguo sin cédula sólo se reutiliza si coincide también el nombre (no sólo el email).
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
let ipCounter = 10;
/** Cada reserva desde una IP distinta: no se gasta el límite por conexión. */
const nextIp = () => `198.51.100.${ipCounter++}`;
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown, ip = nextIp()) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "x-agendo-proxy-secret": process.env.PROXY_SECRET ?? "",
        "x-agendo-client-ip": ip,
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

const owner = agent();
const session = (await owner("POST", "/auth/login", { email: "tomas@demo.com", password: "demo1234", remember: true })).body;
const businessId: string = session.businessId;
const business = (await owner("GET", `/businesses/${businessId}`)).body;
const visitor = agent();
const slug = business.slug;

/** Un día con al menos `count` horas libres para un servicio en el local. */
async function freeDay(count: number) {
  const profile = (await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;
  const services = profile.services.filter((s: { modes: string[] }) => s.modes.includes("business"));
  const now = getZonedNow(profile.business.timezone);
  for (let d = 2; d < 40; d++) {
    const date = addDaysISO(now.date, d);
    const slots = getAvailableSlots(date, services[0].durationMinutes, { ...profile, settings: profile.business.bookingSettings, now });
    if (slots.length >= count) return { service: services[0], other: services[1] ?? null, date, slots };
  }
  throw new Error("No hay días libres");
}
type Person = { documentId: string; name: string; email: string; phone: string; notes: string };
const book = (serviceId: string, date: string, startTime: string, who: Partial<Person>) =>
  visitor("POST", `/public/businesses/${slug}/bookings`, { serviceId, date, startTime, name: "", email: "", phone: "", notes: "", ...who });
const count = (query: string) => Number(sql(query));

console.log("La misma reserva otra vez");
const day = await freeDay(4);
const ana: Person = { documentId: cedulaFor("reintento-ana"), name: "Ana Reintento", email: "ana.reintento@correo.ec", phone: "+593 99 444 5555", notes: "" };
const first = await book(day.service.id, day.date, day.slots[0], ana);
ok(first.status === 200 && first.body.clientEmail === ana.email, "la primera vez se reserva", first.body);
const appointmentId = first.body.appointmentId;
const emailsAfterFirst = count(`select count(*) from notifications where appointment_id = '${appointmentId}'`);
const again = await book(day.service.id, day.date, day.slots[0], ana);
ok(again.status === 200 && again.body.appointmentId === appointmentId, "se perdió la respuesta y la repite: recibe la misma confirmación, no «Esa hora acaba de ocuparse»", again.body);
ok(
  again.body.date === first.body.date && again.body.startTime === first.body.startTime && again.body.emailSent === first.body.emailSent,
  "con los mismos datos",
  [first.body, again.body],
);
ok(count(`select count(*) from appointments a join clients c on c.id = a.client_id where c.document_id = '${ana.documentId}'`) === 1, "no se crea otra cita");
ok(count(`select count(*) from notifications where appointment_id = '${appointmentId}'`) === emailsAfterFirst, "ni se reenvían los emails");
const onlyDocument = await book(day.service.id, day.date, day.slots[0], { documentId: ana.documentId });
ok(
  onlyDocument.status === 200 && onlyDocument.body.appointmentId === appointmentId && onlyDocument.body.clientEmail === "an***@correo.ec",
  "con sólo la cédula, la misma cita y el email enmascarado",
  onlyDocument.body,
);
const otherPerson = await book(day.service.id, day.date, day.slots[0], {
  documentId: cedulaFor("reintento-beto"),
  name: "Beto Otro",
  email: "beto.otro@correo.ec",
  phone: "+593 99 444 6666",
});
ok(otherPerson.status !== 200 || otherPerson.body.appointmentId !== appointmentId, "otra persona a esa hora no recibe la cita de Ana", otherPerson.body);
if (day.other) {
  const otherService = await book(day.other.id, day.date, day.slots[0], ana);
  ok(otherService.status !== 200 || otherService.body.appointmentId !== appointmentId, "con otro servicio no es la misma reserva", otherService.body);
}
sql(`update appointments set created_at = now() - interval '31 minutes' where id = '${appointmentId}'`);
const later = await book(day.service.id, day.date, day.slots[0], ana);
ok(later.status === 409, "media hora después ya no se reconoce como reintento (la confirmación trae el enlace de pago)", later.body);

console.log("Un cliente antiguo sin cédula con el mismo email");
const legacy = sql(
  `insert into clients (business_id, name, email) values ('${businessId}', 'María José Pérez', 'familia.perez@correo.ec') returning id`,
).split("\n")[0];
const son = await book(day.service.id, day.date, day.slots[1], {
  documentId: cedulaFor("mateo-perez"),
  name: "Mateo Pérez",
  email: "familia.perez@correo.ec",
  phone: "+593 99 444 7777",
});
ok(son.status === 200, "el hijo reserva con el email de su madre", son.body);
ok(sql(`select document_id from clients where id = '${legacy}'`) === "", "la ficha de la madre no recibe la cédula del hijo");
const sonClient = sql(`select c.id || ' · ' || c.name from appointments a join clients c on c.id = a.client_id where a.id = '${son.body.appointmentId}'`);
ok(!sonClient.startsWith(legacy) && sonClient.endsWith("Mateo Pérez"), "el hijo tiene su propia ficha (sus citas e historia aparte)", sonClient);
const mother = await book(day.service.id, day.date, day.slots[2], {
  documentId: cedulaFor("maria-perez"),
  name: "  maria jose PEREZ ",
  email: "familia.perez@correo.ec",
  phone: "+593 99 444 7777",
});
ok(mother.status === 200, "la madre reserva escribiendo su nombre sin tildes ni mayúsculas", mother.body);
ok(
  sql(`select client_id from appointments where id = '${mother.body.appointmentId}'`) === legacy &&
    sql(`select document_id from clients where id = '${legacy}'`) === cedulaFor("maria-perez"),
  "con el mismo nombre sí es ella: su ficha antigua recibe su cédula",
);
ok(count(`select count(*) from clients where business_id = '${businessId}' and email = 'familia.perez@correo.ec'`) === 2, "dos fichas, una por persona");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de reintentos de reserva pasaron");
process.exitCode = failures ? 1 : 0;
