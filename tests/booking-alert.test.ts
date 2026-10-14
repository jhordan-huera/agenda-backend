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
import { newClientNotice, onlineBookingNotice, panelAppointmentNotice, statusChangeNotice, type OnlineBooking } from "../src/services/booking-alerts.ts";
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

console.log("Pacientes nuevos registrados desde el panel");
const panelClient = {
  businessId: "b1",
  businessName: "Mente Abierta",
  name: "Lucía Andrade Paz",
  email: "lucia.andrade@gmail.com",
  phone: "0991234567",
  createdBy: { name: "Ana Torres", role: "professional" as const, superAdmin: false },
};
let clientNotice = newClientNotice(panelClient);
ok(
  clientNotice.title === "Agenda360: nuevo paciente" &&
    clientNotice.click === "/admin/businesses/b1" &&
    clientNotice.message === ["Mente Abierta", "Paciente nuevo: Lucía A. · lu***@gmail.com · 099***4567", "Registrado desde el panel por Ana T. (Profesional)"].join("\n"),
  "el negocio, el paciente a medias y quién lo registró (título sin el negocio)",
  clientNotice,
);
clientNotice = newClientNotice({ ...panelClient, email: "", createdBy: { name: "Soporte", role: null, superAdmin: true } });
ok(/Paciente nuevo: Lucía A\. · 099\*\*\*4567\nRegistrado desde el panel por el super admin \(modo soporte\)$/.test(clientNotice.message), "sin email, y registrado por el super admin", clientNotice.message);
clientNotice = newClientNotice({ ...panelClient, createdBy: null });
ok(clientNotice.message.endsWith("\nRegistrado desde el panel"), "sin saber quién", clientNotice.message);
const manyClients = buildBookingNotices({ panelClients: 12, clientNotices: Array.from({ length: 10 }, () => newClientNotice(panelClient)) } as never);
ok(manyClients.length === 11 && /…y 2 pacientes nuevos más/.test(manyClients[10].message), "con muchos, detalla 10 y dice cuántos faltan", manyClients.at(-1));

console.log("Citas agendadas desde el panel");
const { clients: _clients, ...bookingBase } = booking;
const panelAppointment = {
  ...bookingBase,
  status: "confirmed" as const,
  clients: [
    { name: "Juan Pérez", email: "juan.perez@gmail.com", phone: "0994445555" },
    { name: "María López Vera", email: "", phone: "0991112222" },
  ],
  createdBy: { name: "Laura Gómez", role: "staff" as const, superAdmin: false },
  emails: [
    { type: "appointment_confirmed" as const, to: "juan.perez@gmail.com", status: "sent" as const, reason: null },
    { type: "appointment_copy" as const, to: "ana.torres@gmail.com", status: "queued" as const, reason: null },
  ],
};
const appointmentNotice = panelAppointmentNotice(panelAppointment);
ok(
  appointmentNotice.title === "Agenda360: nueva cita" &&
    appointmentNotice.click === "/admin/businesses/b1" &&
    appointmentNotice.message ===
      [
        "Mente Abierta · mié 14 oct 16:30",
        "Paciente: Juan P. · ju***@gmail.com · 099***5555",
        "Paciente: María L. · 099***2222",
        "Consulta inicial · 60 min · $15",
        "Con Dra. Ana Torres · en el local",
        "Confirmada",
        "Agendada desde el panel por Laura G. (Recepción)",
        "",
        "Emails:",
        "• Al paciente → ju***@gmail.com",
        "• Copia al profesional → an***@gmail.com (en cola)",
      ].join("\n"),
  "la cita, sus pacientes a medias, quién la agendó y a quién salieron los emails",
  appointmentNotice.message,
);
ok(
  /\nCompletada\nAgendada desde el panel\n\nSin emails/.test(panelAppointmentNotice({ ...panelAppointment, status: "completed", createdBy: null, emails: [] }).message),
  "una cita ya atendida, sin saber quién y sin emails",
);
const manyAppointments = buildBookingNotices({ panelAppointments: 11, appointmentNotices: Array.from({ length: 10 }, () => appointmentNotice) } as never);
ok(manyAppointments.length === 11 && /…y 1 cita más agendadas desde el panel/.test(manyAppointments[10].message), "con muchas, detalla 10 y dice cuántas faltan", manyAppointments.at(-1));

