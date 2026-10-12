// Aviso por ntfy de cada reserva desde la página pública: una API propia con un ntfy de mentira.
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PublicBusinessProfile } from "../src/shared/types/index.ts";
import { onlineBookingAlert, type OnlineBooking } from "../src/services/booking-alerts.ts";
import { maskEmail, maskPhone, shortName } from "../src/services/masking.ts";

let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 600));
  }
};
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

console.log("Datos a medias");
ok(maskEmail("juan.perez@gmail.com") === "ju***@gmail.com", "email", maskEmail("juan.perez@gmail.com"));
ok(shortName(" Juan  pérez López ") === "Juan P." && shortName("Juan") === "Juan", "nombre", shortName(" Juan  pérez López "));
ok(maskPhone("0994445555") === "099***5555" && maskPhone("+593 99 444 5555") === "+593***5555" && maskPhone("") === "", "teléfono", maskPhone("+593 99 444 5555"));

console.log("Texto del aviso");
const booking: OnlineBooking = {
  businessId: "b1",
  businessName: "Mente Abierta",
  currency: "USD",
  serviceName: "Consulta inicial",
  durationMinutes: 60,
  price: 15,
  professionalName: "Dra. Ana Torres",
  date: "2026-10-14",
  startTime: "16:30",
  place: "business",
  status: "pending",
  newClient: true,
  client: { name: "Juan Pérez", email: "juan.perez@gmail.com", phone: "0994445555" },
  emails: [
    { type: "booking_created", to: "juan.perez@gmail.com", held: null },
    { type: "appointment_copy", to: "ana.torres@gmail.com", held: null },
    { type: "booking_received", to: "consultorio@gmail.com", held: null },
  ],
};
let alert = onlineBookingAlert(booking);
ok(alert.title === "Nueva reserva · Mente Abierta" && alert.priority === 3 && alert.click === "/admin/businesses/b1", "título, prioridad y enlace a la ficha del negocio", alert);
ok(
  alert.message ===
    [
      "Paciente nuevo: Juan P. · ju***@gmail.com · 099***5555",
      "Consulta inicial · 60 min · $15",
      "Con Dra. Ana Torres · mié 14 oct 16:30 · en el local",
      "Pendiente de confirmar",
      "",
      "Emails:",
      "• Al paciente → ju***@gmail.com",
      "• Copia al profesional → an***@gmail.com",
      "• Aviso al negocio → co***@gmail.com",
    ].join("\n"),
  "lo importante de la cita y a quién salen los emails",
  alert.message,
);
alert = onlineBookingAlert({
  ...booking,
  newClient: false,
  price: 0,
  place: "home",
  emails: [{ type: "booking_created", to: "juan.perez@gmail.com", held: "No enviado: se alcanzó el tope de 300 emails a terceros en 24 h." }],
});
ok(
  /^Ya era paciente: /.test(alert.message) && /· gratis\n/.test(alert.message) && /· a domicilio\n/.test(alert.message),
  "paciente que ya existía, cita gratis y a domicilio",
  alert.message,
);
ok(/• Al paciente → ju\*\*\*@gmail\.com \(no sale: se alcanzó el tope/.test(alert.message), "un email frenado por un tope dice que no sale y por qué", alert.message);

console.log("Al reservar por la página");
const received: { topic: string; title: string; message: string; priority: number; click: string }[] = [];
const ntfy = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push(JSON.parse(body));
    res.end("{}");
  });
});
await new Promise<void>((resolve) => ntfy.listen(0, "127.0.0.1", resolve));
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
const port = await freePort();
const api = spawn(process.execPath, ["src/server.ts"], {
  env: { ...process.env, PORT: String(port), NTFY_TOPIC: "agenda-pruebas", NTFY_SERVER: `http://127.0.0.1:${(ntfy.address() as AddressInfo).port}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiOutput: string[] = [];
api.stdout!.on("data", (chunk) => apiOutput.push(String(chunk)));
api.stderr!.on("data", (chunk) => apiOutput.push(String(chunk)));
const BASE = `http://127.0.0.1:${port}/api`;
for (let i = 0; i < 100 && !(await fetch(`${BASE}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 100));

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};
const waitFor = async (count: number) => {
  for (let i = 0; i < 50 && received.length < count; i++) await new Promise((r) => setTimeout(r, 100));
};

try {
  const profile: PublicBusinessProfile = (await call("GET", `/public/businesses/jhordan?t=${Date.now()}`)).body;
  const now = getZonedNow(profile.business.timezone);
  const context = { ...profile, settings: profile.business.bookingSettings, now };
  const service = profile.services.find((s) => s.modes.includes("business"))!;
  const agenda = profile.professionals[0];
  const slots: { date: string; time: string }[] = [];
  for (let d = 2; d < 60 && slots.length < 2; d++) {
    const date = addDaysISO(now.date, d);
    const [time] = getAvailableSlots(date, service.durationMinutes, scopeToProfessional(context, agenda.id));
    if (time) slots.push({ date, time });
  }
  const email = `alerta.ntfy.${Date.now()}@example.com`;
  const person = { documentId: cedulaFor(email), name: "Paciente Alerta Ntfy", email, phone: "+593 99 444 5555", notes: "" };
  const book = (slot: { date: string; time: string }) =>
    call("POST", "/public/businesses/jhordan/bookings", { serviceId: service.id, date: slot.date, startTime: slot.time, professionalId: agenda.id, ...person });

  let r = await book(slots[0]);
  ok(r.status === 200, "reserva por la página", r.body);
  await waitFor(1);
  const owner = sql("select u.email from users u join businesses b on b.owner_id = u.id where b.slug = 'jhordan'");
  const first = received.at(-1);
  ok(received.length === 1 && first?.topic === "agenda-pruebas" && /^Nueva reserva · /.test(first.title), "llega un aviso a ntfy al momento", received);
  ok(/^Paciente nuevo: Paciente A\. · al\*\*\*@example\.com · \+593\*\*\*5555\n/.test(first?.message ?? ""), "paciente nuevo, con sus datos a medias", first?.message);
  ok(
    (first?.message ?? "").includes(`• Al paciente → al***@example.com`) && (first?.message ?? "").includes(`• Copia al profesional → ${maskEmail(owner)}`),
    "dice a qué correo sale y a cuál la copia",
    first?.message,
  );
  ok(!(first?.message ?? "").includes(email) && !(first?.message ?? "").includes(owner) && !(first?.message ?? "").includes("444 5555"), "nunca los datos completos", first?.message);
  ok(first?.click.endsWith(`/admin/businesses/${profile.business.id}`), "abre la ficha del negocio", first?.click);
  ok(!apiOutput.join("").includes(email), "el registro de la API no lleva al paciente", apiOutput.join("").slice(-500));

  r = await book(slots[0]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  ok(r.status === 200 && received.length === 1, "el reintento de la misma reserva no avisa otra vez", { status: r.status, avisos: received.length });

  r = await book(slots[1]);
  await waitFor(2);
  ok(r.status === 200 && /^Ya era paciente: Paciente A\./.test(received.at(-1)?.message ?? ""), "otra cita del mismo paciente: «Ya era paciente»", received.at(-1)?.message);
} finally {
  api.kill("SIGTERM");
  ntfy.close();
}

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas del aviso de reservas pasaron");
process.exitCode = failures ? 1 : 0;
