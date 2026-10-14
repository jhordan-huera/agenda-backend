// Aviso por ntfy de cada reserva desde la página pública: lo envía el cron (scripts/cron.ts) en su
// pasada, contra la base de pruebas y un ntfy de mentira.
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cedulaFor } from "./helpers/cedula.mjs";
import { buildBookingNotices } from "../scripts/cron.ts";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PublicBusinessProfile } from "../src/shared/types/index.ts";
import { onlineBookingNotice, type OnlineBooking } from "../src/services/booking-alerts.ts";
import { maskEmail, maskPhone, shortName } from "../src/services/masking.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
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
  clients: [{ name: "Juan Pérez", email: "juan.perez@gmail.com", phone: "0994445555", newClient: true }],
  emails: [
    { type: "booking_created", to: "juan.perez@gmail.com", status: "sent", reason: null },
    { type: "appointment_copy", to: "ana.torres@gmail.com", status: "sent", reason: null },
    { type: "booking_received", to: "consultorio@gmail.com", status: "queued", reason: null },
  ],
};
let notice = onlineBookingNotice(booking);
ok(
  notice.title === "Agenda360: nueva reserva" && notice.priority === 3 && notice.click === "/admin/businesses/b1",
  "título sin el negocio (el registro de Actions es público) y enlace a la ficha del negocio",
  notice,
);
ok(
  notice.message ===
    [
      "Mente Abierta · mié 14 oct 16:30",
      "Paciente nuevo: Juan P. · ju***@gmail.com · 099***5555",
      "Consulta inicial · 60 min · $15",
      "Con Dra. Ana Torres · en el local",
      "Pendiente de confirmar",
      "",
      "Emails:",
      "• Al paciente → ju***@gmail.com",
      "• Copia al profesional → an***@gmail.com",
      "• Aviso al negocio → co***@gmail.com (en cola)",
    ].join("\n"),
  "lo importante de la cita y a quién salieron los emails",
  notice.message,
);
notice = onlineBookingNotice({
  ...booking,
  clients: [{ ...booking.clients[0], newClient: false }],
  price: 0,
  place: "home",
  emails: [{ type: "booking_created", to: "juan.perez@gmail.com", status: "failed", reason: "No enviado: se alcanzó el tope de 300 emails a terceros en 24 h." }],
});
ok(/\nYa era paciente: /.test(notice.message) && /· gratis\n/.test(notice.message) && /· a domicilio\n/.test(notice.message), "paciente que ya existía, gratis y a domicilio", notice.message);
ok(/• Al paciente → ju\*\*\*@gmail\.com \(no salió: se alcanzó el tope/.test(notice.message), "un email que no salió dice por qué", notice.message);
notice = onlineBookingNotice({ ...booking, emails: [{ type: "booking_created", to: "juan.perez@gmail.com", status: "failed", reason: "550 juan.perez@gmail.com no existe" }] });
ok(!notice.message.includes("juan.perez@gmail.com"), "sin el email completo aunque venga en el error de Gmail", notice.message);
notice = onlineBookingNotice({
  ...booking,
  clients: [...booking.clients, { name: "María López Vera", email: "maria.lopez@gmail.com", phone: "0991112222", newClient: false }],
});
ok(
  notice.message.includes("\nPaciente nuevo: Juan P. · ju***@gmail.com · 099***5555\nYa era paciente: María L. · ma***@gmail.com · 099***2222\n"),
  "sesión en pareja: una línea por persona, quien reservó primero y todo a medias",
  notice.message,
);
const more = buildBookingNotices({ onlineBookings: 13, bookingNotices: Array.from({ length: 10 }, () => onlineBookingNotice(booking)) } as never);
ok(more.length === 11 && /…y 3 reservas más/.test(more[10].message), "con muchas, detalla 10 y dice cuántas faltan", more.at(-1));

console.log("En la pasada del cron");
const received: { topic: string; title: string; message: string; priority: number; click?: string }[] = [];
const ntfy = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push(JSON.parse(body));
    res.end("{}");
  });
});
await new Promise<void>((resolve) => ntfy.listen(0, "127.0.0.1", resolve));
const runCron = () =>
  new Promise<{ code: number | null; output: string }>((resolve) => {
    let output = "";
    const child = spawn(process.execPath, ["scripts/cron.ts"], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DATABASE_SSL: "false",
        FRONTEND_URL: "https://agendo.example",
        LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
        NTFY_TOPIC: "agendo-pruebas",
        NTFY_SERVER: `http://127.0.0.1:${(ntfy.address() as AddressInfo).port}`,
        APP_URL: "https://agendo.example",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => resolve({ code, output }));
  });
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

try {
  // Lo de antes ya contado: la prueba sólo mira las reservas que hace ella.
  await runCron();
  received.length = 0;

  const profile: PublicBusinessProfile = (await call("GET", `/public/businesses/jhordan?t=${Date.now()}`)).body;
  const now = getZonedNow(profile.business.timezone);
  const context = { ...profile, settings: profile.business.bookingSettings, now };
  const service = profile.services.find((s) => s.modes.includes("business"))!;
  const agenda = profile.professionals[0];
  const slots: { date: string; time: string }[] = [];
  for (let d = 3; d < 60 && slots.length < 2; d++) {
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
  ok(received.length === 0, "la API no avisa: no necesita NTFY_TOPIC en Vercel ni en Lambda", received);
  let run = await runCron();
  const owner = sql("select u.email from users u join businesses b on b.owner_id = u.id where b.slug = 'jhordan'");
  const mine = () => received.filter((n) => n.title === "Agenda360: nueva reserva" && n.message.includes("Paciente A."));
  const first = mine()[0];
  ok(run.code === 0 && mine().length === 1, "el cron manda un aviso por la reserva", { code: run.code, received });
  ok(new RegExp(`^${profile.business.name} · `).test(first?.message ?? ""), "empieza por el negocio y cuándo es", first?.message);
  ok(/\nPaciente nuevo: Paciente A\. · al\*\*\*@example\.com · \+593\*\*\*5555\n/.test(first?.message ?? ""), "paciente nuevo, con sus datos a medias", first?.message);
  ok(
    (first?.message ?? "").includes("• Al paciente → al***@example.com") && (first?.message ?? "").includes(`• Copia al profesional → ${maskEmail(owner)}`),
    "dice a qué correo salió y a cuál la copia",
    first?.message,
  );
  ok(!(first?.message ?? "").includes(email) && !(first?.message ?? "").includes(owner) && !(first?.message ?? "").includes("444 5555"), "nunca los datos completos", first?.message);
  ok(first?.click === `https://agendo.example/admin/businesses/${profile.business.id}`, "abre la ficha del negocio", first?.click);
  ok(!run.output.includes("@") && !run.output.includes(profile.business.name) && /reservas por la página: 1/.test(run.output), "el registro público sólo lleva cifras", run.output.slice(-600));

  r = await book(slots[0]);
  run = await runCron();
  ok(r.status === 200 && mine().length === 1, "el reintento de la misma reserva no avisa otra vez", mine().length);

  r = await book(slots[1]);
  await runCron();
  ok(r.status === 200 && mine().length === 2 && /\nYa era paciente: Paciente A\./.test(mine()[1]?.message ?? ""), "otra cita del mismo paciente: «Ya era paciente»", mine()[1]?.message);
  await runCron();
  ok(mine().length === 2, "cada reserva se avisa una sola vez", mine().length);

} finally {
  ntfy.close();
}

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas del aviso de reservas pasaron");
process.exitCode = failures ? 1 : 0;
