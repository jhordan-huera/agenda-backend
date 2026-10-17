// Centro de avisos del panel (spec 014): quién tiene cada aviso en su campana (la tabla NOTICE_AUDIENCE,
// con los cuatro roles de la Clínica Dental Sonrisa y una agenda sin usuario), el leído de cada persona,
// los textos con el nombre completo (y el celular a medias), los del cron, los casos límite, que guardar
// un aviso nunca rompe una reserva (RF-011), la campana de /admin y que leer no va a la actividad.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, fakePushService, login, sleep, sql, startApi, BASE, type ReceivedPush } from "./helpers/harness.ts";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { BUSINESS_NOTICE_KINDS, NOTICE_AUDIENCE, type BusinessNoticeKind } from "../src/shared/lib/constants/notices.ts";
import { capitalize, formatShortDate, joinNames } from "../src/shared/lib/format.ts";
import { noticeVisibleTo, type NoticeViewer } from "../src/shared/lib/notices.ts";
import { getPlan } from "../src/shared/lib/constants/plans.ts";
import { addDaysISO, getZonedNow } from "../src/shared/lib/time.ts";
import type { PanelNotice, PanelNoticePage, PublicBusinessProfile } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const push = await fakePushService();
const { pool, transaction } = await import("../src/db/pool.ts");
const delivery = await import("../src/services/push-delivery.ts");
const notices = await import("../src/services/push-notices.ts");
const panel = await import("../src/services/panel-notices.ts");
// Lo que esta prueba pone en cola desde aquí (el cron simulado) lo envía ella misma.
delivery.disableImmediatePushDelivery();
const ORIGIN = new URL(BASE).origin;
const GYE = "America/Guayaquil";

let ipSeq = 0;
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;
const as = (email: string, options: { base?: string } = {}) => login(email, { ip: nextIp(), ...options });
const visitor = (base?: string) => agent({ ip: nextIp(), base });
type Browser = Awaited<ReturnType<typeof as>>;

const SECRET_NOTE = "Me duele la muela del juicio desde el lunes";
const tag = Date.now().toString(36);
let seq = 0;
/** Pacientes con nombre y apellidos, email, teléfono y cédula propios (CE-003). */
const people: { name: string; email: string; phone: string; documentId: string }[] = [];
const person = (name: string) => {
  seq++;
  const who = {
    documentId: cedulaFor(`${tag}-${seq}`),
    name,
    email: `${name.split(" ")[0].normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()}.${seq}.${tag}@correo.ec`,
    phone: `+593 98 ${String(300 + seq)} 7654`,
  };
  people.push(who);
  return who;
};

/** Todo lo que leyó cada campana en la suite (para la prueba de privacidad del final). */
const everything: PanelNotice[] = [];

