// Modalidades de los servicios (en el local, a domicilio, virtual), citas por videollamada con el enlace
// del profesional y precio "Gratis".
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PublicBusinessProfile } from "../src/shared/types/index.ts";

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
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "x-agendo-proxy-secret": process.env.PROXY_SECRET ?? "",
        "x-agendo-client-ip": `198.51.100.${ipCounter++ % 250}`,
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
const session = (await owner("POST", "/auth/login", { email: "jhordan@demo.com", password: "demo1234", remember: true })).body;
const B = `/businesses/${session.businessId}`;
const business = (await owner("GET", B)).body;
await owner("PATCH", B, { bookingSettings: { ...business.bookingSettings, minNoticeHours: 0, maxClientBookingsPerDay: 0 } });
const visitor = agent();

console.log("Servicios");
const base = { description: "", durationMinutes: 45, homeVisitFee: 0, clinicalTemplateId: null, isActive: true };
let r = await owner("POST", `${B}/services`, { ...base, name: "Sin modalidad", price: 10, showPrice: true, modes: [] });
ok(r.status === 400 && /modalidad/.test(r.body.error.message), "sin modalidad → 400", r.body);
r = await owner("POST", `${B}/services`, { ...base, name: "Terapia online", price: 0, showPrice: true, modes: ["virtual"] });
ok(r.status === 200 && r.body.modes.join() === "virtual" && r.body.price === 0 && r.body.showPrice, "servicio virtual y gratis", r.body);
const online = r.body;
r = await owner("POST", `${B}/services`, { ...base, name: "Consulta mixta", price: 30, showPrice: true, modes: ["business", "virtual"] });
ok(r.status === 200 && r.body.modes.join() === "business,virtual", "servicio en el local o virtual", r.body);
const mixed = r.body;
r = await owner("POST", `${B}/services`, { ...base, name: "Precio a consultar", price: 50, showPrice: false, modes: ["business"] });
const hidden = r.body;

console.log("Enlace de videollamada");
const [professional] = (await owner("GET", `${B}/professionals`)).body;
const professionalInput = (meetingUrl: string) => ({
  displayName: professional.displayName,
  title: professional.title,
  avatarUrl: professional.avatarUrl,
  color: professional.color,
  email: professional.email,
  userId: professional.userId,
  allServices: true,
  serviceIds: [],
  notifyNewAppointments: true,
  dailyAgenda: true,
  isActive: true,
  meetingUrl,
});
r = await owner("PUT", `${B}/professionals/${professional.id}`, professionalInput("meet.google.com/abc"));
ok(r.status === 400 && /https/.test(r.body.error.message), "enlace sin https:// → 400", r.body);
r = await owner("PUT", `${B}/professionals/${professional.id}`, professionalInput("https://meet.google.com/abc-defg-hij"));
ok(r.status === 200 && r.body.meetingUrl === "https://meet.google.com/abc-defg-hij", "el profesional guarda su sala", r.body);

