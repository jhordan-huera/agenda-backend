// Doble reserva: nunca dos citas a la misma hora, y una misma persona (su cédula) no reserva desde
// la página más citas al día de las que permite el negocio.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
/** Cada grupo de reservas desde una IP distinta: no se gasta el límite por conexión. */
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
const B = `/businesses/${session.businessId}`;
const business = (await owner("GET", B)).body;
const original = business.bookingSettings;
const setLimit = (maxClientBookingsPerDay: unknown) =>
  owner("PATCH", B, { bookingSettings: { ...original, minNoticeHours: 0, maxClientBookingsPerDay } });
const visitor = agent();
const slug = business.slug;
const profileNow = async () => (await visitor("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body;

/** Días con al menos `count` horas libres para el servicio. */
async function freeDay(count: number, after?: string) {
  const profile = await profileNow();
  const service = profile.services.find((s: { location: string }) => s.location !== "home");
  const now = getZonedNow(profile.business.timezone);
  for (let d = 1; d < 40; d++) {
    const date = addDaysISO(now.date, d);
    if (after && date <= after) continue;
    const slots = getAvailableSlots(date, service.durationMinutes, { ...profile, settings: profile.business.bookingSettings, now });
    if (slots.length >= count) return { service, date, slots };
  }
  throw new Error("No hay días libres");
}
const person = (seed: string) => ({
  documentId: cedulaFor(`${seed}@example.com`),
  name: `Cliente ${seed}`,
  email: `${seed}@example.com`,
  phone: "+593 99 444 5555",
  notes: "",
});
const book = (serviceId: string, date: string, startTime: string, who: ReturnType<typeof person>) =>
  visitor("POST", `/public/businesses/${slug}/bookings`, { serviceId, date, startTime, ...who });

try {
  console.log("Ajuste del negocio");
  ok(original.maxClientBookingsPerDay === 1, "por defecto, 1 cita por día por persona", original);
  let r = await setLimit(11);
  ok(r.status === 400, "más de 10 → 400", r.body);
  r = await setLimit(-1);
  ok(r.status === 400, "negativo → 400", r.body);
  r = await setLimit(1);
  ok(r.status === 200 && r.body.bookingSettings.maxClientBookingsPerDay === 1, "se guarda", r.body?.bookingSettings);

  console.log("Una cita por día (lo habitual)");
  let day = await freeDay(4);
  const ana = person("limite-ana");
  r = await book(day.service.id, day.date, day.slots[0], ana);
  ok(r.status === 200, "la primera cita del día se reserva", r.body);
  r = await book(day.service.id, day.date, day.slots[2], ana);
  ok(r.status === 409 && r.body.error.code === "daily_limit" && /Ya tienes una cita ese día/.test(r.body.error.message), "la misma persona no reserva otra ese día", r.body);
  ok(!JSON.stringify(r.body).includes(day.slots[0]), "el aviso no revela a qué hora es su otra cita", r.body);
  r = await book(day.service.id, day.date, day.slots[2], person("limite-beto"));
  ok(r.status === 200, "otra persona sí puede ese día", r.body);
  const nextDay = await freeDay(1, day.date);
  r = await book(nextDay.service.id, nextDay.date, nextDay.slots[0], ana);
  ok(r.status === 200, "y la misma persona sí puede otro día", r.body);

  console.log("Desde el panel no hay límite");
  const anaClient = (await owner("GET", `${B}/clients`)).body.find((c: { email: string }) => c.email === ana.email);
  day = await freeDay(2);
  r = await owner("POST", `${B}/appointments`, {
    clientId: anaClient.id,
    serviceId: day.service.id,
    date: day.date,
    startTime: day.slots.at(-1),
    endTime: null,
    durationMinutes: day.service.durationMinutes,
    status: "confirmed",
    notes: "",
    price: day.service.price,
    homeVisit: null,
  });
  const panelOk = r.status === 200;
  ok(panelOk, "el profesional le agenda las que quiera desde el panel", r.body);

  console.log("Una cancelada no cuenta");
  day = await freeDay(3);
  const caro = person("limite-caro");
  r = await book(day.service.id, day.date, day.slots[0], caro);
  const first = r.body;
  await owner("PATCH", `${B}/appointments/${first.appointmentId}/status`, { status: "cancelled" });
  r = await book(day.service.id, day.date, day.slots[1], caro);
  ok(r.status === 200, "tras cancelar, puede volver a reservar ese día", r.body);

  console.log("Límites del negocio");
  await setLimit(2);
  day = await freeDay(5);
  const dani = person("limite-dani");
  const r1 = await book(day.service.id, day.date, day.slots[0], dani);
  const r2 = await book(day.service.id, day.date, day.slots[2], dani);
  const r3 = await book(day.service.id, day.date, day.slots[4], dani);
  ok(r1.status === 200 && r2.status === 200 && r3.status === 409 && /Ya tienes 2 citas/.test(r3.body.error.message), "con 2 por día: la tercera no", [r1.status, r2.status, r3.body]);
  await setLimit(0);
  r = await book(day.service.id, day.date, day.slots[4], dani);
  ok(r.status === 200, "sin límite (0): reserva las que quiera", r.body);

  console.log("A la vez");
  await setLimit(1);
  day = await freeDay(4);
  const eva = person("limite-eva");
  const together = await Promise.all([0, 1, 2, 3].map((i) => book(day.service.id, day.date, day.slots[i], eva)));
  ok(together.filter((x) => x.status === 200).length === 1, "4 reservas simultáneas de la misma persona ese día: sólo entra una", together.map((x) => x.status));
  const strangers = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => book(day.service.id, day.date, day.slots.at(-1)!, person(`limite-misma-hora-${i}`))));
  ok(strangers.filter((x) => x.status === 200).length === 1, "6 personas distintas a la misma hora a la vez: sólo una", strangers.map((x) => x.status));
  const overlaps = sql(`select count(*) from appointments a join appointments b on a.id < b.id and a.business_id = b.business_id
    and a.professional_id = b.professional_id and a.date = b.date and a.start_time < b.end_time and b.start_time < a.end_time
    where a.status in ('pending','confirmed','completed') and b.status in ('pending','confirmed','completed')`);
  ok(overlaps === "0", "en toda la base no hay dos citas activas que se solapen", overlaps);

  console.log("Migración 021");
  sql(`update businesses set booking_settings = booking_settings - 'maxClientBookingsPerDay' where id = '${session.businessId}'`);
  const migration = readFileSync(new URL("../db/migrations/021_client_daily_limit.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  sql(migration);
  ok((await owner("GET", B)).body.bookingSettings.maxClientBookingsPerDay === 1, "activa 1 por día en los negocios que ya existían");
  await setLimit(3);
  sql(migration);
  ok((await owner("GET", B)).body.bookingSettings.maxClientBookingsPerDay === 3, "y respeta lo que un negocio ya hubiera elegido");
} finally {
  await owner("PATCH", B, { bookingSettings: original });
}

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