/** Todos los avisos de la campana de esa persona, página a página (7 por página: también prueba el cursor). */
async function bell(browser: Browser, path: string): Promise<PanelNotice[]> {
  const list: PanelNotice[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const r = await browser("GET", `${path}?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (r.status !== 200) throw new Error(`La campana respondió ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as PanelNoticePage;
    list.push(...body.notices);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  everything.push(...list);
  return list;
}
const unreadAt = async (browser: Browser, path: string) => {
  const r = await browser("GET", `${path}/unread`);
  return r.status === 200 ? (r.body.unread as number) : -r.status;
};

/** «Hoy 16:00», «Mañana 16:00» o «Mar 20 oct 16:00», calculado aquí (no con el código de la API). */
function whenText(date: string, time: string, timezone = GYE): string {
  const today = getZonedNow(timezone).date;
  const day = date === today ? "hoy" : date === addDaysISO(today, 1) ? "mañana" : formatShortDate(date);
  return `${capitalize(day)} ${time}`;
}

/** El instante (ISO) de una hora de pared en una zona. */
const instant = (date: string, time: string, zone: string) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${zone}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`)).toISOString();
const plusMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/* ======================================================================================== */
console.log("El equipo de la Clínica Dental Sonrisa");
const ricardo = await as("ricardo@demo.com"); // propietario, con su agenda
const dental: string = ricardo.session.businessId;
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional, agenda «Dra. Valeria Cruz»
const admin = await as("admin@demo.com"); // super admin
const bellPath = `/businesses/${dental}/notices`;
sql(`update professionals set all_services = true where business_id = '${dental}'`);
sql(
  `update businesses set booking_settings = booking_settings
          || '{"minNoticeHours": 0, "maxClientBookingsPerDay": 0, "chooseProfessional": true, "allowCancellations": true, "cancellationNoticeHours": 0}'
    where id = '${dental}'`,
);
const agendas = (await ricardo("GET", `/businesses/${dental}/professionals`)).body as { id: string; displayName: string; userId: string | null }[];
const ricardoAgenda = agendas.find((agenda) => agenda.userId === ricardo.session.userId)!;
const valeriaAgenda = agendas.find((agenda) => agenda.displayName === "Dra. Valeria Cruz")!;
const vegaAgenda = agendas.find((agenda) => agenda.displayName === "Dr. Andrés Vega")!;
ok(Boolean(ricardoAgenda && valeriaAgenda && vegaAgenda && vegaAgenda.userId === null), "tres agendas: la de Ricardo, la de Valeria y la del Dr. Vega (sin usuario)", agendas);
// Un administrador nuevo (la contraseña de las cuentas demo).
const sofiaId = sql(
  `insert into users (first_name, last_name, email, password_hash) select 'Sofía', 'Administra', 'sofia.${tag}@demo.com', password_hash from users where email = 'ricardo@demo.com' returning id`,
).split("\n")[0];
sql(`insert into business_users (business_id, user_id, role) values ('${dental}', '${sofiaId}', 'admin')`);
const sofia = await as(`sofia.${tag}@demo.com`);

interface Member {
  name: string;
  browser: Browser;
  userId: string;
  viewer: NoticeViewer;
}
const TEAM: Member[] = [
  { name: "Ricardo (propietario)", browser: ricardo, userId: ricardo.session.userId, viewer: { isOwner: true, role: "owner", agendaId: ricardoAgenda.id } },
  { name: "Sofía (administradora)", browser: sofia, userId: sofiaId, viewer: { isOwner: false, role: "admin", agendaId: null } },
  { name: "Elena (Recepción)", browser: elena, userId: elena.session.userId, viewer: { isOwner: false, role: "staff", agendaId: null } },
  { name: "Valeria (Profesional)", browser: valeria, userId: valeria.session.userId, viewer: { isOwner: false, role: "professional", agendaId: valeriaAgenda.id } },
];
for (const member of TEAM) ok((await unreadAt(member.browser, bellPath)) === 0, `${member.name}: la campana empieza vacía (lo de antes no se reconstruye)`);

/**
 * Quién tiene el aviso en su campana, comparado con la tabla compartida (noticeVisibleTo, NOTICE_AUDIENCE):
 * cada persona del equipo lo tiene una sola vez si le toca, y ninguna vez si no.
 */
async function checkAudience(label: string, match: (notice: PanelNotice) => boolean, target: { kind: BusinessNoticeKind; agendaId: string | null }, actorUserId: string | null = null) {
  const rows: { name: string; expected: boolean; seen: number }[] = [];
  for (const member of TEAM) {
    const expected = noticeVisibleTo(member.viewer, target) && member.userId !== actorUserId;
    rows.push({ name: member.name, expected, seen: (await bell(member.browser, bellPath)).filter(match).length });
  }
  const who = rows.filter((row) => row.expected).map((row) => row.name.split(" ")[0]);
  ok(rows.every((row) => row.seen === (row.expected ? 1 : 0)), `${label}: ${who.length ? `lo ve${who.length > 1 ? "n" : ""} ${joinNames(who)}, y nadie más` : "no le llega a nadie"}`, rows);
}
const ofAppointment = (kind: BusinessNoticeKind, appointmentId: string) => (notice: PanelNotice) => notice.kind === kind && notice.url.includes(`appointment=${appointmentId}`);

/* ======================================================================================== */
console.log("La tabla compartida (NOTICE_AUDIENCE)");
ok(
  BUSINESS_NOTICE_KINDS.every((kind) => NOTICE_AUDIENCE[kind]) &&
    NOTICE_AUDIENCE.booking.owner === "all" && NOTICE_AUDIENCE.booking.team === "all" &&
    NOTICE_AUDIENCE.new_appointment.owner === null && NOTICE_AUDIENCE.new_appointment.team === null &&
    NOTICE_AUDIENCE.unclosed.team === null && NOTICE_AUDIENCE.evening_summary.owner === "business" &&
    NOTICE_AUDIENCE.morning_summary.owner === "business" && NOTICE_AUDIENCE.morning_summary.agenda,
  "los ocho tipos del negocio, como en la tabla de la spec (el de la mañana, como el de las 8: spec 021)",
);
ok(
  panel.AUDIENCE_SQL.includes("me.role in ('admin', 'staff')") &&
    panel.AUDIENCE_SQL.includes("'booking', 'receipt', 'patient_confirm', 'patient_cancel', 'unclosed'") &&
    panel.AUDIENCE_SQL.includes("n.kind in ('evening_summary', 'morning_summary') and n.professional_id is null"),
  "la consulta de la API sale de la misma tabla",
  panel.AUDIENCE_SQL,
);

/* ======================================================================================== */
console.log("Reserva online, comprobante, «Confirmo que voy» y cancelación (cada aviso de la tabla)");
async function freeSlot(professionalId: string, durationMinutes: number, fromDay = 1) {
  const slug = sql(`select slug from businesses where id = '${dental}'`);
  const current = (await visitor()("GET", `/public/businesses/${slug}?t=${Date.now()}`)).body as PublicBusinessProfile;
  const now = getZonedNow(current.business.timezone);
  const context = scopeToProfessional({ ...current, settings: current.business.bookingSettings, now }, professionalId);
  for (let d = fromDay; d < 60; d++) {
    const date = addDaysISO(now.date, d);
    for (const startTime of getAvailableSlots(date, durationMinutes, context)) {
      if (usedSlots.has(`${professionalId} ${date} ${startTime}`)) continue;
      usedSlots.add(`${professionalId} ${date} ${startTime}`);
      return { date, startTime, slug, profile: current };
    }
  }
  throw new Error("No hay horas libres");
}
const usedSlots = new Set<string>();
const service = sql(`select id || '|' || name || '|' || duration_minutes from services where business_id = '${dental}' and is_active and people_per_session = 1 order by created_at limit 1`).split("|");
const [serviceId, serviceName] = service;
const serviceMinutes = Number(service[2]);
async function book(professionalId: string, who: ReturnType<typeof person>, base?: string) {
  const slot = await freeSlot(professionalId, serviceMinutes);
  const r = await visitor(base)("POST", `/public/businesses/${slot.slug}/bookings`, {
    serviceId,
    professionalId,
    date: slot.date,
    startTime: slot.startTime,
    notes: SECRET_NOTE,
    ...who,
    extraPatients: [],
  });
  return { ...r, slot };
}

const juan = person("Juan Pérez López");
const valeriaBooking = await book(valeriaAgenda.id, juan);
const valeriaBookingId: string = valeriaBooking.body.appointmentId;
ok(valeriaBooking.status === 200, "reserva online en la agenda de la Dra. Cruz", valeriaBooking.body);
await checkAudience("«Nueva reserva» en la agenda de la Dra. Cruz", ofAppointment("booking", valeriaBookingId), { kind: "booking", agendaId: valeriaAgenda.id });
const ricardoBell = await bell(ricardo, bellPath);
const bookingNotice = ricardoBell.find(ofAppointment("booking", valeriaBookingId));
ok(
  bookingNotice?.title === "Nueva reserva" &&
    bookingNotice.body === `${whenText(valeriaBooking.slot.date, valeriaBooking.slot.startTime)} · ${serviceName} · Juan Pérez López · con Dra. Valeria Cruz`,
  "«Nueva reserva · {día} {hora} · {servicio} · Juan Pérez López · con Dra. Valeria Cruz» (el nombre completo)",
  bookingNotice,
);
ok(
  bookingNotice?.url === `/dashboard/calendar?date=${valeriaBooking.slot.date}&appointment=${valeriaBookingId}` && bookingNotice.read === false,
  "abre la cita en la agenda, y está sin leer",
  bookingNotice,
);
const vegaBooking = await book(vegaAgenda.id, person("Marta Lucía Ibarra Paz"));
const vegaBookingId: string = vegaBooking.body.appointmentId;
await checkAudience("«Nueva reserva» en la agenda sin usuario del Dr. Vega", ofAppointment("booking", vegaBookingId), { kind: "booking", agendaId: vegaAgenda.id });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const payToken: string = valeriaBooking.body.payment?.token;
const payer = visitor();
let r = await payer("POST", `/public/payments/${payToken}/receipts`, { fileName: "transferencia.png", contentType: "image/png", sizeBytes: PNG.length });
if (r.status === 200) {
  await fetch(ORIGIN + r.body.upload.url, { method: "PUT", headers: r.body.upload.headers, body: PNG });
  r = await payer("POST", `/public/payments/${payToken}/receipts/${r.body.receipt.id}/complete`);
}
ok(r.status === 200, "el paciente sube su comprobante", r.body);
await checkAudience("«Comprobante de pago»", ofAppointment("receipt", valeriaBookingId), { kind: "receipt", agendaId: valeriaAgenda.id });
ok(
  (await bell(elena, bellPath)).find(ofAppointment("receipt", valeriaBookingId))?.body === `Juan Pérez López · ${whenText(valeriaBooking.slot.date, valeriaBooking.slot.startTime)}`,
  "«Comprobante de pago · Juan Pérez López · {día} {hora}»",
);
r = await visitor()("POST", `/public/appointments/${payToken}/confirm`);
ok(r.status === 200 && r.body.already === false, "«Confirmo que voy»", r.body);
await checkAudience("«El paciente confirmó»", ofAppointment("patient_confirm", valeriaBookingId), { kind: "patient_confirm", agendaId: valeriaAgenda.id });
ok(
  (await bell(valeria, bellPath)).find(ofAppointment("patient_confirm", valeriaBookingId))?.body ===
    `${whenText(valeriaBooking.slot.date, valeriaBooking.slot.startTime)} · Juan Pérez López`,
  "«El paciente confirmó · {día} {hora} · Juan Pérez López»",
);
await visitor()("POST", `/public/appointments/${payToken}/confirm`);
ok(count(`select count(*) from panel_notices where kind = 'patient_confirm' and appointment_id = '${valeriaBookingId}'`) === 1, "confirmar otra vez no repite el aviso");
r = await visitor()("POST", `/public/appointments/${payToken}/cancel`);
ok(r.status === 200, "«Cancelar mi cita» desde el email", r.body);
await checkAudience("«Cita cancelada por el paciente»", ofAppointment("patient_cancel", valeriaBookingId), { kind: "patient_cancel", agendaId: valeriaAgenda.id });

/* ======================================================================================== */
console.log("Cita nueva en tu agenda");
const patientRow = (name: string) => {
  const who = person(name);
  return sql(
    `insert into clients (business_id, name, document_id, email, phone) values ('${dental}', '${who.name}', '${who.documentId}', '${who.email}', '${who.phone}') returning id`,
  ).split("\n")[0];
};
const anaDental = patientRow("Ana María Salazar Quiroga");
const panelDay = addDaysISO(getZonedNow(GYE).date, 45);
let late = 20 * 60;
const newAppointment = (browser: Browser, professionalId: string, date = panelDay) => {
  const startTime = `${String(Math.floor(late / 60)).padStart(2, "0")}:${String(late % 60).padStart(2, "0")}`;
  late += 30;
  return browser("POST", `/businesses/${dental}/appointments`, {
    clientId: anaDental,
    serviceId,
    professionalId,
    date,
    startTime,
    durationMinutes: 30,
    price: 20,
    status: "confirmed",
    notes: SECRET_NOTE,
    homeVisit: null,
    isVirtual: false,
  });
};
r = await newAppointment(elena, valeriaAgenda.id);
const elenaForValeria: string = r.body?.id;
ok(r.status === 200, "Recepción le agenda una cita a la Dra. Cruz", r.body?.error);
await checkAudience("Recepción le agenda a Valeria: «Cita nueva en tu agenda»", ofAppointment("new_appointment", elenaForValeria), { kind: "new_appointment", agendaId: valeriaAgenda.id }, elena.session.userId);
ok(
  (await bell(valeria, bellPath)).find(ofAppointment("new_appointment", elenaForValeria))?.body === `${whenText(panelDay, r.body.startTime)} · Ana María Salazar Quiroga`,
  "«Cita nueva en tu agenda · {día} {hora} · Ana María Salazar Quiroga»",
);
r = await newAppointment(valeria, valeriaAgenda.id);
const ownByValeria: string = r.body?.id;
ok(r.status === 200, "Valeria se agenda una cita ella misma", r.body?.error);
await checkAudience("Valeria se agenda sola", ofAppointment("new_appointment", ownByValeria), { kind: "new_appointment", agendaId: valeriaAgenda.id }, valeria.session.userId);
r = await newAppointment(elena, ricardoAgenda.id);
const elenaForRicardo: string = r.body?.id;
await checkAudience("Recepción le agenda a Ricardo (el propietario también tiene agenda)", ofAppointment("new_appointment", elenaForRicardo), { kind: "new_appointment", agendaId: ricardoAgenda.id }, elena.session.userId);
r = await newAppointment(admin, valeriaAgenda.id);
const bySupport: string = r.body?.id;
await checkAudience("El super admin en modo soporte le agenda a Valeria", ofAppointment("new_appointment", bySupport), { kind: "new_appointment", agendaId: valeriaAgenda.id }, admin.session.userId);
r = await newAppointment(elena, vegaAgenda.id);
ok(r.status === 200 && count(`select count(*) from panel_notices where appointment_id = '${r.body.id}'`) === 0, "en la agenda sin usuario no se guarda nada", r.body?.error);

// Una serie (spec 011): Recepción le agenda a Valeria 4 citas semanales, un miércoles a las 10:00.
let seriesStart = addDaysISO(getZonedNow(GYE).date, 100);
while (new Date(`${seriesStart}T12:00:00Z`).getUTCDay() !== 3) seriesStart = addDaysISO(seriesStart, 1);
const seriesBody = {
  appointment: {
    clientId: anaDental,
    extraClientIds: [],
    serviceId,
    professionalId: valeriaAgenda.id,
    date: seriesStart,
    startTime: "10:00",
    durationMinutes: 30,
    price: 20,
    status: "confirmed",
    notes: SECRET_NOTE,
    homeVisit: null,
    isVirtual: false,
  },
  repeat: { frequency: "weekly", count: 4 },
};
r = await elena("POST", `/businesses/${dental}/appointment-series/preview`, seriesBody);
const seriesDates =
  r.status === 200
    ? (r.body.dates as { date: string; startTime: string; status: string; freeTimes: string[] }[]).flatMap((row) =>
        row.status === "free" ? [{ date: row.date, startTime: row.startTime }] : row.freeTimes.length > 0 ? [{ date: row.date, startTime: row.freeTimes[0] }] : [],
      )
    : [];
r = await elena("POST", `/businesses/${dental}/appointment-series`, { ...seriesBody, dates: seriesDates });
const created = (r.status === 201 ? r.body.created : []) as { id: string; date: string; startTime: string }[];
const [seriesFirst] = [...created].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
ok(created.length >= 2, "la serie se crea desde el panel", [r.status, r.body?.error]);
await checkAudience("Una serie: un solo aviso", (notice) => notice.kind === "new_appointment" && created.some((item) => notice.url.includes(item.id)), { kind: "new_appointment", agendaId: valeriaAgenda.id }, elena.session.userId);
const seriesNotice = (await bell(valeria, bellPath)).find(ofAppointment("new_appointment", seriesFirst?.id ?? "-"));
ok(
  seriesNotice?.title === "Citas nuevas en tu agenda" &&
    seriesNotice.body === `${created.length} citas desde el ${formatShortDate(seriesFirst.date)} ${seriesFirst.startTime} · Ana María Salazar Quiroga` &&
    seriesNotice.url === `/dashboard/calendar?date=${seriesFirst.date}&appointment=${seriesFirst.id}`,
  "«Citas nuevas en tu agenda · 4 citas desde el {día} 10:00 · Ana María Salazar Quiroga», que abre la primera",
  seriesNotice,
);

/* ======================================================================================== */
console.log("Del cron (con la hora simulada)");
const pushDevices = (userId: string) => count(`select count(*) from push_subscriptions where user_id = '${userId}'`);
const juanMejia = patientRow("Juan Pérez Mejía");
const cronAppointment = (professionalId: string, date: string, start: string, end: string, status = "confirmed") =>
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${dental}', '${juanMejia}', '${serviceId}', '${professionalId}', '${date}', '${start}', '${end}', '${status}', 20, 'dashboard') returning id`,
  ).split("\n")[0];
const day1 = addDaysISO(getZonedNow(GYE).date, 150);
const unclosedValeria = cronAppointment(valeriaAgenda.id, day1, "10:00", "10:30");
const unclosedVega = cronAppointment(vegaAgenda.id, day1, "10:00", "10:30");
const closedEarly = cronAppointment(ricardoAgenda.id, day1, "10:00", "10:30", "completed");
// El negocio de Jhordan: su propietario no tiene el celular activado.
const jhordan = await as("jhordan@demo.com");
const jhordanBusiness: string = jhordan.session.businessId;
const [jhService, jhProfessional, jhClient] = sql(
  `select (select id from services where business_id = '${jhordanBusiness}' order by created_at limit 1) || '|' ||
          (select id from professionals where business_id = '${jhordanBusiness}' order by created_at limit 1) || '|' ||
          (select id from clients where business_id = '${jhordanBusiness}' order by created_at limit 1)`,
).split("|");
const jhUnclosed = sql(
  `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
   values ('${jhordanBusiness}', '${jhClient}', '${jhService}', '${jhProfessional}', '${day1}', '10:00', '10:30', 'pending', 20, 'dashboard') returning id`,
).split("\n")[0];
const panelBefore = count("select count(*) from panel_notices");
let queued = await notices.queueUnclosedNotices(instant(day1, "10:55", GYE), instant(day1, "11:05", GYE));
ok(queued === 0 && pushDevices(ricardo.session.userId) === 0, "nadie tiene el celular activado: el cron no pone nada en la cola del celular");
await checkAudience("«Cita por cerrar» de la Dra. Cruz", ofAppointment("unclosed", unclosedValeria), { kind: "unclosed", agendaId: valeriaAgenda.id });
await checkAudience("«Cita por cerrar» del Dr. Vega (sin usuario)", ofAppointment("unclosed", unclosedVega), { kind: "unclosed", agendaId: vegaAgenda.id });
ok(count(`select count(*) from panel_notices where appointment_id = '${closedEarly}'`) === 0, "la que ya se cerró no avisa");
const unclosedNotice = (await bell(valeria, bellPath)).find(ofAppointment("unclosed", unclosedValeria));
ok(
  unclosedNotice?.title === "Cita por cerrar" && unclosedNotice.body === `10:00 · ${serviceName} · Juan Pérez Mejía · con Dra. Valeria Cruz: márcala Completada o No asistió`,
  "«Cita por cerrar · 10:00 · {servicio} · Juan Pérez Mejía · con Dra. Valeria Cruz: márcala Completada o No asistió»",
  unclosedNotice,
);
const jhordanUnclosed = (await bell(jhordan, `/businesses/${jhordanBusiness}/notices`)).find(ofAppointment("unclosed", jhUnclosed));
ok(Boolean(jhordanUnclosed) && pushDevices(jhordan.session.userId) === 0, "un negocio cuyo propietario no tiene el celular activado también recibe los avisos", jhordanUnclosed);

const day2 = addDaysISO(day1, 1);
cronAppointment(valeriaAgenda.id, day2, "09:00", "10:00");
cronAppointment(valeriaAgenda.id, day2, "11:00", "12:00", "pending");
cronAppointment(valeriaAgenda.id, day2, "13:00", "14:00", "completed");
cronAppointment(ricardoAgenda.id, day2, "09:00", "10:00");
cronAppointment(vegaAgenda.id, day2, "15:00", "16:00");
cronAppointment(ricardoAgenda.id, day2, "20:00", "20:30");
const eight = instant(day2, "20:00", GYE);
queued = await notices.queueEveningSummaries(plusMinutes(eight, -5), plusMinutes(eight, 5));
const summary = (title: string) => (notice: PanelNotice) => notice.kind === "evening_summary" && notice.url === `/dashboard/calendar?date=${day2}` && notice.title === title;
await checkAudience("El resumen de las 8 del negocio («Tienes 4 citas de hoy sin cerrar»)", summary("Tienes 4 citas de hoy sin cerrar"), { kind: "evening_summary", agendaId: null });
await checkAudience("El resumen de la agenda de Valeria («Tienes 2 citas de hoy sin cerrar»)", summary("Tienes 2 citas de hoy sin cerrar"), { kind: "evening_summary", agendaId: valeriaAgenda.id });
ok(
  count(`select count(*) from panel_notices where kind = 'evening_summary' and business_id = '${dental}' and data ->> 'date' = '${day2}'`) === 2,
  "uno del negocio y uno de la agenda de Valeria: ni el de la agenda del propietario ni el de la agenda sin usuario",
);
const panelAfter = count("select count(*) from panel_notices");
await notices.queueUnclosedNotices(instant(day1, "10:55", GYE), instant(day1, "11:05", GYE));
await notices.queueEveningSummaries(plusMinutes(eight, -5), plusMinutes(eight, 5));
await notices.queueEveningSummaries(plusMinutes(eight, 5), plusMinutes(eight, 15));
ok(panelAfter > panelBefore && count("select count(*) from panel_notices") === panelAfter, "pasar el cron dos veces no repite nada", [panelBefore, panelAfter]);

/* ======================================================================================== */
console.log("Leído: cada persona lleva el suyo");
const ricardoUnread = await unreadAt(ricardo, bellPath);
const elenaUnread = await unreadAt(elena, bellPath);
const ricardoCount = (await bell(ricardo, bellPath)).filter((notice) => !notice.read).length;
ok(ricardoUnread > 0 && ricardoUnread === ricardoCount, "el contador dice cuántos sin leer tiene", [ricardoUnread, ricardoCount]);
const elenaTarget = (await bell(elena, bellPath)).find(ofAppointment("booking", valeriaBookingId))!;
r = await elena("POST", `${bellPath}/${elenaTarget.id}/read`);
const again = await elena("POST", `${bellPath}/${elenaTarget.id}/read`);
ok(r.status === 204 && again.status === 204, "leer uno: 204, y leerlo otra vez no da error", [r.status, again.status]);
ok(
  (await unreadAt(elena, bellPath)) === elenaUnread - 1 && (await unreadAt(ricardo, bellPath)) === ricardoUnread,
  "le baja el contador a Elena y no a Ricardo",
);
ok(
  (await bell(elena, bellPath)).find((notice) => notice.id === elenaTarget.id)?.read === true &&
    (await bell(ricardo, bellPath)).find((notice) => notice.id === elenaTarget.id)?.read === false,
  "el mismo aviso: leído para Elena, sin leer para Ricardo",
);
const ricardoOnly = (await bell(ricardo, bellPath)).find(ofAppointment("unclosed", unclosedVega))!;
r = await elena("POST", `${bellPath}/${ricardoOnly.id}/read`);
const fake = await elena("POST", `${bellPath}/${crypto.randomUUID()}/read`);
const bad = await elena("POST", `${bellPath}/no-es-un-id/read`);
ok(r.status === 404 && fake.status === 404 && bad.status === 404 && r.body.error.message === fake.body.error.message, "el aviso de otra persona da 404, como uno que no existe", [r.body, fake.body]);
r = await ricardo("POST", `${bellPath}/read-all`);
ok(r.status === 204 && (await unreadAt(ricardo, bellPath)) === 0 && (await bell(ricardo, bellPath)).every((notice) => notice.read), "«Marcar todo como leído» deja a Ricardo en 0", r.body);
ok((await unreadAt(elena, bellPath)) === elenaUnread - 1, "y a Elena no le cambia nada");
await sleep(20);
const afterAll = await book(valeriaAgenda.id, person("Bruno Ernesto Castillo Vera"));
ok((await unreadAt(ricardo, bellPath)) === 1, "lo que llega después vuelve a contar", afterAll.status);
r = await ricardo("GET", `${bellPath}?limit=0`);
const badCursor = await ricardo("GET", `${bellPath}?cursor=mañana`);
ok(r.status === 400 && badCursor.status === 400, "una lista con limit=0 o un cursor raro: 400", [r.body, badCursor.body]);
const onlyUnread = (await ricardo("GET", `${bellPath}?unread=1`)).body as PanelNoticePage;
ok(onlyUnread.notices.length === 1 && onlyUnread.notices[0].url.includes(afterAll.body.appointmentId) && onlyUnread.unread === 1, "«Sólo los no leídos» (unread=1)", onlyUnread);

/* ======================================================================================== */
console.log("Textos: el nombre completo en la campana, a medias en el celular");
const ricardoDevice = push.device();
ok((await ricardo("PUT", "/push/device", ricardoDevice)).status === 200, "Ricardo activa los avisos en su celular");
const rosa = person("Rosa Elvira Real Montes");
const rosaBooking = await book(valeriaAgenda.id, rosa);
let phone: ReceivedPush | undefined;
for (let i = 0; i < 80 && !phone; i++) {
  phone = push.to(ricardoDevice.endpoint).find((item) => item.payload?.tag === `reserva-${rosaBooking.body.appointmentId}`);
  if (!phone) await sleep(100);
}
const rosaNotice = (await bell(ricardo, bellPath)).find(ofAppointment("booking", rosaBooking.body.appointmentId));
ok(
  phone?.payload?.body === `${whenText(rosaBooking.slot.date, rosaBooking.slot.startTime)} · ${serviceName} · Rosa E. · con Dra. Valeria Cruz` &&
    rosaNotice?.body === `${whenText(rosaBooking.slot.date, rosaBooking.slot.startTime)} · ${serviceName} · Rosa Elvira Real Montes · con Dra. Valeria Cruz`,
  "la misma reserva: «Rosa E.» en el celular y «Rosa Elvira Real Montes» en la campana",
  [phone?.payload, rosaNotice],
);
// Fechas al leer: un aviso de ayer de una cita de hoy dice «Hoy».
const today = getZonedNow(GYE).date;
const todayAppointment = cronAppointment(ricardoAgenda.id, today, "23:40", "23:55");
sql(`insert into panel_notices (business_id, kind, appointment_id, created_at) values ('${dental}', 'booking', '${todayAppointment}', now() - interval '1 day')`);
const yesterdays = (await bell(ricardo, bellPath)).find(ofAppointment("booking", todayAppointment));
ok(yesterdays?.body.startsWith("Hoy 23:40 · ") === true, "las fechas se calculan al leer: el aviso de ayer de una cita de hoy dice «Hoy 23:40»", yesterdays);

/* ======================================================================================== */
console.log("Casos límite");
r = await admin("GET", `${bellPath}/unread`);
const supportList = await admin("GET", bellPath);
const supportAll = await admin("POST", `${bellPath}/read-all`);
ok(
  r.status === 403 && r.body.error.message === "La campana es del equipo del negocio." && supportList.status === 403 && supportAll.status === 403,
  "el super admin en modo soporte: 403 «La campana es del equipo del negocio.» (no la ve ni la marca)",
  [r.body, supportList.status, supportAll.status],
);
// Alguien nuevo en el equipo (Recepción): no ve lo de antes, sí lo que llega después.
const tomasId = sql(
  `insert into users (first_name, last_name, email, password_hash) select 'Tomás', 'Nuevo', 'tomas.nuevo.${tag}@demo.com', password_hash from users where email = 'ricardo@demo.com' returning id`,
).split("\n")[0];
sql(`insert into business_users (business_id, user_id, role) values ('${dental}', '${tomasId}', 'staff')`);
const tomas = await as(`tomas.nuevo.${tag}@demo.com`);
ok((await unreadAt(tomas, bellPath)) === 0 && (await bell(tomas, bellPath)).length === 0, "quien entra hoy al equipo no ve los avisos de antes");
await sleep(20);
const newcomerBooking = await book(vegaAgenda.id, person("Pablo Andrés Ochoa Vélez"));
ok((await bell(tomas, bellPath)).some(ofAppointment("booking", newcomerBooking.body.appointmentId)), "y sí la reserva siguiente");
// Quien sale del equipo deja de verlos.
r = await ricardo("DELETE", `/businesses/${dental}/team/${tomasId}`);
const afterLeaving = await panel.countUnread(pool, { userId: tomasId, businessId: dental });
const leftList = await panel.listNotices(pool, { userId: tomasId, businessId: dental }, {});
ok(r.status === 204 && afterLeaving === 0 && leftList.notices.length === 0 && (await tomas("GET", `${bellPath}/unread`)).status === 401, "quien sale del equipo deja de verlos (y su sesión se cierra)", [r.status, afterLeaving]);
// Elena pasa de Recepción a Profesional, con la agenda del Dr. Vega.
const elenaBefore = await bell(elena, bellPath);
sql(`update business_users set role = 'professional' where business_id = '${dental}' and user_id = '${elena.session.userId}'`);
sql(`update professionals set user_id = '${elena.session.userId}' where id = '${vegaAgenda.id}'`);
const elenaAsPro = await bell(elena, bellPath);
ok(
  elenaBefore.some(ofAppointment("booking", valeriaBookingId)) &&
    !elenaAsPro.some(ofAppointment("booking", valeriaBookingId)) &&
    elenaAsPro.some(ofAppointment("booking", vegaBookingId)) &&
    elenaAsPro.some(ofAppointment("unclosed", unclosedVega)) &&
    !elenaAsPro.some(ofAppointment("unclosed", unclosedValeria)),
  "de Recepción a Profesional: sólo ve lo de su agenda (también sus citas por cerrar)",
  elenaAsPro.map((notice) => notice.kind),
);
sql(`update professionals set user_id = null where id = '${vegaAgenda.id}'`);
sql(`update business_users set role = 'staff' where business_id = '${dental}' and user_id = '${elena.session.userId}'`);
// Una cita movida a otra agenda: la ve la profesional nueva.
ok(!(await bell(valeria, bellPath)).some(ofAppointment("booking", vegaBookingId)), "Valeria no ve la reserva del Dr. Vega…");
sql(`update appointments set professional_id = '${valeriaAgenda.id}' where id = '${vegaBookingId}'`);
ok((await bell(valeria, bellPath)).some(ofAppointment("booking", vegaBookingId)), "…hasta que la cita pasa a su agenda");
// El propietario cambia: el anterior deja de recibir los avisos del negocio.
sql(`update businesses set owner_id = (select id from users where email = 'laura@demo.com') where id = '${dental}'`);
const exOwner = await bell(ricardo, bellPath);
ok(!exOwner.some(ofAppointment("booking", vegaBookingId)) && exOwner.some(ofAppointment("new_appointment", elenaForRicardo)), "si el propietario cambia, el anterior sólo ve lo de su agenda", exOwner.length);
sql(`update businesses set owner_id = '${ricardo.session.userId}' where id = '${dental}'`);
// Al borrar al paciente, sus avisos desaparecen de todas las campanas.
const juanClient = sql(`select client_id from appointments where id = '${valeriaBookingId}'`);
r = await ricardo("DELETE", `/businesses/${dental}/clients/${juanClient}`);
ok(
  r.status === 204 && count(`select count(*) from panel_notices where appointment_id = '${valeriaBookingId}'`) === 0 &&
    !(await bell(ricardo, bellPath)).some((notice) => notice.url.includes(valeriaBookingId)) &&
    !(await bell(valeria, bellPath)).some((notice) => notice.url.includes(valeriaBookingId)),
  "al borrar al paciente, sus avisos (reserva, comprobante, confirmación y cancelación) desaparecen",
  r.body,
);
ok(
  count(`select count(*) from panel_notices where body like '%Juan Pérez López%' or title like '%Juan Pérez López%' or data::text like '%Juan%'`) === 0,
  "y su nombre no queda guardado en ninguna parte (el texto se arma al leer)",
);
// Más de 30 días.
const oldNotice = sql(
  `insert into panel_notices (business_id, kind, data, created_at) values ('${dental}', 'evening_summary', '{"date": "${addDaysISO(today, -31)}", "count": 2}', now() - interval '31 days') returning id`,
).split("\n")[0];
ok(!(await bell(ricardo, bellPath)).some((notice) => notice.id === oldNotice), "un aviso de hace 31 días ya no aparece");
const purged = await panel.cleanupPanelNotices();
ok(purged >= 1 && count(`select count(*) from panel_notices where id = '${oldNotice}'`) === 0, "y el cron lo borra", purged);
// Un negocio suspendido no genera avisos.
sql(`update businesses set status = 'suspended' where id = '${jhordanBusiness}'`);
const suspendedAppointment = sql(
  `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
   values ('${jhordanBusiness}', '${jhClient}', '${jhService}', '${jhProfessional}', '${day2}', '10:00', '10:30', 'confirmed', 20, 'dashboard') returning id`,
).split("\n")[0];
await transaction((db) => notices.notifyOnlineBooking(db, { id: suspendedAppointment, businessId: jhordanBusiness }));
await notices.queueUnclosedNotices(instant(day2, "10:55", GYE), instant(day2, "11:05", GYE));
ok(count(`select count(*) from panel_notices where appointment_id = '${suspendedAppointment}'`) === 0, "un negocio suspendido no genera avisos (ni al momento ni del cron)");
sql(`update businesses set status = 'active' where id = '${jhordanBusiness}'`);

/* ======================================================================================== */
console.log("Nunca rompe la reserva (RF-011)");
const other = await startApi({});
sql("alter table panel_notices rename to panel_notices_aparte");
let broken: Awaited<ReturnType<typeof book>>;
try {
  broken = await book(valeriaAgenda.id, person("Valentina Sofía Ortega Cano"), other.base);
} finally {
  sql("alter table panel_notices_aparte rename to panel_notices");
}
ok(broken.status === 200 && count(`select count(*) from appointments where id = '${broken.body.appointmentId}'`) === 1, "sin la tabla de la campana (como sin la migración 041) la reserva responde 200 y la cita queda", broken.body);
ok(count(`select count(*) from notifications where appointment_id = '${broken.body.appointmentId}'`) > 0, "con sus emails en la cola");
let brokenPhone = false;
for (let i = 0; i < 80 && !brokenPhone; i++) {
  brokenPhone = push.to(ricardoDevice.endpoint).some((item) => item.payload?.tag === `reserva-${broken.body.appointmentId}`);
  if (!brokenPhone) await sleep(100);
}
ok(brokenPhone, "y el aviso al celular sale igual");
await sleep(200);
ok(/\[avisos\] No se pudo guardar el aviso del panel \(booking\): 42P01/.test(other.output()), "el registro dice el tipo y el código, sin datos", other.output().slice(-400));
ok(!people.some((who) => other.output().includes(who.name) || other.output().includes(who.email)), "ningún nombre ni email en el registro");
other.stop();

/* ======================================================================================== */
console.log("La campana de /admin");
const adminPath = "/admin/notices";
sql(
  `insert into users (first_name, last_name, email, password_hash, platform_role)
   select 'Segundo', 'Soporte', 'segundo.${tag}@demo.com', password_hash, 'super_admin' from users where email = 'admin@demo.com'`,
);
const second = await as(`segundo.${tag}@demo.com`);
ok((await unreadAt(admin, adminPath)) === 0 && (await unreadAt(second, adminPath)) === 0, "los super admin empiezan sin avisos");
const signup = visitor();
await signup("POST", "/auth/register", { firstName: "Irene", lastName: "Registro", email: `irene.${tag}@correo.ec`, password: "Clave12345", confirmPassword: "Clave12345" });
r = await signup("POST", "/businesses", {
  name: `Mente Abierta ${tag}`,
  category: "psychology",
  timezone: "America/Guayaquil",
  phone: "",
  email: "",
  address: "",
  description: "",
  schedules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isActive: d !== 0, intervals: [{ start: "09:00", end: "17:00" }] })),
  firstService: { name: "Sesión", description: "", durationMinutes: 50, price: 30, isActive: true },
});
const newBusinessId: string = r.body?.id;
const categoryName = sql("select name from business_categories where id = 'psychology'");
const adminBell = await bell(admin, adminPath);
const newBusinessNotice = adminBell.find((notice) => notice.kind === "new_business" && notice.url === `/admin/businesses/${newBusinessId}`);
ok(
  r.status === 200 && newBusinessNotice?.title === "Negocio nuevo" && newBusinessNotice.body === `Mente Abierta ${tag} · ${categoryName}` && newBusinessNotice.read === false,
  "el alta por el onboarding: «Negocio nuevo · {negocio} · {categoría}», que abre su ficha",
  [r.status, newBusinessNotice],
);
ok((await bell(second, adminPath)).some((notice) => notice.kind === "new_business" && notice.url === `/admin/businesses/${newBusinessId}`), "también le llega al otro super admin");
const irene = signup as unknown as Browser;
const ireneBell = await irene("GET", `/businesses/${newBusinessId}/notices`);
ok(ireneBell.status === 200 && (ireneBell.body as PanelNoticePage).notices.length === 0, "y no a la campana del negocio", ireneBell.body);
const currentPlan = getPlan(sql(`select plan from subscriptions where business_id = '${jhordanBusiness}'`) as "free");
const wanted = currentPlan.id === "business" ? getPlan("pro") : getPlan("business");
sql(`delete from plan_change_requests where business_id = '${jhordanBusiness}'`);
r = await jhordan("POST", `/businesses/${jhordanBusiness}/subscription/request`, { plan: wanted.id });
const businessName = sql(`select name from businesses where id = '${jhordanBusiness}'`);
const planNotice = (await bell(admin, adminPath)).find((notice) => notice.kind === "plan_request");
ok(
  r.status === 200 && planNotice?.title === "Solicitud de cambio de plan" && planNotice.body === `${businessName} · de ${currentPlan.name} a ${wanted.name}` &&
    planNotice.url === `/admin/businesses/${jhordanBusiness}`,
  "una solicitud de plan: «{negocio} · de {plan} a {plan}»",
  [r.status, planNotice],
);
ok(!(await bell(jhordan, `/businesses/${jhordanBusiness}/notices`)).some((notice) => notice.kind === "plan_request" || notice.kind === "new_business"), "el negocio no ve nada de planes");
const changeId = crypto.randomUUID();
await notices.queueAccountSecurityNotices([{ id: changeId, account: "ad***@demo.com", change: "Cambió su contraseña" }]);
await notices.queueAccountSecurityNotices([{ id: changeId, account: "ad***@demo.com", change: "Cambió su contraseña" }]);
const at = new Date().toISOString();
await notices.queueLoginAttackNotice([{ account: "ri***@demo.com", attempts: 10 }, { account: "el***@demo.com", attempts: 12 }], at);
await notices.queueLoginAttackNotice([{ account: "ri***@demo.com", attempts: 11 }], at);
const securityBell = await bell(second, adminPath);
const accountNotices = securityBell.filter((notice) => notice.kind === "account_security");
const attackNotices = securityBell.filter((notice) => notice.kind === "login_attack");
ok(
  accountNotices.length === 1 && accountNotices[0].title === "Cambio de seguridad en una cuenta de super admin" && accountNotices[0].body === "ad***@demo.com · Cambió su contraseña" &&
    accountNotices[0].url === "/admin/activity?ver=seguridad",
  "el cambio de seguridad (del cron), una sola vez, que abre Actividad → Seguridad",
  accountNotices,
);
ok(
  attackNotices.length === 1 && attackNotices[0].body === "ri***@demo.com: 10 intentos fallidos en la última hora y 1 cuenta más",
  "los intentos fallidos: uno por cuenta y hora",
  attackNotices,
);
ok(!(await bell(ricardo, bellPath)).some((notice) => ["new_business", "plan_request", "account_security", "login_attack"].includes(notice.kind)), "ninguno de los del super admin llega a un negocio");
const adminUnread = await unreadAt(admin, adminPath);
const secondUnread = await unreadAt(second, adminPath);
const firstAdmin = (await bell(admin, adminPath))[0];
r = await admin("POST", `${adminPath}/${firstAdmin.id}/read`);
ok(r.status === 204 && (await unreadAt(admin, adminPath)) === adminUnread - 1 && (await unreadAt(second, adminPath)) === secondUnread, "cada super admin lleva su propio leído", [adminUnread, secondUnread]);
r = await admin("POST", `${adminPath}/read-all`);
ok(r.status === 204 && (await unreadAt(admin, adminPath)) === 0 && (await unreadAt(second, adminPath)) === secondUnread, "«Marcar todo como leído» en /admin");
r = await ricardo("GET", `${adminPath}/unread`);
ok(r.status === 403, "un propietario no entra a la campana de /admin", r.body);
const strict = await startApi({ SUPER_ADMIN_2FA: "required" });
const adminStrict = await as("admin@demo.com", { base: strict.base });
r = await adminStrict("GET", `${adminPath}/unread`);
ok(r.status === 403 && r.body.error.code === "two_factor_required", "sin la verificación en dos pasos (obligatoria): two_factor_required, como el resto de /admin", r.body);
strict.stop();

