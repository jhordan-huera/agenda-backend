import { cedulaFor } from "./helpers/cedula.mjs";
// Pruebas de la función "a domicilio" contra la API de prueba.
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
async function call(method: string, path: string, body?: any) {
  if (body && typeof body === "object" && "documentId" in body && body.documentId === undefined) body = { ...body, documentId: cedulaFor(body.email) };
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const profile = (await call("GET", "/public/businesses/fisioactiva")).body;
const both = profile.services.find((s: { location: string }) => s.location === "both");
ok(both && both.homeVisitFee === 10 && both.showPrice === true, "perfil público con lugar, recargo y precio visible", both);
const now = getZonedNow(profile.business.timezone);
const freeSlots = (count: number) => {
  const out: { date: string; startTime: string }[] = [];
  for (let d = 1; d < 40 && out.length < count; d++) {
    const date = addDaysISO(now.date, d);
    for (const startTime of getAvailableSlots(date, both.durationMinutes, { ...profile, settings: profile.business.bookingSettings, now })) {
      out.push({ date, startTime });
      if (out.length === count) break;
    }
  }
  return out;
};
const [slotA, slotB] = freeSlots(2);
const person = { name: "Cliente Domicilio", email: "domicilio@example.com", phone: "+593 99 222 3333", notes: "" };
const visit = { address: "Av. Remigio Crespo 5-20, Cuenca", reference: "Casa azul", lat: -2.9, lng: -79.0 };

console.log("Reserva pública a domicilio");
let r = await call("POST", "/public/businesses/fisioactiva/bookings", { documentId: undefined, serviceId: both.id, ...slotA, ...person, homeVisit: { ...visit, lat: null, lng: null } });
ok(r.status === 400 && /mapa/.test(r.body.error.message), "a domicilio sin punto en el mapa → 400", r.body);
r = await call("POST", "/public/businesses/fisioactiva/bookings", { documentId: undefined, serviceId: both.id, ...slotA, ...person, homeVisit: visit });
ok(r.status === 200 && r.body.price === both.price + 10 && r.body.homeVisit?.lat === -2.9 && r.body.showPrice === true, "reserva a domicilio con recargo", r.body);
r = await call("POST", "/public/businesses/fisioactiva/bookings", { documentId: undefined, serviceId: both.id, ...slotB, ...person, email: "local@example.com" });
ok(r.status === 200 && r.body.price === both.price && r.body.homeVisit === null, "mismo servicio en el local, sin recargo", r.body);

const jhordan = (await call("GET", "/public/businesses/jhordan")).body;
const homeOnly = jhordan.services.find((s: { location: string }) => s.location === "home");
const localOnly = jhordan.services.find((s: { location: string }) => s.location === "business");
const nowJ = getZonedNow(jhordan.business.timezone);
let slotJ: { date: string; startTime: string } | null = null;
for (let d = 1; d < 40 && !slotJ; d++) {
  const date = addDaysISO(nowJ.date, d);
  const slots = getAvailableSlots(date, homeOnly.durationMinutes, { ...jhordan, settings: jhordan.business.bookingSettings, now: nowJ });
  if (slots.length) slotJ = { date, startTime: slots[0] };
}
r = await call("POST", "/public/businesses/jhordan/bookings", { documentId: undefined, serviceId: homeOnly.id, ...slotJ, ...person });
ok(r.status === 400 && /mapa/.test(r.body.error.message), "servicio sólo a domicilio sin dirección → 400", r.body);
r = await call("POST", "/public/businesses/jhordan/bookings", { documentId: undefined, serviceId: localOnly.id, ...slotJ, ...person, homeVisit: visit });
ok(r.status === 400 && /no se realiza a domicilio/.test(r.body.error.message), "servicio sólo en el local con dirección → 400", r.body);

console.log("Panel");
r = await call("POST", "/auth/login", { email: "tomas@demo.com", password: "demo1234", remember: true });
const B = `/businesses/${r.body.businessId}`;
r = await call("GET", `${B}/clients`);
const bookedClient = r.body.find((c: { email: string }) => c.email === "domicilio@example.com");
r = await call("GET", `${B}/appointments?from=${slotA.date}&to=${slotA.date}&clientId=${bookedClient?.id}`);
const booked = r.body.find((a: { startTime: string }) => a.startTime === slotA.startTime);
ok(booked?.homeVisit?.reference === "Casa azul" && booked.source === "booking_page", "la cita a domicilio aparece en la agenda", booked);
r = await call("GET", `${B}/clients`);
const created = r.body.find((c: { email: string }) => c.email === "domicilio@example.com");
ok(created?.address === visit.address, "la dirección queda en la ficha del cliente nuevo", created);
r = await call("POST", `${B}/services`, { name: "Masaje a domicilio", description: "", durationMinutes: 60, price: 40, showPrice: false, location: "home", homeVisitFee: 5, isActive: true });
ok(r.status === 200 && r.body.showPrice === false && r.body.location === "home" && r.body.homeVisitFee === 5, "crear servicio a domicilio con precio oculto", r.body);
const hidden = r.body;
r = await call("PUT", `${B}/services/${hidden.id}`, { ...hidden, showPrice: true, location: "both", homeVisitFee: 7.5 });
ok(r.body?.showPrice === true && r.body.homeVisitFee === 7.5, "editar lugar, recargo y precio visible", r.body);
r = await call("POST", `${B}/services`, { name: "Sin campos nuevos", description: "", durationMinutes: 30, price: 10, isActive: true });
ok(r.body?.showPrice === true && r.body.location === "business" && r.body.homeVisitFee === 0, "valores por defecto si no se envían", r.body);
const client = created;
const [slotC] = freeSlots(3).slice(2);
r = await call("POST", `${B}/appointments`, { clientId: client.id, serviceId: hidden.id, ...slotC, durationMinutes: 60, price: 45, status: "confirmed", notes: "", homeVisit: { address: "Calle Larga 1-23", reference: "", lat: null, lng: null } });
ok(r.status === 200 && r.body.homeVisit?.address === "Calle Larga 1-23" && r.body.homeVisit.lat === null, "cita a domicilio desde el panel (sin coordenadas)", r.body);
const apptId = r.body.id;
r = await call("PUT", `${B}/appointments/${apptId}`, { clientId: client.id, serviceId: hidden.id, ...slotC, durationMinutes: 60, price: 45, status: "confirmed", notes: "", homeVisit: null });
ok(r.status === 200 && r.body.homeVisit === null, "pasar la cita al local", r.body);
r = await call("GET", `${B}/notifications`);
const confirmation = r.body.find((n: { appointmentId: string; type: string }) => n.appointmentId === apptId && n.type === "appointment_confirmed");
ok(confirmation && /Precio: \$45/.test(confirmation.body) && /a domicilio/i.test(confirmation.body), "email con precio y lugar a domicilio", confirmation?.body);
const received = r.body.find((n: { type: string; body: string }) => n.type === "booking_received" && /a domicilio/i.test(n.body));
ok(received && /Ubicación: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-2\.9,-79/.test(received.body), "el negocio recibe el enlace al punto del mapa", received?.body);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de domicilio pasaron");
process.exitCode = failures ? 1 : 0;
