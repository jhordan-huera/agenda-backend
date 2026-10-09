// Varias agendas (plan Business): profesionales con su horario y sus servicios, rol Profesional que sólo
// ve lo suyo, reservas online con "el primero disponible", llegada del paciente, avisos al profesional
// y agendas contratadas.
import { execFileSync } from "node:child_process";
import { cedulaFor } from "./helpers/cedula.mjs";
import { getAvailableSlots, getAvailableSlotsForAny, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { Appointment, Professional, PublicBusinessProfile, Schedule } from "../src/shared/types/index.ts";

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
const login = async (email: string) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: "demo1234", remember: true })).body;
  return { a, session };
};

const { a: ricardo, session: rs } = await login("ricardo@demo.com"); // propietario, Business, 3 agendas
const { a: elena } = await login("elena@demo.com"); // Recepción
const { a: valeria, session: vs } = await login("valeria@demo.com"); // Profesional
const { a: admin } = await login("admin@demo.com");
const B = `/businesses/${rs.businessId}`;
const business = (await ricardo("GET", B)).body;
const visitor = agent();

console.log("Profesionales");
let professionals: Professional[] = (await ricardo("GET", `${B}/professionals`)).body;
ok(professionals.length === 3 && professionals.every((p) => p.isActive), "la clínica tiene 3 agendas activas", professionals.map((p) => p.displayName));
const [ricardoAgenda, valeriaAgenda, andres] = professionals;
ok(valeriaAgenda.userId === vs.userId && vs.professionalId === valeriaAgenda.id, "la sesión de Valeria trae su agenda", vs);
ok(rs.professionalId === ricardoAgenda.id, "y la del propietario la suya", rs.professionalId);
ok((await elena("GET", `${B}/professionals`)).status === 200, "recepción ve los profesionales (para el calendario)");
const newProfessional = {
  displayName: "Dra. Paula Ríos",
  title: "Endodoncista",
  avatarUrl: null,
  color: "#aa5500",
  email: "paula@example.com",
  userId: null,
  allServices: true,
  serviceIds: [],
  notifyNewAppointments: true,
  dailyAgenda: true,
  isActive: true,
};
let r = await elena("POST", `${B}/professionals`, newProfessional);
ok(r.status === 403, "recepción no crea profesionales", r.body);
r = await valeria("POST", `${B}/professionals`, newProfessional);
ok(r.status === 403, "el rol Profesional tampoco", r.body);
r = await ricardo("POST", `${B}/professionals`, newProfessional);
ok(r.status === 402 && /3 agendas/.test(r.body.error.message), "con 3 agendas contratadas, la cuarta activa no entra", r.body);
r = await ricardo("POST", `${B}/professionals`, { ...newProfessional, isActive: false });
ok(r.status === 200 && r.body.isActive === false, "inactiva sí se puede crear", r.body);
const paula: Professional = r.body;
const paulaSchedules: Schedule[] = (await ricardo("GET", `${B}/schedules`)).body.filter((s: Schedule) => s.professionalId === paula.id);
ok(paulaSchedules.length === 7, "la agenda nueva arranca con el horario del primer profesional", paulaSchedules.length);
r = await ricardo("PUT", `${B}/professionals/${paula.id}`, { ...newProfessional });
ok(r.status === 402, "y no se puede reactivar sin cupo", r.body);
r = await admin("PUT", `/admin/businesses/${rs.businessId}/max-professionals`, { maxProfessionals: 4 });
ok(r.status === 200 && r.body.maxProfessionals === 4, "el super admin sube las agendas contratadas a 4", r.body);
r = await ricardo("PUT", `${B}/professionals/${paula.id}`, { ...newProfessional });
ok(r.status === 200 && r.body.isActive, "ahora sí se reactiva", r.body);
r = await ricardo("GET", `${B}/subscription/usage`);
ok(r.body.limits.professionals === 4 && r.body.professionals === 4, "el uso muestra 4 de 4 agendas", r.body);
r = await ricardo("PUT", `${B}/professionals/${paula.id}`, { ...newProfessional, userId: vs.userId });
ok(r.status === 409 && /Valeria/.test(r.body.error.message), "un usuario no puede tener dos agendas", r.body);
r = await ricardo("PUT", `${B}/professionals/${paula.id}`, { ...newProfessional, allServices: false, serviceIds: [] });
ok(r.status === 400, "sin servicios y sin «todos» → 400", r.body);
r = await ricardo("DELETE", `${B}/professionals/${paula.id}`);
ok(r.status === 204 || r.status === 200, "una agenda sin citas se puede eliminar", r);
r = await ricardo("DELETE", `${B}/professionals/${andres.id}`);
ok(r.status === 409 && /desactívalo/.test(r.body.error.message), "con citas, sólo se desactiva", r.body);
r = await admin("PUT", `/admin/businesses/${rs.businessId}/plan`, { plan: "pro" });
ok(r.status === 409 && /agenda/.test(r.body.error.message), "no pasa a Pro con 3 profesionales activos", r.body);