console.log("Aviso de un cambio de estado (spec 008)");
const change = {
  businessId: "b1",
  businessName: "Mente Abierta",
  serviceName: "Consulta inicial",
  date: "2026-10-14",
  startTime: "16:30",
  from: "Confirmada",
  to: "Cancelada",
  clients: [{ name: "Juan Pérez", email: "juan.perez@gmail.com", phone: "0994445555" }],
  by: { name: "Elena Suárez", role: "staff" as const, superAdmin: false },
  withoutNotice: false,
  emails: [
    { type: "appointment_cancelled" as const, to: "juan.perez@gmail.com", status: "sent" as const, reason: null },
    { type: "appointment_copy" as const, to: "ana.torres@gmail.com", status: "queued" as const, reason: null },
  ],
};
notice = statusChangeNotice(change);
ok(
  notice.title === "Agenda360: cita cancelada" &&
    notice.message ===
      [
        "Mente Abierta · mié 14 oct 16:30",
        "Paciente: Juan P. · ju***@gmail.com · 099***5555",
        "Consulta inicial",
        "De Confirmada a Cancelada",
        "Cambiado desde el panel por Elena S. (Recepción)",
        "",
        "Emails:",
        "• Al paciente → ju***@gmail.com",
        "• Copia al profesional → an***@gmail.com (en cola)",
      ].join("\n"),
  "de qué estado a cuál, quién lo hizo y sus emails, con el paciente a medias y sin el negocio en el título",
  notice,
);
notice = statusChangeNotice({ ...change, from: "Confirmada", to: "Pendiente", withoutNotice: true, emails: [] });
ok(
  notice.title === "Agenda360: cita pendiente de confirmar" && notice.message.endsWith("Sin avisar al paciente (se desmarcó la casilla)."),
  "sin avisar al paciente: lo dice",
  notice,
);
const manyChanges = buildBookingNotices({ statusChanges: 12, statusNotices: Array.from({ length: 10 }, () => notice) } as never);
ok(manyChanges.length === 11 && /…y 2 cambios de estado más/.test(manyChanges[10].message), "con muchos, detalla 10 y dice cuántos faltan", manyChanges.at(-1));

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
let cookie = "";
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
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

  // Un paciente registrado desde el panel por el propietario.
  await call("POST", "/auth/login", { email: "jhordan@demo.com", password: "demo1234", remember: true });
  const panelEmail = `panel.ntfy.${Date.now()}@example.com`;
  r = await call("POST", `/businesses/${profile.business.id}/clients`, {
    name: "Paciente Panel Ntfy",
    documentId: cedulaFor(panelEmail),
    email: panelEmail,
    phone: "+593 99 333 2211",
    address: "",
    notes: "",
    isActive: true,
  });
  ok(r.status === 200, "el propietario registra un paciente desde el panel", r.body);
  const panelClientId = r.body.id;
  run = await runCron();
  const panelNotices = () => received.filter((n) => n.title === "Agenda360: nuevo paciente" && n.message.includes("Paciente P."));
  const panelNotice = panelNotices()[0];
  ok(run.code === 0 && panelNotices().length === 1, "el cron avisa del paciente nuevo del panel", received.map((n) => n.title));
  ok(
    panelNotice?.message === [profile.business.name, "Paciente nuevo: Paciente P. · pa***@example.com · +593***2211", "Registrado desde el panel por Jhordan H. (Propietario)"].join("\n"),
    "con quién lo registró y sus datos a medias",
    panelNotice?.message,
  );
  ok(!(panelNotice?.message ?? "").includes(panelEmail) && /pacientes nuevos del panel: 1/.test(run.output), "nunca el email completo; el registro público, sólo la cifra", run.output.slice(-400));
  ok(!received.some((n) => n.title === "Agenda360: nuevo paciente" && n.message.includes("Paciente A.")), "los de la página no se repiten: ya salen en su reserva");
  await runCron();
  ok(panelNotices().length === 1, "cada paciente se avisa una sola vez", panelNotices().length);

  // Una cita agendada desde el panel para ese paciente.
  let panelSlot: { date: string; time: string } | null = null;
  for (let d = 10; d < 90 && !panelSlot; d++) {
    const date = addDaysISO(now.date, d);
    const [time] = getAvailableSlots(date, service.durationMinutes, scopeToProfessional(context, agenda.id));
    if (time) panelSlot = { date, time };
  }
  r = await call("POST", `/businesses/${profile.business.id}/appointments`, {
    clientId: panelClientId,
    serviceId: service.id,
    professionalId: agenda.id,
    date: panelSlot!.date,
    startTime: panelSlot!.time,
    durationMinutes: service.durationMinutes,
    price: 15,
    status: "confirmed",
    notes: "",
    homeVisit: null,
    isVirtual: false,
  });
  ok(r.status === 200, "el propietario agenda una cita desde el panel", r.body);
  const panelAppointment = r.body;
  run = await runCron();
  const appointmentNotices = () => received.filter((n) => n.title === "Agenda360: nueva cita" && n.message.includes("Paciente: Paciente P."));
  const appointmentNoticeSent = appointmentNotices()[0]?.message ?? "";
  ok(run.code === 0 && appointmentNotices().length === 1, "el cron avisa de la cita agendada desde el panel", received.map((n) => n.title));
  ok(
    appointmentNoticeSent.startsWith(`${profile.business.name} · `) &&
      appointmentNoticeSent.includes("\nPaciente: Paciente P. · pa***@example.com · +593***2211\n") &&
      appointmentNoticeSent.includes("\nConfirmada\nAgendada desde el panel por Jhordan H. (Propietario)\n"),
    "con el paciente a medias y quién la agendó",
    appointmentNoticeSent,
  );
  ok(!appointmentNoticeSent.includes(panelEmail) && /citas del panel: 1/.test(run.output), "nunca el email completo; el registro público, sólo la cifra", run.output.slice(-400));
  ok(!received.some((n) => n.title === "Agenda360: nueva cita" && n.message.includes("Paciente A.")), "las reservas de la página no se repiten como citas del panel");
  await runCron();
  ok(appointmentNotices().length === 1, "cada cita se avisa una sola vez", appointmentNotices().length);

  // Cambios de estado de esa cita (spec 008): con los botones y con el formulario.
  const statusNotices = () => received.filter((n) => n.message.includes("Paciente: Paciente P.") && /\nDe \S/.test(n.message));
  r = await call("PATCH", `/businesses/${profile.business.id}/appointments/${panelAppointment.id}/status`, { status: "cancelled" });
  ok(r.status === 200, "el propietario cancela la cita", r.body);
  run = await runCron();
  const cancelledNotice = statusNotices().at(-1);
  ok(
    run.code === 0 && statusNotices().length === 1 && cancelledNotice?.title === "Agenda360: cita cancelada",
    "el cron avisa del cambio de estado",
    received.map((n) => n.title),
  );
  ok(
    (cancelledNotice?.message ?? "").includes("\nDe Confirmada a Cancelada\nCambiado desde el panel por Jhordan H. (Propietario)\n") &&
      (cancelledNotice?.message ?? "").includes("• Al paciente → pa***@example.com"),
    "de qué estado a cuál, quién lo hizo y el email de cancelación",
    cancelledNotice?.message,
  );
  ok(!(cancelledNotice?.message ?? "").includes(panelEmail) && /cambios de estado: 1/.test(run.output), "nunca el email completo; el registro público, sólo la cifra", run.output.slice(-400));
  r = await call("PUT", `/businesses/${profile.business.id}/appointments/${panelAppointment.id}`, {
    clientId: panelClientId,
    serviceId: service.id,
    professionalId: agenda.id,
    date: panelSlot!.date,
    startTime: panelSlot!.time,
    durationMinutes: service.durationMinutes,
    price: 15,
    status: "pending",
    notes: "",
    homeVisit: null,
    isVirtual: false,
  });
  ok(r.status === 200, "desde el formulario vuelve a Pendiente", r.body);
  r = await call("PATCH", `/businesses/${profile.business.id}/appointments/${panelAppointment.id}/status`, { status: "confirmed", notify: false });
  ok(r.status === 200, "y se confirma sin avisar al paciente", r.body);
  run = await runCron();
  const [fromForm, silent] = statusNotices().slice(-2);
  ok(
    statusNotices().length === 3 && fromForm?.title === "Agenda360: cita pendiente de confirmar" && fromForm.message.includes("\nDe Cancelada a Pendiente\n"),
    "el cambio hecho desde el formulario también avisa",
    statusNotices().map((n) => n.title),
  );
  ok(
    silent?.title === "Agenda360: cita confirmada" && silent.message.endsWith("Sin avisar al paciente (se desmarcó la casilla)."),
    "el que se hizo sin avisar al paciente lo dice",
    silent?.message,
  );
  await runCron();
  ok(statusNotices().length === 3, "cada cambio se avisa una sola vez", statusNotices().length);
} finally {
  ntfy.close();
}

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas del aviso de reservas pasaron");
process.exitCode = failures ? 1 : 0;
