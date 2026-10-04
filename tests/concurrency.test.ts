import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const profile = await (await fetch(`${BASE}/public/businesses/jhordan`)).json();
const service = profile.services[0];
const now = getZonedNow(profile.business.timezone);
let slot: { date: string; startTime: string } | null = null;
for (let d = 1; d < 30 && !slot; d++) {
  const date = addDaysISO(now.date, d);
  const slots = getAvailableSlots(date, service.durationMinutes, { ...profile, settings: profile.business.bookingSettings, now });
  if (slots.length) slot = { date, startTime: slots[0] };
}
console.log("hueco elegido:", slot, service.name);
const results = await Promise.all(
  [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    fetch(`${BASE}/public/businesses/jhordan/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ documentId: cedulaFor(`sim${i}@example.com`), serviceId: service.id, ...slot, name: `Simultáneo ${i}`, email: `sim${i}@example.com`, phone: "+593 99 111 5555", notes: "" }),
    }).then(async (r) => ({ status: r.status, body: await r.json() })),
  ),
);
console.log("estados:", results.map((r) => r.status).join(", "));
const winners = results.filter((r) => r.status === 200).length;
console.log(winners === 1 ? "  ✓ sólo una reserva gana" : "  ✗ más de una (o ninguna) reserva ganó");
console.log("mensaje de las rechazadas:", results.find((r) => r.status !== 200)?.body?.error?.message);
process.exitCode = winners === 1 ? 0 : 1;