console.log("Rol Profesional (Valeria)");
const today = getZonedNow(business.timezone).date;
const from = addDaysISO(today, -40);
const to = addDaysISO(today, 30);
const all: Appointment[] = (await ricardo("GET", `${B}/appointments?from=${from}&to=${to}`)).body;
const mine: Appointment[] = (await valeria("GET", `${B}/appointments?from=${from}&to=${to}`)).body;
ok(all.some((a) => a.professionalId !== valeriaAgenda.id), "el propietario ve todas las agendas", all.length);
ok(mine.length > 0 && mine.every((a) => a.professionalId === valeriaAgenda.id), "Valeria sólo recibe sus citas", mine.length);
const othersAppointment = all.find((a) => a.professionalId === ricardoAgenda.id)!;
r = await valeria("GET", `${B}/appointments/${othersAppointment.id}`);
ok(r.status === 404 || r.body === null, "una cita de otra agenda no existe para ella", r);
r = await valeria("PATCH", `${B}/appointments/${othersAppointment.id}/status`, { status: "cancelled" });
ok(r.status === 404, "ni puede cambiarla", r.body);
const schedules: Schedule[] = (await valeria("GET", `${B}/schedules`)).body;
ok(schedules.length === 7 && schedules.every((s) => s.professionalId === valeriaAgenda.id), "ve sólo su horario", schedules.length);
r = await valeria("PUT", `${B}/professionals/${ricardoAgenda.id}/schedule`, schedules.map(({ dayOfWeek, isActive, intervals }) => ({ dayOfWeek, isActive, intervals })));
ok(r.status === 403, "no cambia el horario de otro", r.body);
r = await valeria("PUT", `${B}/professionals/${valeriaAgenda.id}/schedule`, schedules.map(({ dayOfWeek, isActive, intervals }) => ({ dayOfWeek, isActive, intervals })));
ok(r.status === 200, "sí el suyo", r.body);
r = await valeria("POST", `${B}/blocked-times`, { reason: "Congreso", allDay: true, startDate: addDaysISO(today, 50), endDate: addDaysISO(today, 51), startTime: "", endTime: "", professionalId: null });
ok(r.status === 200 && r.body.professionalId === valeriaAgenda.id, "su bloqueo queda en su agenda (no en todo el negocio)", r.body);
r = await valeria("POST", `${B}/blocked-times`, { reason: "Viaje", allDay: true, startDate: addDaysISO(today, 50), endDate: addDaysISO(today, 50), startTime: "", endTime: "", professionalId: ricardoAgenda.id });
ok(r.status === 403, "no bloquea la agenda de otro", r.body);

// Un paciente que registró el propietario y que nunca pasó por la agenda de Valeria.
const ricardosPatient = (
  await ricardo("POST", `${B}/clients`, { name: "Paciente de Ricardo", documentId: cedulaFor("pr@example.com"), email: "pr@example.com", phone: "", address: "", notes: "", isActive: true })
).body;
const clientsAll = (await valeria("GET", `${B}/clients`)).body;
r = await ricardo("PATCH", B, { professionalScope: "own" });
ok(r.status === 200 && r.body.professionalScope === "own", "el propietario elige «sólo sus pacientes»", r.body);
const clientsOwn = (await valeria("GET", `${B}/clients`)).body;
const herClientIds = new Set(mine.map((a) => a.clientId));
ok(clientsOwn.length < clientsAll.length && clientsOwn.every((c: { id: string }) => herClientIds.has(c.id)), "ahora ve sólo a sus pacientes", [clientsAll.length, clientsOwn.length]);
const stranger = clientsAll.find((c: { id: string }) => c.id === ricardosPatient.id);
ok(stranger, "con «todos», veía también al paciente de Ricardo");
r = await valeria("GET", `${B}/clients/${stranger.id}`);
ok(r.status === 404 || r.body === null, "la ficha de otro paciente no existe para ella", r);
r = await valeria("GET", `${B}/clients/${stranger.id}/clinical-record`);
ok(r.status === 404, "ni su historia clínica", r.body);
r = await valeria("POST", `${B}/clients`, { name: "Paciente de Valeria", documentId: cedulaFor("pv@example.com"), email: "pv@example.com", phone: "", address: "", notes: "", isActive: true });
ok(r.status === 200, "registra un paciente", r.body);
ok((await valeria("GET", `${B}/clients`)).body.some((c: { id: string }) => c.id === r.body.id), "y lo ve aunque aún no tenga citas");
await ricardo("PATCH", B, { professionalScope: "all" });