console.log("Página de reservas");
const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${business.slug}?t=${Date.now()}`)).body;
const publicOnline = profile.services.find((s) => s.id === online.id)!;
const publicHidden = profile.services.find((s) => s.id === hidden.id)!;
ok(publicOnline.showPrice && publicOnline.price === 0, "el servicio gratis llega visible con precio 0 («Gratis»)", publicOnline);
ok(!publicHidden.showPrice && publicHidden.price === 0, "el de precio a consultar no envía su precio", publicHidden);
ok(!("meetingUrl" in profile.professionals[0]), "la sala no sale en la página pública", profile.professionals[0]);
const now = getZonedNow(profile.business.timezone);
const context = { ...profile, settings: profile.business.bookingSettings, now };
const slots: { date: string; startTime: string }[] = [];
for (let d = 1; d < 40 && slots.length < 4; d++) {
  const date = addDaysISO(now.date, d);
  for (const startTime of getAvailableSlots(date, 45, scopeToProfessional(context, professional.id)).slice(0, 4 - slots.length)) {
    slots.push({ date, startTime });
  }
}
const person = (seed: string) => ({ documentId: cedulaFor(`${seed}@example.com`), name: `Cliente ${seed}`, email: `${seed}@example.com`, phone: "+593 99 444 5555", notes: "" });
const book = (body: object) => visitor("POST", `/public/businesses/${business.slug}/bookings`, body);
const visit = { address: "Av. Amazonas N34-120", reference: "", lat: -0.18, lng: -78.47 };
r = await book({ serviceId: online.id, ...slots[0], ...person("virtual0") });
ok(r.status === 400 && /cómo quieres la cita/.test(r.body.error.message), "servicio sólo virtual sin elegir virtual → 400", r.body);
r = await book({ serviceId: online.id, ...slots[0], ...person("virtual1"), isVirtual: true });
ok(
  r.status === 200 && r.body.isVirtual && r.body.meetingUrl === "https://meet.google.com/abc-defg-hij" && r.body.price === 0 && r.body.showPrice,
  "reserva virtual: la confirmación trae la sala y el precio gratis",
  r.body,
);
const email = sql(`select body from notifications where to_email = 'virtual1@example.com' order by created_at desc limit 1`);
ok(/meet\.google\.com\/abc-defg-hij/.test(email) && /Gratis/.test(email) && /Virtual/.test(email), "el email lleva la videollamada y «Gratis»", email.slice(0, 300));
ok(/Hora: \d\d:\d\d – \d\d:\d\d \(hora de Ecuador, GMT-5\)/.test(email), "y la hora con la zona del negocio (el paciente puede estar en otro país)", email.slice(0, 400));
r = await book({ serviceId: mixed.id, ...slots[1], ...person("mixed1"), homeVisit: visit });
ok(r.status === 400 && /domicilio/.test(r.body.error.message), "local o virtual: a domicilio → 400", r.body);
r = await book({ serviceId: mixed.id, ...slots[1], ...person("mixed2"), isVirtual: true, homeVisit: visit });
ok(r.status === 400, "virtual y a domicilio a la vez → 400", r.body);
r = await book({ serviceId: mixed.id, ...slots[1], ...person("mixed3") });
ok(r.status === 200 && !r.body.isVirtual && r.body.meetingUrl === null, "local o virtual: en el local", r.body);
const localEmail = sql(`select body from notifications where to_email = 'mixed3@example.com' order by created_at desc limit 1`);
ok(localEmail && !/hora de /.test(localEmail), "en el local, la hora va sin zona", localEmail.slice(0, 300));
r = await book({ serviceId: hidden.id, ...slots[2], ...person("hidden1") });
const hiddenEmail = sql(`select body from notifications where to_email = 'hidden1@example.com' order by created_at desc limit 1`);
ok(r.status === 200 && !/Precio:/.test(hiddenEmail), "precio a consultar: el email no habla de precio", hiddenEmail.slice(0, 300));

console.log("Panel");
const clients = (await owner("GET", `${B}/clients`)).body;
const client = clients.find((c: { email: string }) => c.email) ?? clients[0];
const appointment = { clientId: client.id, serviceId: mixed.id, ...slots[3], durationMinutes: 45, price: 30, status: "confirmed", notes: "" };
r = await owner("POST", `${B}/appointments`, { ...appointment, isVirtual: true, homeVisit: { ...visit } });
ok(r.status === 400, "cita virtual y a domicilio → 400", r.body);
r = await owner("POST", `${B}/appointments`, { ...appointment, isVirtual: true });
ok(r.status === 200 && r.body.isVirtual === true, "cita virtual desde el panel", r.body);
r = await owner("PUT", `${B}/appointments/${r.body.id}`, { ...appointment, isVirtual: false });
ok(r.status === 200 && r.body.isVirtual === false, "pasarla al local", r.body);
const changes = (await owner("GET", `${B}/audit-logs?entityId=${r.body.id}`)).body.entries[0]?.changes ?? [];
ok(changes.some((c: { label: string; before: string; after: string }) => c.label === "Modalidad" && c.before === "Virtual" && c.after === "En el local"), "la actividad dice el cambio de modalidad", changes);
const modeNotices = Number(sql(`select count(*) from notifications where appointment_id = '${r.body.id}' and type = 'appointment_updated'`));
ok(modeNotices === (client.email ? 1 : 0), "y al paciente se le avisa que ya no es por videollamada", { email: client.email, modeNotices });

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
