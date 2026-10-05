// Anticipación mínima de las reservas online: la elige cada profesional (de 0 a 720 horas).
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
let cookie = "";
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
      // IP propia: las reservas de esta prueba no gastan el límite por conexión de otras.
      "x-agendo-proxy-secret": process.env.PROXY_SECRET ?? "",
      "x-agendo-client-ip": "203.0.113.77",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const login = await call("POST", "/auth/login", { email: "daniela@demo.com", password: "demo1234", remember: true });
const B = `/businesses/${login.body.businessId}`;
const business = (await call("GET", B)).body;
const original = business.bookingSettings;
const setNotice = (minNoticeHours: unknown) => call("PATCH", B, { bookingSettings: { ...original, minNoticeHours } });

try {
  console.log("Configuración");
  let r = await setNotice(12);
  ok(r.status === 200 && r.body.bookingSettings.minNoticeHours === 12, "se puede pedir 12 horas (antes el mínimo era 24)", r.body);
  r = await setNotice(0);
  ok(r.status === 200 && r.body.bookingSettings.minNoticeHours === 0, "o 0: hasta justo antes de la cita", r.body);
  r = await setNotice(-1);
  ok(r.status === 400 && /negativo/.test(r.body.error.message), "negativo → 400", r.body);
  r = await setNotice(721);
  ok(r.status === 400 && /720/.test(r.body.error.message), "más de 720 horas → 400", r.body);
  r = await setNotice(1.5);
  ok(r.status === 400, "horas con decimales → 400", r.body);
  r = await call("GET", B);
  ok(r.body.bookingSettings.minNoticeHours === 0, "los valores rechazados no se guardan", r.body.bookingSettings);

  console.log("Reservas");
  const profile = (await call("GET", `/public/businesses/${business.slug}`)).body;
  ok(profile.business.bookingSettings.minNoticeHours === 0, "la página pública usa el valor del profesional", profile.business.bookingSettings);
  const service = profile.services[0];
  const now = getZonedNow(profile.business.timezone);
  let slot: { date: string; startTime: string } | null = null;
  for (let d = 0; d < 30 && !slot; d++) {
    const date = addDaysISO(now.date, d);
    const [startTime] = getAvailableSlots(date, service.durationMinutes, { ...profile, settings: profile.business.bookingSettings, now });
    if (startTime) slot = { date, startTime };
  }
  ok(slot, "hay una hora libre en los próximos días", slot);
  const booking = {
    serviceId: service.id,
    ...slot,
    documentId: cedulaFor("anticipacion@example.com"),
    name: "Cliente Anticipación",
    email: "anticipacion@example.com",
    phone: "+593 99 777 8888",
    notes: "",
  };
  await setNotice(720);
  r = await call("POST", `/public/businesses/${business.slug}/bookings`, booking);
  ok(r.status === 409, "con 720 horas, la API rechaza esa hora (lo valida el servidor, no sólo la página)", r.body);
  await setNotice(0);
  r = await call("POST", `/public/businesses/${business.slug}/bookings`, booking);
  ok(r.status === 200 && r.body.startTime === slot?.startTime, "con 0 horas, la misma hora se reserva", r.body);
} finally {
  await call("PATCH", B, { bookingSettings: original });
}

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