console.log("Citas por agenda");
const service = (await ricardo("GET", `${B}/services`)).body.find((s: { name: string }) => s.name === "Consulta odontológica");
const free = (agenda: string) => {
  // Un día y hora sin citas en ninguna de las dos agendas.
  for (let d = 30; d < 60; d++) {
    const date = addDaysISO(today, d);
    if (all.some((a) => a.date === date)) continue;
    return { date, agenda };
  }
  throw new Error("sin día libre");
};
const { date } = free("x");
const someClient = clientsAll[0].id;
const base = { clientId: someClient, serviceId: service.id, date, startTime: "10:00", durationMinutes: 30, price: 20, status: "confirmed", notes: "" };
r = await elena("POST", `${B}/appointments`, base);
ok(r.status === 400 && /Elige el profesional/.test(r.body.error.message), "recepción debe elegir la agenda", r.body);
r = await elena("POST", `${B}/appointments`, { ...base, professionalId: ricardoAgenda.id });
ok(r.status === 200 && r.body.professionalId === ricardoAgenda.id, "cita de Ricardo a las 10:00", r.body);
const ricardoAppointment: Appointment = r.body;
r = await elena("POST", `${B}/appointments`, { ...base, professionalId: valeriaAgenda.id });
ok(r.status === 200, "a la misma hora, otra agenda sí puede", r.body);
r = await elena("POST", `${B}/appointments`, { ...base, clientId: clientsAll[1].id, professionalId: ricardoAgenda.id });
ok(r.status === 409, "la misma agenda no se cruza", r.body);
r = await valeria("POST", `${B}/appointments`, { ...base, startTime: "11:00" });
ok(r.status === 200 && r.body.professionalId === valeriaAgenda.id, "Valeria agenda en la suya sin elegirla", r.body);
r = await valeria("POST", `${B}/appointments`, { ...base, startTime: "12:00", professionalId: ricardoAgenda.id });
ok(r.status === 403, "y no en la de otro", r.body);
r = await elena("PUT", `${B}/appointments/${ricardoAppointment.id}`, { ...base, startTime: "10:00", professionalId: andres.id });
ok(r.status === 200 && r.body.professionalId === andres.id, "recepción reasigna la cita a otro profesional", r.body);
const notifiable = sql(`select email <> '' from clients where id = '${someClient}'`) === "t";
const changeNotices = Number(sql(`select count(*) from notifications where appointment_id = '${ricardoAppointment.id}' and type = 'appointment_updated'`));
ok(changeNotices === (notifiable ? 1 : 0), "al paciente se le avisa que lo atenderá otro profesional", { notifiable, changeNotices });
const whiteningService = (await ricardo("GET", `${B}/services`)).body.find((s: { name: string }) => s.name === "Blanqueamiento");
const whiteningInput = { ...base, serviceId: whiteningService.id, startTime: "15:00", durationMinutes: whiteningService.durationMinutes };
r = await elena("POST", `${B}/appointments`, { ...whiteningInput, professionalId: andres.id });
ok(r.status === 400 && /no atiende/.test(r.body.error.message), "no se agenda un blanqueamiento con Andrés", r.body);
r = await elena("POST", `${B}/appointments`, { ...whiteningInput, professionalId: ricardoAgenda.id });
ok(r.status === 200, "con Ricardo sí", r.body);
r = await elena("PUT", `${B}/appointments/${r.body.id}`, { ...whiteningInput, professionalId: andres.id });
ok(r.status === 400 && /Andrés.*no atiende Blanqueamiento/.test(r.body.error.message), "ni se le pasa a Andrés al reasignarla", r.body);