/* ======================================================================================== */
console.log("Leer no va a la actividad");
const auditBefore = count("select count(*) from audit_logs");
await unreadAt(valeria, bellPath);
const valeriaList = await bell(valeria, bellPath);
await valeria("POST", `${bellPath}/${valeriaList[0].id}/read`);
await valeria("POST", `${bellPath}/read-all`);
await unreadAt(second, adminPath);
await bell(second, adminPath);
await second("POST", `${adminPath}/read-all`);
ok(count("select count(*) from audit_logs") === auditBefore, "ver la campana, leer un aviso y «Marcar todo» no escriben en audit_logs", [auditBefore, count("select count(*) from audit_logs")]);

/* ======================================================================================== */
console.log("Privacidad (CE-003)");
const leaks = everything.filter((notice) => {
  const text = `${notice.title} ${notice.body}`;
  return (
    text.includes(SECRET_NOTE) ||
    people.some((who) => text.includes(who.email) || text.includes(who.documentId) || text.includes(who.phone) || text.includes(who.phone.replace(/\D/g, "").slice(-7)))
  );
});
ok(everything.length > 50 && leaks.length === 0, `en los ${everything.length} avisos que leyeron las campanas: ni la cédula, ni el email, ni el teléfono, ni las notas`, leaks.slice(0, 3));

push.close();
await pool.end();
done("del centro de avisos");