console.log("Llegada del paciente");
r = await elena("PATCH", `${B}/appointments/${ricardoAppointment.id}/arrival`, { arrived: true });
ok(r.status === 200 && r.body.arrivedAt, "recepción marca la llegada", r.body);
r = await elena("PATCH", `${B}/appointments/${ricardoAppointment.id}/arrival`, { arrived: false });
ok(r.status === 200 && r.body.arrivedAt === null, "y la puede quitar", r.body);
await elena("PATCH", `${B}/appointments/${ricardoAppointment.id}/status`, { status: "completed" });
r = await elena("PATCH", `${B}/appointments/${ricardoAppointment.id}/arrival`, { arrived: true });
ok(r.status === 409, "en una cita completada ya no", r.body);
const actions = (await ricardo("GET", `${B}/audit-logs?entityId=${ricardoAppointment.id}`)).body.entries.map((l: { action: string }) => l.action);
ok(actions.includes("appointment.arrived") && actions.includes("appointment.arrival_cleared"), "queda en la actividad", actions);

console.log("Página de reservas");
const profile: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${business.slug}?t=${Date.now()}`)).body;
ok(profile.professionals.length === 3 && !("email" in profile.professionals[0]) && !("userId" in profile.professionals[0]), "3 profesionales, sin datos internos", profile.professionals[0]);
ok(profile.busySlots.every((s) => s.professionalId), "las horas ocupadas dicen de qué agenda son");
const whitening = profile.services.find((s) => s.name === "Blanqueamiento")!;
const consult = profile.services.find((s) => s.name === "Consulta odontológica")!;
await ricardo("PATCH", B, { bookingSettings: { ...business.bookingSettings, minNoticeHours: 0, maxClientBookingsPerDay: 0 } });
const fresh: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${business.slug}?t=${Date.now() + 1}`)).body;
const now = getZonedNow(fresh.business.timezone);
const context = { ...fresh, settings: fresh.business.bookingSettings, now };
const person = (seed: string) => ({ documentId: cedulaFor(`${seed}@example.com`), name: `Cliente ${seed}`, email: `${seed}@example.com`, phone: "+593 99 444 5555", notes: "" });
r = await visitor("POST", `/public/businesses/${business.slug}/bookings`, { serviceId: whitening.id, date: addDaysISO(today, 3), startTime: "09:00", ...person("w1"), professionalId: andres.id });
ok(r.status === 404 && /no atiende/.test(r.body.error.message), "Andrés no hace blanqueamientos", r.body);

// Una hora libre con Valeria y con Ricardo a la vez, en un día que Andrés no atiende.
let both: { date: string; time: string } | null = null;
for (let d = 1; d < 40 && !both; d++) {
  const day = addDaysISO(now.date, d);
  const v = getAvailableSlots(day, consult.durationMinutes, scopeToProfessional(context, valeriaAgenda.id));
  const r0 = new Set(getAvailableSlots(day, consult.durationMinutes, scopeToProfessional(context, ricardoAgenda.id)));
  const a = getAvailableSlots(day, consult.durationMinutes, scopeToProfessional(context, andres.id));
  const time = v.find((t) => r0.has(t) && !a.includes(t));
  if (time) both = { date: day, time };
}
ok(both, "hay una hora libre con Valeria y con Ricardo (no con Andrés)", both);
const anyHours = getAvailableSlotsForAny(both!.date, consult.durationMinutes, context, [valeriaAgenda.id, andres.id, ricardoAgenda.id]);
ok(anyHours.includes(both!.time), "«el primero disponible» ofrece esa hora");
const bookAny = (seed: string) =>
  visitor("POST", `/public/businesses/${business.slug}/bookings`, { serviceId: consult.id, date: both!.date, startTime: both!.time, ...person(seed), professionalId: null });
const first = await bookAny("any1");
const second = await bookAny("any2");
const third = await bookAny("any3");
const assigned = [first, second].map((x) => sql(`select professional_id from appointments where id = '${x.body?.appointmentId}'`));
ok(first.status === 200 && second.status === 200 && new Set(assigned).size === 2, "dos reservas a la misma hora van a dos profesionales distintos", [first.body, second.body]);
ok(third.status === 409, "la tercera ya no tiene a nadie libre", third.body);
ok(first.body.professionalName && first.body.professionalName !== second.body.professionalName, "la confirmación dice con quién", [first.body.professionalName, second.body.professionalName]);

console.log("Avisos al profesional");
await ricardo("PUT", `${B}/professionals/${valeriaAgenda.id}`, {
  ...newProfessional,
  displayName: valeriaAgenda.displayName,
  title: valeriaAgenda.title,
  color: valeriaAgenda.color,
  userId: valeriaAgenda.userId,
  allServices: valeriaAgenda.allServices,
  serviceIds: valeriaAgenda.serviceIds,
  email: "valeria.avisos@example.com",
});
let slot: string | null = null;
let slotDate = "";
const fresh2: PublicBusinessProfile = (await visitor("GET", `/public/businesses/${business.slug}?t=${Date.now() + 2}`)).body;
const context2 = { ...fresh2, settings: fresh2.business.bookingSettings, now };
for (let d = 1; d < 40 && !slot; d++) {
  slotDate = addDaysISO(now.date, d);
  slot = getAvailableSlots(slotDate, consult.durationMinutes, scopeToProfessional(context2, valeriaAgenda.id))[0] ?? null;
}
r = await visitor("POST", `/public/businesses/${business.slug}/bookings`, { serviceId: consult.id, date: slotDate, startTime: slot, ...person("aviso1"), professionalId: valeriaAgenda.id });
ok(r.status === 200, "reserva online con Valeria", r.body);
const notices = () => Number(sql("select count(*) from notifications where type = 'professional_new_appointment' and to_email = 'valeria.avisos@example.com'"));
ok(notices() === 1, "a Valeria le llega el aviso de la cita nueva", notices());
r = await valeria("POST", `${B}/appointments`, { ...base, date: slotDate, startTime: "07:00" });
ok(r.status === 200 && notices() === 1, "de lo que agenda ella misma no se le avisa", notices());
r = await elena("POST", `${B}/appointments`, { ...base, date: slotDate, startTime: "07:30", professionalId: valeriaAgenda.id });
ok(r.status === 200 && notices() === 2, "de lo que agenda recepción sí", notices());

const { transaction, pool } = await import("../src/db/pool.ts");
const { runDailyAgendaJob } = await import("../src/services/notifications.ts");
const morning = { date: slotDate, minutes: 7 * 60 };
const agendas = () => Number(sql("select count(*) from notifications where type = 'professional_daily_agenda' and to_email = 'valeria.avisos@example.com'"));
await transaction((db) => runDailyAgendaJob(db, rs.businessId, morning));
ok(agendas() === 1, "a las 7:00 sale su agenda del día", agendas());
await transaction((db) => runDailyAgendaJob(db, rs.businessId, { ...morning, minutes: 7 * 60 + 10 }));
ok(agendas() === 1, "una sola vez por día", agendas());
await transaction((db) => runDailyAgendaJob(db, rs.businessId, { date: addDaysISO(slotDate, 1), minutes: 15 * 60 }));
ok(agendas() === 1, "por la tarde ya no se envía", agendas());
await pool.end();

console.log("Equipo");
r = await ricardo("DELETE", `${B}/team/${vs.userId}`);
ok(r.status === 204 || r.status === 200, "el propietario quita a Valeria del equipo", r);
professionals = (await ricardo("GET", `${B}/professionals`)).body;
ok(professionals.find((p) => p.id === valeriaAgenda.id)?.userId === null, "su agenda sigue, sin usuario");

console.log("Cuenta individual (Pro): sin profesionales ni rol Profesional");
const { a: jhordan, session: js } = await login("jhordan@demo.com");
const J = `/businesses/${js.businessId}`;
r = await jhordan("POST", `${J}/professionals`, { ...newProfessional, isActive: false });
ok(r.status === 402 && /individual/.test(r.body.error.message), "no se agregan profesionales, ni inactivos", r.body);
const [ownAgenda] = (await jhordan("GET", `${J}/professionals`)).body;
const { id: _id, businessId: _b, sortOrder: _s, createdAt: _c, ...ownInput } = ownAgenda;
r = await jhordan("PUT", `${J}/professionals/${ownAgenda.id}`, { ...ownInput, title: "Psicólogo clínico", meetingUrl: "https://meet.google.com/jho-rdan-123" });
ok(r.status === 200 && r.body.title === "Psicólogo clínico" && r.body.meetingUrl.endsWith("jho-rdan-123"), "sí edita su única agenda (especialidad y videollamada)", r.body);
const jTeam = (await jhordan("GET", `${J}/team`)).body;
const miguel = jTeam.find((m: { email: string }) => m.email === "miguel@demo.com");
r = await jhordan("PATCH", `${J}/team/${miguel.userId}`, { role: "professional" });
ok(r.status === 402 && /varias agendas/.test(r.body.error.message), "no se da el rol Profesional", r.body);
r = await jhordan("PATCH", `${J}/team/${miguel.userId}`, { role: "admin" });
ok(r.status === 204 || r.status === 200, "los demás roles sí", r.body);
r = await admin("POST", `/admin/businesses/${js.businessId}/members`, { firstName: "Pía", lastName: "Mora", email: "pia@example.com", role: "professional", password: "PiaClave2026" });
ok(r.status === 402 && /varias agendas/.test(r.body.error.message), "ni el super admin agrega a alguien con ese rol", r.body);

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
