// Citas que se repiten (spec 011): desde «Nueva cita» del panel se agenda de una vez una serie («cada
// semana, 8 sesiones»). Antes de crearla se ve la lista de fechas, con las que chocan marcadas; al
// crearla se vuelve a comprobar cada fecha con el negocio bloqueado (RF-005, CE-002). Un solo email por
// paciente (CE-003), un solo aviso de ntfy y una sola entrada de actividad. Cada cita sigue siendo una cita
// normal; «Cancelar ésta y las siguientes» cancela las activas desde ésa con un solo email.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, fakeNtfy, login, runCron, sql, startApi } from "./helpers/harness.ts";
import { applyPlanLimit, seriesDates } from "../src/shared/lib/appointment-series.ts";
import { PANEL_PENDING_MESSAGE } from "../src/shared/lib/constants/appointment-status.ts";
import { getAvailableSlots, scopeToProfessional } from "../src/shared/lib/availability.ts";
import { addDaysISO, addMonthsISO, getDayOfWeek, getZonedNow } from "../src/shared/lib/time.ts";
import type {
  Appointment,
  AppointmentSeriesCreated,
  AppointmentSeriesPreview,
  PublicBusinessProfile,
  SeriesDatePreview,
} from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { pool, transaction } = await import("../src/db/pool.ts");
const { runReminderJob } = await import("../src/services/notifications.ts");

console.log("Fechas (funciones compartidas)");
const weekly = seriesDates("2026-10-20", "weekly", 8);
ok(
  weekly.length === 8 && weekly.every((date, i) => date === addDaysISO("2026-10-20", 7 * i) && getDayOfWeek(date) === 2),
  "cada semana, 8 desde el martes 20 de octubre: 8 martes seguidos",
  weekly,
);
const biweekly = seriesDates("2026-10-20", "biweekly", 4);
ok(biweekly.join(",") === "2026-10-20,2026-11-03,2026-11-17,2026-12-01", "cada 2 semanas: de 14 en 14 días", biweekly);
const monthly31 = seriesDates("2027-01-31", "monthly", 5);
ok(monthly31.join(",") === "2027-01-31,2027-02-28,2027-03-31,2027-04-30,2027-05-31", "cada mes desde el 31 de enero: el último día de los meses cortos", monthly31);
ok(seriesDates("2028-01-31", "monthly", 2)[1] === "2028-02-29", "en un año bisiesto, el 29 de febrero");
ok(seriesDates("2026-10-15", "monthly", 3).join(",") === "2026-10-15,2026-11-15,2026-12-15", "desde el 15: el 15 de cada mes");
const limited = applyPlanLimit(
  ["2026-11-03", "2026-11-10", "2026-11-17", "2026-12-01"].map((date) => ({ date, status: "free" as const, reason: null })),
  { "2026-11": 2, "2026-12": 5 },
  20,
);
ok(
  limited.map((row) => row.status).join(",") === "free,free,plan_limit,free" &&
    limited[2].reason === "Supera el cupo del plan (20 citas al mes)",
  "applyPlanLimit: con 2 libres en el cupo de noviembre, la tercera de noviembre pasa el cupo y la de diciembre no",
  limited,
);
const skippingOne = applyPlanLimit(
  [
    { date: "2026-11-03", status: "busy" as const, reason: "Ya hay una cita" },
    { date: "2026-11-10", status: "free" as const, reason: null },
    { date: "2026-11-17", status: "blocked" as const, reason: "Bloqueado", allowAnyway: true },
    { date: "2026-11-24", status: "free" as const, reason: null },
  ],
  { "2026-11": 2 },
  20,
);
ok(
  skippingOne.map((row) => row.status).join(",") === "busy,free,blocked,plan_limit",
  "las que no se crean no gastan cupo; las que se agendan igual, sí",
  skippingOne,
);

/* ------------------------------------------------------------------ Preparación -- */

const owner = await login("jhordan@demo.com");
const businessId: string = owner.session.businessId;
const B = `/businesses/${businessId}`;
const businessName = sql(`select name from businesses where id = '${businessId}'`);
const zone = "America/Guayaquil";
sql(
  `update businesses set timezone = '${zone}',
          notification_settings = notification_settings
            || '{"confirmations": true, "cancellations": true, "reminders": true, "reminderHoursBefore": 24}'
    where id = '${businessId}'`,
);
const today = getZonedNow(zone).date;
// Lejos de las citas demo (hasta 21 días): cada prueba usa además su propia agenda.
sql(`delete from blocked_times where business_id = '${businessId}' and end_date > '${addDaysISO(today, 25)}'`);
let base = addDaysISO(today, 30);
while (getDayOfWeek(base) !== 2) base = addDaysISO(base, 1);
const week = (n: number) => addDaysISO(base, 7 * n);

const service = sql(
  `insert into services (business_id, name, duration_minutes, price, show_price, modes, home_visit_fee)
   values ('${businessId}', 'Terapia en serie', 60, 30, true, '{business,home,virtual}', 0) returning id`,
).split("\n")[0];

const COPY_EMAIL = "profesional.serie011@correo.ec";
let agendas = 0;
/** Una agenda propia, de lunes a viernes de 08:00 a 18:00 (así nada de otra prueba choca con la suya). */
function agenda(options: { email?: string; notify?: boolean } = {}) {
  const id = sql(
    `insert into professionals (business_id, display_name, email, all_services, notify_new_appointments)
     values ('${businessId}', 'Agenda Serie ${++agendas}', '${options.email ?? COPY_EMAIL}', true, ${options.notify ?? false}) returning id`,
  ).split("\n")[0];
  for (const day of [1, 2, 3, 4, 5]) {
    sql(
      `insert into schedules (business_id, professional_id, day_of_week, is_active, intervals)
       values ('${businessId}', '${id}', ${day}, true, '[{"start": "08:00", "end": "18:00"}]')`,
    );
  }
  return id;
}

const tag = Date.now().toString(36);
let seq = 0;
/** Un paciente con nombre, email, teléfono y cédula propios (`email: ""`, sin email). */
function patient(name: string, email?: string) {
  const address = email ?? `${name.split(" ")[0].toLowerCase()}.${++seq}.${tag}@correo.ec`;
  const phone = `09${String(80000000 + ++seq * 7919).slice(0, 8)}`;
  const id = sql(
    `insert into clients (business_id, name, document_id, email, phone)
     values ('${businessId}', '${name}', '${cedulaFor(`${tag}-${seq}`)}', '${address}', '${phone}') returning id`,
  ).split("\n")[0];
  return { id, name, email: address, phone };
}

type Who = typeof owner;
type Input = Record<string, unknown>;
const appointmentInput = (fields: Input): Input => ({
  extraClientIds: [],
  serviceId: service,
  date: base,
  startTime: "10:00",
  durationMinutes: 60,
  price: 30,
  status: "confirmed",
  notes: "Serie de prueba",
  homeVisit: null,
  isVirtual: false,
  ...fields,
});
const repeat = (count: number, frequency = "weekly") => ({ frequency, count });
const preview = (who: Who, appointment: Input, rep: Input, path = B) =>
  who("POST", `${path}/appointment-series/preview`, { appointment, repeat: rep });
const createSeries = (who: Who, appointment: Input, rep: Input, dates: Input[], path = B) =>
  who("POST", `${path}/appointment-series`, { appointment, repeat: rep, dates });
/** Las fechas de la vista previa, tal cual, para crearlas (las libres). */
const asDates = (rows: SeriesDatePreview[], patch: (row: SeriesDatePreview) => Input | null = () => ({})) =>
  rows.flatMap((row) => {
    const extra = patch(row);
    return extra === null ? [] : [{ date: row.date, startTime: row.startTime, ...extra }];
  });

/** Una cita suelta en la base (otra cita del profesional). */
const insertAppointment = (professionalId: string, clientId: string, date: string, start: string, end: string, status = "confirmed") =>
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${clientId}', '${service}', '${professionalId}', '${date}', '${start}', '${end}', '${status}', 30, 'dashboard')
     returning id`,
  ).split("\n")[0];

/** "tipo|destino" de los emails de unas citas, en orden. */
const emailsOf = (ids: string[]) =>
  ids.length === 0
    ? []
    : sql(
        `select type || '|' || to_email from notifications where appointment_id in (${ids.map((id) => `'${id}'`).join(", ")})
          order by created_at, case type when 'appointment_series' then 0 when 'appointment_series_cancelled' then 0 when 'appointment_copy' then 2 else 1 end,
                   to_email, id`,
      )
        .split("\n")
        .filter(Boolean);
const totals = () => ({
  appointments: count("select count(*) from appointments"),
  series: count("select count(*) from appointment_series"),
  emails: count("select count(*) from notifications"),
  logs: count("select count(*) from audit_logs"),
});

/* ------------------------------------------------------------------ Vista previa -- */

console.log("Vista previa: las marcas");
const ana = patient("Ana Serie");
const other = patient("Otra Paciente Privada");
const p1 = agenda();
insertAppointment(p1, other.id, week(1), "10:00", "11:00");
sql(
  `insert into blocked_times (business_id, professional_id, reason, start_date, end_date, all_day)
   values ('${businessId}', '${p1}', 'Congreso', '${week(2)}', '${week(2)}', true)`,
);
const before = totals();
const homeVisit = { address: "Av. Amazonas 123", reference: "Edificio azul", lat: null, lng: null };
const mainInput = appointmentInput({ clientId: ana.id, professionalId: p1, homeVisit, price: 35 });
let r = await preview(owner, mainInput, repeat(8));
let shown = r.body as AppointmentSeriesPreview;
ok(r.status === 200 && shown.dates.length === 8 && shown.planRemaining === null && shown.monthlyLimit === null, "8 fechas; plan Pro: sin cupo", r.body);
ok(
  shown.dates.every((row, i) => row.date === week(i) && row.startTime === "10:00" && row.endTime === "11:00"),
  "cada una con su día y su hora",
  shown.dates.map((row) => `${row.date} ${row.startTime}`),
);
const busy = shown.dates[1];
ok(
  busy.status === "busy" && busy.reason === "Ya hay una cita de 10:00 a 11:00" && busy.freeTimes.includes("11:00") && !busy.freeTimes.includes("10:00"),
  "la 2.ª: otra cita, con su franja y las horas libres de ese día",
  busy,
);
ok(!JSON.stringify(r.body).includes("Otra Paciente") && !JSON.stringify(r.body).includes(other.email), "el motivo no nombra al otro paciente", busy.reason);
ok(shown.dates[2].status === "blocked" && shown.dates[2].reason === "Bloqueado: Congreso" && shown.dates[2].freeTimes.length === 0, "la 3.ª: el bloqueo (de todo el día: sin horas libres)", shown.dates[2]);
ok(shown.dates.filter((row) => row.status === "free").length === 6 && shown.dates[0].freeTimes.length === 0, "las demás, libres (sin «Otra hora»)", shown.dates);

let sunday = base;
while (getDayOfWeek(sunday) !== 0) sunday = addDaysISO(sunday, 1);
r = await preview(owner, { ...mainInput, date: sunday }, repeat(2));
ok(
  r.status === 200 && r.body.dates.every((row: SeriesDatePreview) => row.status === "day_off" && row.reason === "Ese día no atiende" && row.freeTimes.length === 0),
  "un día que no atiende: «Ese día no atiende», sin horas libres",
  r.body,
);
r = await preview(owner, { ...mainInput, startTime: "17:30" }, repeat(2));
ok(
  r.status === 200 &&
    r.body.dates.every((row: SeriesDatePreview) => row.status === "outside_hours" && row.reason === "Fuera del horario de atención" && row.freeTimes.includes("08:00")),
  "una hora fuera de su horario: con las horas libres de ese día",
  r.body,
);

console.log("Vista previa: validaciones");
const invalid = {
  "la primera fecha ayer": await preview(owner, { ...mainInput, date: addDaysISO(today, -1) }, repeat(4)),
  "el estado «Atendida»": await preview(owner, { ...mainInput, status: "completed" }, repeat(4)),
  "25 citas": await preview(owner, mainInput, repeat(25)),
  "1 cita": await preview(owner, mainInput, repeat(1)),
  "una frecuencia que no existe": await preview(owner, mainInput, repeat(4, "daily")),
};
for (const [label, answer] of Object.entries(invalid)) ok(answer.status === 400 && answer.body.error.code === "validation", `${label} → 400`, answer.body);
ok(/anterior a hoy/.test(invalid["la primera fecha ayer"].body.error.message), "la primera fecha: «no puede ser anterior a hoy»", invalid["la primera fecha ayer"].body);
r = await preview(owner, { ...mainInput, date: today, startTime: "06:00" }, repeat(2));
ok(r.status === 200, "desde hoy sí (aunque la hora ya haya pasado: el panel registra citas a cualquier hora)", r.body);
ok(JSON.stringify(totals()) === JSON.stringify(before), "la vista previa no cambia nada: ni citas, ni series, ni emails, ni actividad", [before, totals()]);

console.log("Vista previa: el cupo del plan (Free)");
const laura = await login("laura@demo.com");
const lauraBusiness: string = laura.session.businessId;
const LB = `/businesses/${lauraBusiness}`;
const [lauraAgenda] = (await laura("GET", `${LB}/professionals`)).body as { id: string }[];
const lauraSchedule = ((await laura("GET", `${LB}/schedules`)).body as { dayOfWeek: number; isActive: boolean; intervals: { start: string }[] }[]).find(
  (day) => day.isActive && day.intervals.length > 0,
)!;
const lauraService = ((await laura("GET", `${LB}/services`)).body as { id: string; isActive: boolean; durationMinutes: number; modes: string[] }[]).find(
  (s) => s.isActive && s.modes.includes("business"),
)!;
const lauraClient = ((await laura("GET", `${LB}/clients`)).body as { id: string; isActive: boolean }[]).find((c) => c.isActive)!;
// Un mes sin citas demo, con cuatro fechas de ese día de la semana.
const month = addMonthsISO(addDaysISO(today, 25), 1);
let lauraFirst = month;
while (getDayOfWeek(lauraFirst) !== lauraSchedule.dayOfWeek) lauraFirst = addDaysISO(lauraFirst, 1);
sql(`delete from blocked_times where business_id = '${lauraBusiness}' and end_date >= '${month}'`);
sql(`update appointments set status = 'cancelled' where business_id = '${lauraBusiness}' and to_char(date, 'YYYY-MM') = '${month.slice(0, 7)}'`);
// 18 citas en el mes, en días que no son de la serie (la 1.ª semana de otros días, a varias horas).
const filler: string[] = [];
for (let day = 0; filler.length < 18 && day < 28; day++) {
  const date = addDaysISO(month, day);
  if (getDayOfWeek(date) === lauraSchedule.dayOfWeek) continue;
  for (const hour of ["06", "07", "21"]) {
    if (filler.length >= 18) break;
    filler.push(
      sql(
        `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
         values ('${lauraBusiness}', '${lauraClient.id}', '${lauraService.id}', '${lauraAgenda.id}', '${date}', '${hour}:00', '${hour}:30', 'confirmed', 10, 'dashboard')
         returning id`,
      ).split("\n")[0],
    );
  }
}
const lauraInput = {
  clientId: lauraClient.id,
  extraClientIds: [],
  serviceId: lauraService.id,
  date: lauraFirst,
  startTime: lauraSchedule.intervals[0].start,
  durationMinutes: lauraService.durationMinutes,
  price: 10,
  status: "confirmed",
  notes: "",
  homeVisit: null,
  isVirtual: false,
  professionalId: lauraAgenda.id,
};
r = await preview(laura, lauraInput, repeat(4), LB);
shown = r.body as AppointmentSeriesPreview;
const monthKey = month.slice(0, 7);
ok(
  r.status === 200 &&
    shown.monthlyLimit === 20 &&
    shown.planRemaining?.[monthKey] === 2 &&
    shown.dates.map((row) => row.status).join(",") === "free,free,plan_limit,plan_limit" &&
    shown.dates[2].reason === "Supera el cupo del plan (20 citas al mes)",
  "con 18 citas en el mes, de 4 fechas las 2 últimas «Supera el cupo del plan (20 citas al mes)»",
  r.body,
);
ok(Object.values(shown.planRemaining ?? {}).every((left) => left <= 24), "el cupo que llega nunca pasa de 24", shown.planRemaining);
r = await preview(laura, { ...lauraInput, date: addMonthsISO(month, 2) }, repeat(2), LB);
ok(r.status === 200 && Object.values(r.body.planRemaining ?? {}).every((left) => left === 20), "un mes vacío: quedan las 20 del plan", r.body.planRemaining);

/* ------------------------------------------------------------------------ Crear -- */

console.log("Crear: 8 fechas, una con otra hora y una quitada");
r = await preview(owner, mainInput, repeat(8));
const rows = r.body.dates as SeriesDatePreview[];
const moved = rows[1].freeTimes.includes("14:00") ? "14:00" : rows[1].freeTimes[0];
const finalDates = asDates(rows, (row) => (row.status === "blocked" ? null : row.status === "busy" ? { startTime: moved } : {}));
r = await createSeries(owner, mainInput, repeat(8), finalDates);
const created = r.body as AppointmentSeriesCreated;
ok(r.status === 201 && created.created.length === 7 && created.skipped.length === 0, "201: se crean 7, sin saltadas", r.body);
const seriesId = created.series.id;
ok(
  created.series.total === 7 &&
    created.series.frequency === "weekly" &&
    created.created.every(
      (appointment, i) =>
        appointment.series?.id === seriesId && appointment.series.index === i + 1 && appointment.series.total === 7 && appointment.series.frequency === "weekly",
    ),
  "numeradas de 1 a 7, sin huecos, cada una con su serie",
  created.created.map((appointment) => appointment.series),
);
ok(
  created.created.every(
    (appointment) =>
      appointment.clientId === ana.id &&
      appointment.serviceId === service &&
      appointment.professionalId === p1 &&
      appointment.homeVisit?.address === "Av. Amazonas 123" &&
      !appointment.isVirtual &&
      appointment.price === 35 &&
      appointment.notes === "Serie de prueba" &&
      appointment.status === "confirmed" &&
      appointment.source === "dashboard",
  ),
  "todas con el mismo paciente, servicio, profesional, modalidad (con la dirección), precio y notas",
  created.created[0],
);
ok(created.created[1].date === week(1) && created.created[1].startTime === moved && !created.created.some((a) => a.date === week(2)), "la 2.ª a la otra hora y sin la 3.ª", created.created.map((a) => `${a.date} ${a.startTime}`));
ok(sql(`select requested_count || '/' || created_count from appointment_series where id = '${seriesId}'`) === "8/7", "la serie guarda 8 pedidas y 7 creadas");
const ids = created.created.map((appointment) => appointment.id);
r = await owner("GET", `${B}/appointments/${ids[2]}`);
ok(r.status === 200 && r.body.series?.index === 3 && r.body.series.total === 7, "la ficha la lee con su serie («Cita 3 de 7»)", r.body?.series);
r = await owner("GET", `${B}/appointments?from=${base}&to=${week(8)}`);
ok((r.body as Appointment[]).filter((appointment) => appointment.series?.id === seriesId).length === 7, "y la agenda también", r.body.length);
ok(
  (r.body as Appointment[]).every((appointment) => appointment.series === null || typeof appointment.series.index === "number"),
  "las citas sueltas, con series: null",
);

console.log("Crear: actividad");
const seriesLogs = (await owner("GET", `${B}/audit-logs?entityType=appointment&entityId=${seriesId}`)).body.entries as {
  action: string;
  summary: string;
  changes: { label: string; after: string }[] | null;
}[];
ok(
  seriesLogs.length === 1 &&
    seriesLogs[0].action === "appointment.series_created" &&
    seriesLogs[0].summary === `Agendó una serie de 7 citas de Ana Serie, cada semana desde el ${base.split("-").reverse().join("/")} 10:00 (1 no se creó)`,
  "una sola entrada: «Agendó una serie de 7 citas de …, cada semana desde el … (1 no se creó)»",
  seriesLogs,
);
ok(seriesLogs[0]?.changes?.[0]?.label === "Fechas" && seriesLogs[0].changes[0].after.split(", ").length === 7, "con las fechas en «Fechas»", seriesLogs[0]?.changes);
ok(count(`select count(*) from audit_logs where action = 'appointment.created' and entity_id in (${ids.map((id) => `'${id}'`).join(", ")})`) === 0, "ninguna «Creó la cita» de esas citas");

console.log("Crear: emails");
let emails = emailsOf(ids);
ok(
  emails.length === 2 && emails[0] === `appointment_series|${ana.email}` && emails[1] === `appointment_copy|${COPY_EMAIL}`,
  "un solo «Serie de citas» al paciente y su copia al profesional (ni una confirmación por cita)",
  emails,
);
const seriesEmail = sql(`select subject || '|' || body from notifications where appointment_id = '${ids[0]}' and type = 'appointment_series'`);
ok(seriesEmail.startsWith(`Tus próximas 7 citas en ${businessName}|`) && /Tus 7 citas de Terapia en serie con Agenda Serie 1 están confirmadas\./.test(seriesEmail), "«Tus próximas 7 citas en …», confirmadas", seriesEmail.slice(0, 300));
const tokens = sql(`select payment_token from appointments where series_id = '${seriesId}' order by series_index`).split("\n");
ok(tokens.every((token) => seriesEmail.includes(`/cita/${token}`)) && /Cita 7: /.test(seriesEmail), "cada fecha enlaza a su página «Tu cita» (spec 010)", seriesEmail);
const copyEmail = sql(`select subject || '|' || body from notifications where appointment_id = '${ids[0]}' and type = 'appointment_copy'`);
ok(copyEmail.startsWith("Copia · Ana Serie: Tus próximas 7 citas") && !copyEmail.includes("/cita/") && /Ver en la agenda/.test(copyEmail), "la copia, sin los enlaces de cada fecha", copyEmail.slice(0, 400));

console.log("Crear: una fecha en un bloqueo");
const p2 = agenda();
const bea = patient("Bea Bloqueo");
sql(
  `insert into blocked_times (business_id, professional_id, reason, start_date, end_date, all_day, start_time, end_time)
   values ('${businessId}', '${p2}', 'Trámite', '${week(1)}', '${week(1)}', false, '09:00', '12:00')`,
);
const beaInput = appointmentInput({ clientId: bea.id, professionalId: p2 });
r = await preview(owner, beaInput, repeat(3));
ok(r.body.dates[1].status === "blocked" && r.body.dates[1].freeTimes.includes("12:00"), "el bloqueo de unas horas, con «Otra hora»", r.body.dates[1]);
r = await createSeries(owner, beaInput, repeat(3), asDates(r.body.dates));
ok(
  r.status === 201 && r.body.created.length === 2 && r.body.skipped.length === 1 && r.body.skipped[0].date === week(1) && r.body.skipped[0].reason === "Se bloqueó mientras revisabas la lista",
  "sin «Agendar igual» no se crea (vuelve en skipped)",
  r.body,
);
const p3 = agenda();
sql(
  `insert into blocked_times (business_id, professional_id, reason, start_date, end_date, all_day)
   values ('${businessId}', '${p3}', 'Vacaciones', '${week(2)}', '${week(2)}', true)`,
);
r = await createSeries(owner, { ...beaInput, professionalId: p3, date: week(2) }, repeat(2), [
  { date: week(2), startTime: "10:00", allowOutsideHours: true },
  { date: week(3), startTime: "10:00" },
]);
ok(r.status === 201 && r.body.created.length === 2 && r.body.created[0].date === week(2) && r.body.skipped.length === 0, "con «Agendar igual», sí", r.body);
const outside = agenda();
r = await createSeries(owner, { ...beaInput, professionalId: outside, startTime: "19:00" }, repeat(2), [
  { date: week(0), startTime: "19:00", allowOutsideHours: true },
  { date: week(1), startTime: "19:00" },
]);
ok(r.status === 201 && r.body.created.length === 1 && r.body.skipped[0]?.date === week(1), "fuera de horario: sólo la que se agenda igual", r.body);

console.log("Crear: fechas que no son de la serie");
const p4 = agenda();
const carla = patient("Carla Fechas");
const carlaInput = appointmentInput({ clientId: carla.id, professionalId: p4 });
const beforeBad = totals();
const bad = {
  "una fecha que no es de la serie": await createSeries(owner, carlaInput, repeat(4), [
    { date: week(0), startTime: "10:00" },
    { date: addDaysISO(week(1), 1), startTime: "10:00" },
  ]),
  "una fecha repetida": await createSeries(owner, carlaInput, repeat(4), [
    { date: week(0), startTime: "10:00" },
    { date: week(0), startTime: "11:00" },
  ]),
  "una sola fecha": await createSeries(owner, carlaInput, repeat(4), [{ date: week(0), startTime: "10:00" }]),
};
for (const [label, answer] of Object.entries(bad)) ok(answer.status === 400, `${label} → 400`, answer.body);
ok(JSON.stringify(totals()) === JSON.stringify(beforeBad), "y no se crea nada", [beforeBad, totals()]);

console.log("Crear: se ocupó mientras tanto (RF-005)");
r = await preview(owner, carlaInput, repeat(6));
ok(r.body.dates.every((row: SeriesDatePreview) => row.status === "free"), "en la lista, las 6 libres", r.body.dates);
const meanwhile = await owner("POST", `${B}/appointments`, { ...appointmentInput({ clientId: other.id, professionalId: p4, date: week(4), startTime: "10:30" }) });
ok(meanwhile.status === 200, "otra persona agenda una cita suelta en la 5.ª fecha", meanwhile.body);
r = await createSeries(owner, carlaInput, repeat(6), asDates(r.body.dates));
ok(
  r.status === 201 &&
    r.body.created.length === 5 &&
    r.body.skipped.length === 1 &&
    r.body.skipped[0].date === week(4) &&
    r.body.skipped[0].reason === "Se ocupó mientras revisabas la lista" &&
    r.body.created.map((a: Appointment) => a.series?.index).join(",") === "1,2,3,4,5",
  "esa fecha vuelve en skipped con «Se ocupó mientras revisabas la lista» y las demás se crean, numeradas sin huecos",
  r.body,
);

console.log("Crear: ninguna se puede crear");
const seriesBefore = count("select count(*) from appointment_series");
r = await createSeries(owner, carlaInput, repeat(6), asDates(r.body.created as SeriesDatePreview[]));
ok(r.status === 409 && r.body.error.message === "No se creó ninguna cita: todas las fechas chocan. Revisa la lista.", "todas chocan → 409", r.body);
ok(count("select count(*) from appointment_series") === seriesBefore, "y no queda ninguna serie");
const fill = Math.max(0, 20 - count(`select count(*) from appointments where business_id = '${lauraBusiness}' and status <> 'cancelled' and to_char(date, 'YYYY-MM') = '${monthKey}'`));
for (let i = 0; i < fill; i++) {
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${lauraBusiness}', '${lauraClient.id}', '${lauraService.id}', '${lauraAgenda.id}', '${addDaysISO(month, 27)}', '${String(i).padStart(2, "0")}:00', '${String(i).padStart(2, "0")}:30', 'confirmed', 10, 'dashboard')`,
  );
}
r = await createSeries(laura, lauraInput, repeat(4), [
  { date: lauraFirst, startTime: lauraInput.startTime },
  { date: addDaysISO(lauraFirst, 7), startTime: lauraInput.startTime },
], LB);
ok(r.status === 402 && r.body.error.code === "plan_limit" && /límite de citas de tu plan/.test(r.body.error.message), "todas pasaban el cupo → 402", r.body);
ok(count("select count(*) from appointment_series") === seriesBefore, "tampoco queda una serie");

console.log("Crear: sesión en pareja");
sql(`update businesses set multi_client_appointments = true where id = '${businessId}'`);
const p5 = agenda();
const dani = patient("Dani Pareja");
const eli = patient("Eli Pareja");
r = await createSeries(owner, appointmentInput({ clientId: dani.id, extraClientIds: [eli.id], professionalId: p5 }), repeat(3), [
  { date: week(0), startTime: "10:00" },
  { date: week(1), startTime: "10:00" },
  { date: week(2), startTime: "10:00" },
]);
const couple = r.body as AppointmentSeriesCreated;
ok(r.status === 201 && couple.created.every((a) => a.clientId === dani.id && a.extraClientIds.join() === eli.id), "cada cita de la serie tiene a los dos pacientes", couple.created?.map((a) => a.extraClientIds));
emails = emailsOf(couple.created.map((a) => a.id));
ok(
  emails.join(",") === [`appointment_series|${dani.email}`, `appointment_series|${eli.email}`, `appointment_copy|${COPY_EMAIL}`].join(","),
  "un «Serie de citas» a cada uno y una sola copia",
  emails,
);
const eliEmail = sql(`select body from notifications where appointment_id = '${couple.created[0].id}' and to_email = '${eli.email}'`);
const eliTokens = sql(
  `select access_token from appointment_clients where client_id = '${eli.id}' and appointment_id in (${couple.created.map((a) => `'${a.id}'`).join(", ")})`,
).split("\n");
ok(eliTokens.length === 3 && eliTokens.every((token) => eliEmail.includes(`/cita/${token}`)) && !couple.created.some((a) => eliEmail.includes(a.paymentToken)), "con los enlaces de cada uno a sus citas", eliEmail);
const p6 = agenda();
const shared = `pareja.${tag}@correo.ec`;
const fer = patient("Fer Comparte", shared);
const gabi = patient("Gabi Comparte", shared);
r = await createSeries(owner, appointmentInput({ clientId: fer.id, extraClientIds: [gabi.id], professionalId: p6 }), repeat(2), [
  { date: week(0), startTime: "10:00" },
  { date: week(1), startTime: "10:00" },
]);
ok(emailsOf(r.body.created.map((a: Appointment) => a.id)).filter((email) => email.startsWith("appointment_series|")).length === 1, "uno solo si comparten el email", emailsOf(r.body.created.map((a: Appointment) => a.id)));

console.log("Crear: las citas del panel nacen confirmadas, «Confirmaciones» y el aviso al profesional");
// Desde el 2026-10-17, «Pendiente» es sólo para las reservas online: ni una serie ni una cita del panel nacen así.
const p7 = agenda();
const hugo = patient("Hugo Pendiente");
r = await createSeries(owner, appointmentInput({ clientId: hugo.id, professionalId: p7, status: "pending" }), repeat(3), [
  { date: week(0), startTime: "10:00" },
  { date: week(1), startTime: "10:00" },
  { date: week(2), startTime: "10:00" },
]);
ok(
  r.status === 400 && r.body.error.message === PANEL_PENDING_MESSAGE && count(`select count(*) from appointments where client_id = '${hugo.id}'`) === 0,
  "una serie «Pendiente» desde el panel: 400 y ninguna cita",
  r.body,
);
r = await owner("POST", `${B}/appointments`, appointmentInput({ clientId: hugo.id, professionalId: p7, date: week(0), startTime: "16:00", status: "pending" }));
ok(r.status === 400 && r.body.error.message === PANEL_PENDING_MESSAGE, "ni una cita suelta «Pendiente» desde el panel: 400", r.body);
r = await owner("POST", `${B}/appointments`, appointmentInput({ clientId: hugo.id, professionalId: p7, date: week(0), startTime: "16:00" }));
ok(r.status === 200 && r.body.status === "confirmed", "confirmada, sí", r.body);
// Las series «Pendientes» de antes del 2026-10-17 siguen funcionando (más abajo se confirma una y se cancela
// otra): se crea confirmada y se deja pendiente en la base, como quedaron aquéllas.
r = await createSeries(owner, appointmentInput({ clientId: hugo.id, professionalId: p7 }), repeat(3), [
  { date: week(0), startTime: "10:00" },
  { date: week(1), startTime: "10:00" },
  { date: week(2), startTime: "10:00" },
]);
const pending = r.body as AppointmentSeriesCreated;
sql(`update appointments set status = 'pending' where series_id = '${pending.series.id}'`);
sql(`update businesses set notification_settings = notification_settings || '{"confirmations": false}' where id = '${businessId}'`);
const PRO_EMAIL = "avisos.serie011@correo.ec";
const p8 = agenda({ email: PRO_EMAIL, notify: true });
const ines = patient("Ines Sin Confirmaciones");
r = await createSeries(owner, appointmentInput({ clientId: ines.id, professionalId: p8 }), repeat(3), [
  { date: week(0), startTime: "10:00" },
  { date: week(1), startTime: "10:00" },
  { date: week(2), startTime: "10:00" },
]);
emails = emailsOf(r.body.created.map((a: Appointment) => a.id));
ok(emails.join(",") === `professional_new_appointment|${PRO_EMAIL}`, "«Confirmaciones» apagado: ni el email ni la copia; sólo un aviso al profesional", emails);
const notice = sql(`select subject || '|' || body from notifications where appointment_id = '${r.body.created[0].id}' and type = 'professional_new_appointment'`);
ok(
  notice.startsWith("Nueva serie: Ines Sin Confirmaciones · 3 citas desde el martes ") && /Cita 3: /.test(notice) && /agendaron una serie de 3 citas en tu agenda/.test(notice),
  "«Nueva serie: … · 3 citas desde el …», con las fechas",
  notice,
);
sql(`update businesses set notification_settings = notification_settings || '{"confirmations": true}' where id = '${businessId}'`);
const p9 = agenda({ email: PRO_EMAIL, notify: true });
r = await createSeries(owner, appointmentInput({ clientId: ines.id, professionalId: p9 }), repeat(2), [
  { date: week(0), startTime: "10:00" },
  { date: week(1), startTime: "10:00" },
]);
emails = emailsOf(r.body.created.map((a: Appointment) => a.id));
ok(emails.join(",") === `appointment_series|${ines.email},appointment_copy|${PRO_EMAIL}`, "con la copia a su email, no le llega además el aviso", emails);

console.log("Crear: con el cupo de Gmail lleno, nada se descarta al ponerlo en cola (spec 015)");
// Antes, el tope de 400 emails a terceros los marcaba «No enviado…» y no salía la copia. Ahora el cupo se
// mira al enviar (tests/email-quota.test.ts): el email de la serie y su copia esperan en la cola.
sql(
  `insert into notifications (business_id, type, to_email, subject, body, status, attempts, sent_at)
   select null, 'appointment_confirmed', 'cupo' || g || '@correo.ec', 'Cupo', '', 'sent', 1, now() from generate_series(1, 3) g`,
);
const capped = await startApi({ EMAIL_DAILY_QUOTA: "3", EMAIL_TEAM_RESERVE: "0", EMAIL_PATIENT_RESERVE: "1" });
try {
  const ownerCapped = await login("jhordan@demo.com", { base: capped.base });
  const p10 = agenda();
  const julia = patient("Julia Tope");
  r = await createSeries(ownerCapped, appointmentInput({ clientId: julia.id, professionalId: p10 }), repeat(2), [
    { date: week(0), startTime: "10:00" },
    { date: week(1), startTime: "10:00" },
  ], B);
  const held = sql(
    `select string_agg(type || '|' || status || '|' || coalesce(last_error, ''), ',' order by created_at, type desc)
       from notifications where appointment_id = '${r.body.created?.[0]?.id}'`,
  );
  ok(
    r.status === 201 && held.split(",").includes("appointment_series|queued|") && held.split(",").includes("appointment_copy|queued|") && !held.includes("|failed|"),
    "el email de la serie y su copia quedan en cola, sin «No enviado…»",
    held,
  );
} finally {
  capped.stop();
  sql("delete from notifications where to_email like 'cupo%@correo.ec'");
}

console.log("Recordatorios: uno por cita, el día que toca");
const second = created.created[1];
const [hours, minutes] = second.startTime.split(":").map(Number);
const at = new Date(`${second.date}T${String(hours - 2).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00-05:00`);
await transaction((db) => runReminderJob(db, businessId, at));
emails = emailsOf([second.id]);
ok(
  emails.includes(`appointment_reminder|${ana.email}`) && emails.filter((email) => email === `appointment_copy|${COPY_EMAIL}`).length === 1,
  "runReminderJob en el día de la 2.ª pone en cola su recordatorio y su copia",
  emails,
);
ok(emailsOf([created.created[2].id]).length === 0, "y nada de las otras citas de la serie", emailsOf([created.created[2].id]));

/* ------------------------------------------------------------------ Cada cita, sola -- */

console.log("Cada cita, sola");
const fourth = created.created[3];
r = await owner("PUT", `${B}/appointments/${fourth.id}`, {
  ...mainInput,
  date: fourth.date,
  startTime: "15:00",
});
ok(r.status === 200 && r.body.startTime === "15:00" && r.body.series?.index === 4 && r.body.series.total === 7, "cambiarle la hora a la 4.ª: conserva su serie", r.body);
ok(
  sql(`select string_agg(to_char(start_time, 'HH24:MI'), ',' order by series_index) from appointments where series_id = '${seriesId}'`) ===
    ["10:00", moved, "10:00", "15:00", "10:00", "10:00", "10:00"].join(","),
  "y sólo cambia ésa",
);
r = await owner("PATCH", `${B}/appointments/${pending.created[1].id}/status`, { status: "confirmed" });
ok(r.status === 200 && emailsOf([pending.created[1].id]).includes(`appointment_confirmed|${hugo.email}`), "confirmar la 2.ª de la serie pendiente manda su «Cita confirmada», como siempre", emailsOf([pending.created[1].id]));

/* ------------------------------------------------- Cancelar ésta y las siguientes -- */

console.log("Cancelar ésta y las siguientes");
r = await owner("PATCH", `${B}/appointments/${ids[4]}/status`, { status: "completed", notify: false });
ok(r.status === 200, "la 5.ª ya está «Atendida»", r.body);
r = await owner("POST", `${B}/appointments/${ids[2]}/cancel-following`, { notify: true });
ok(
  r.status === 200 && r.body.cancelled.map((a: Appointment) => a.series?.index).join(",") === "3,4,6,7" && r.body.cancelled.every((a: Appointment) => a.status === "cancelled"),
  "desde la 3.ª de 7: se cancelan la 3.ª, la 4.ª, la 6.ª y la 7.ª",
  r.body,
);
ok(
  sql(`select string_agg(status, ',' order by series_index) from appointments where series_id = '${seriesId}'`) ===
    "confirmed,confirmed,cancelled,cancelled,completed,cancelled,cancelled",
  "la 1.ª, la 2.ª y la 5.ª no cambian",
);
const cancelEmails = sql(
  `select type || '|' || to_email || '|' || subject from notifications
    where type in ('appointment_series_cancelled', 'appointment_copy') and subject like '%cancelaron%'
      and appointment_id in (${ids.map((id) => `'${id}'`).join(", ")})
    order by type desc`,
)
  .split("\n")
  .filter(Boolean);
ok(
  cancelEmails.length === 2 &&
    cancelEmails[0] === `appointment_series_cancelled|${ana.email}|Se cancelaron 4 citas en ${businessName}` &&
    cancelEmails[1].startsWith(`appointment_copy|${COPY_EMAIL}|Copia · Ana Serie: Se cancelaron 4 citas`),
  "un solo «Se cancelaron 4 citas en …» al paciente y una copia",
  cancelEmails,
);
const cancelBody = sql(`select body from notifications where type = 'appointment_series_cancelled' and to_email = '${ana.email}'`);
ok(/Cita 4: /.test(cancelBody) && !/Cita 5: /.test(cancelBody) && /Reservar una nueva cita/.test(cancelBody) && !cancelBody.includes("/cita/"), "con las 4 fechas y «Reservar una nueva cita», sin enlaces a las citas canceladas", cancelBody);
ok(count(`select count(*) from notifications where type = 'appointment_cancelled' and appointment_id in (${ids.map((id) => `'${id}'`).join(", ")})`) === 0, "ninguna cancelación por cita");
const cancelLogs = (await owner("GET", `${B}/audit-logs?entityType=appointment&entityId=${seriesId}`)).body.entries.filter(
  (entry: { action: string }) => entry.action === "appointment.series_cancelled",
);
ok(
  cancelLogs.length === 1 &&
    cancelLogs[0].summary === `Canceló 4 citas de la serie de Ana Serie desde el ${created.created[2].date.split("-").reverse().join("/")} 10:00` &&
    cancelLogs[0].changes?.[0]?.label === "Citas canceladas",
  "una sola entrada «Canceló 4 citas de la serie de … desde el …»",
  cancelLogs,
);
r = await owner("POST", `${B}/appointments/${ids[2]}/cancel-following`, { notify: true });
ok(r.status === 409 && r.body.error.message === "No quedan citas activas de la serie desde ésta.", "repetirlo → 409 «No quedan citas activas…»", r.body);
r = await owner("POST", `${B}/appointments/${meanwhile.body.id}/cancel-following`, {});
ok(r.status === 409 && r.body.error.message === "Esta cita no es de una serie.", "una cita suelta → 409 «Esta cita no es de una serie.»", r.body);

const silentCancel = await owner("POST", `${B}/appointments/${couple.created[1].id}/cancel-following`, { notify: false });
ok(silentCancel.status === 200 && silentCancel.body.cancelled.length === 2, "con notify: false, se cancelan", silentCancel.body);
ok(count(`select count(*) from notifications where type = 'appointment_series_cancelled' and appointment_id in (${couple.created.map((a) => `'${a.id}'`).join(", ")})`) === 0, "pero sin ningún email");
const silentLog = sql(`select summary from audit_logs where action = 'appointment.series_cancelled' and entity_id = '${couple.series.id}'`);
ok(silentLog.endsWith("(sin avisar al paciente)"), "y la actividad termina en «(sin avisar al paciente)»", silentLog);
sql(`update businesses set notification_settings = notification_settings || '{"cancellations": false}' where id = '${businessId}'`);
r = await owner("POST", `${B}/appointments/${pending.created[0].id}/cancel-following`, {});
ok(r.status === 200 && r.body.cancelled.length === 3, "con «Cancelaciones» apagado, se cancelan…", r.body);
ok(count(`select count(*) from notifications where type = 'appointment_series_cancelled' and appointment_id in (${pending.created.map((a) => `'${a.id}'`).join(", ")})`) === 0, "…sin ningún email");
sql(`update businesses set notification_settings = notification_settings || '{"cancellations": true}' where id = '${businessId}'`);

/* -------------------------------------------------------------- Rol Profesional -- */

console.log("Rol Profesional (Valeria)");
const valeria = await login("valeria@demo.com");
const dentalId: string = valeria.session.businessId;
const VB = `/businesses/${dentalId}`;
const ricardo = await login("ricardo@demo.com");
const valeriaAgenda = sql(`select p.id from professionals p join users u on u.id = p.user_id where u.email = 'valeria@demo.com'`);
const ricardoAgenda = sql(
  `select p.id from professionals p where p.business_id = '${dentalId}' and p.id <> '${valeriaAgenda}' and p.is_active order by p.sort_order limit 1`,
);
// Un servicio que atienden las dos agendas (para pasar una cita de una a otra).
const offers = (agendaId: string) =>
  `exists (select 1 from professionals p where p.id = '${agendaId}'
             and (p.all_services or exists (select 1 from professional_services ps where ps.professional_id = p.id and ps.service_id = s.id)))`;
const dentalService = sql(
  `select s.id from services s where s.business_id = '${dentalId}' and s.is_active and 'business' = any(s.modes)
      and ${offers(valeriaAgenda)} and ${offers(ricardoAgenda)}
    order by s.created_at limit 1`,
);
const dentalClient = sql(
  `insert into clients (business_id, name, document_id, email, phone)
   values ('${dentalId}', 'Paciente De Valeria', '${cedulaFor(`${tag}-valeria`)}', 'valeria.paciente.${tag}@correo.ec', '0991112233') returning id`,
).split("\n")[0];
let far = addDaysISO(today, 200);
while (getDayOfWeek(far) !== 3) far = addDaysISO(far, 1);
const valeriaInput = {
  clientId: dentalClient,
  extraClientIds: [],
  serviceId: dentalService,
  date: far,
  startTime: "06:00",
  durationMinutes: 30,
  price: 20,
  status: "confirmed",
  notes: "",
  homeVisit: null,
  isVirtual: false,
  professionalId: "",
};
const farDates = [0, 1, 2, 3].map((n) => ({ date: addDaysISO(far, 7 * n), startTime: "06:00", allowOutsideHours: true }));
r = await preview(valeria, valeriaInput, repeat(4), VB);
ok(r.status === 200 && r.body.dates.length === 4, "la lista en su agenda", r.body);
r = await createSeries(valeria, valeriaInput, repeat(4), farDates, VB);
const valeriaSeries = r.body as AppointmentSeriesCreated;
ok(r.status === 201 && valeriaSeries.created.length === 4 && valeriaSeries.created.every((a) => a.professionalId === valeriaAgenda), "crea una serie en su agenda", r.body);
r = await createSeries(valeria, { ...valeriaInput, professionalId: ricardoAgenda }, repeat(4), farDates, VB);
ok(r.status === 403 && r.body.error.message === "Sólo puedes agendar citas en tu propia agenda.", "en otra agenda → 403", r.body);
r = await preview(valeria, { ...valeriaInput, professionalId: ricardoAgenda }, repeat(4), VB);
ok(r.status === 403, "y tampoco la lista de otra agenda", r.body);
sql(`update businesses set professional_scope = 'own' where id = '${dentalId}'`);
const stranger = sql(
  `insert into clients (business_id, name, document_id, email, phone)
   values ('${dentalId}', 'Paciente Ajeno', '${cedulaFor(`${tag}-ajeno`)}', 'ajeno.${tag}@correo.ec', '0991112244') returning id`,
).split("\n")[0];
r = await preview(valeria, { ...valeriaInput, clientId: stranger }, repeat(2), VB);
const r2 = await createSeries(valeria, { ...valeriaInput, clientId: stranger, date: addDaysISO(far, 28 * 7) }, repeat(2), [
  { date: addDaysISO(far, 28 * 7), startTime: "06:00", allowOutsideHours: true },
  { date: addDaysISO(far, 29 * 7), startTime: "06:00", allowOutsideHours: true },
], VB);
ok(r.status === 404 && r2.status === 404, "con «sólo sus pacientes», con un paciente que no es suyo → 404", [r.body, r2.body]);
sql(`update businesses set professional_scope = 'all' where id = '${dentalId}'`);
const third = valeriaSeries.created[2];
r = await ricardo("PUT", `${VB}/appointments/${third.id}`, { ...valeriaInput, date: third.date, professionalId: ricardoAgenda });
ok(r.status === 200 && r.body.professionalId === ricardoAgenda, "recepción pasa la 3.ª a otra agenda", r.body);
r = await valeria("POST", `${VB}/appointments/${valeriaSeries.created[1].id}/cancel-following`, { notify: false });
ok(
  r.status === 200 && r.body.cancelled.map((a: Appointment) => a.series?.index).join(",") === "2,4" &&
    sql(`select status from appointments where id = '${third.id}'`) === "confirmed",
  "«Cancelar ésta y las siguientes» de Valeria no cancela la que se pasó a otra agenda",
  r.body,
);
r = await valeria("POST", `${VB}/appointments/${third.id}/cancel-following`, {});
ok(r.status === 404, "ni la deja cancelarla desde ella (no es de su agenda)", r.body);

/* --------------------------------------------------------------- Dos a la vez -- */

console.log("Dos series a la vez (CE-002)");
const overlaps = (professionalId: string) =>
  count(
    `select count(*) from appointments a join appointments b
        on a.professional_id = b.professional_id and a.id < b.id and a.date = b.date
     where a.professional_id = '${professionalId}'
       and a.status in ('pending', 'confirmed', 'completed') and b.status in ('pending', 'confirmed', 'completed')
       and tsrange(a.date + a.start_time, a.date + a.end_time) && tsrange(b.date + b.start_time, b.date + b.end_time)`,
  );
const race = agenda();
const kai = patient("Kai Carrera");
const leo = patient("Leo Carrera");
const seriesA = appointmentInput({ clientId: kai.id, professionalId: race });
const seriesB = appointmentInput({ clientId: leo.id, professionalId: race, date: week(2) });
const [previewA, previewB] = await Promise.all([preview(owner, seriesA, repeat(8)), preview(owner, seriesB, repeat(8))]);
ok(
  [...previewA.body.dates, ...previewB.body.dates].every((row: SeriesDatePreview) => row.status === "free"),
  "las dos listas, libres (se revisaron a la vez)",
);
const [raceA, raceB] = await Promise.all([
  createSeries(owner, seriesA, repeat(8), asDates(previewA.body.dates)),
  createSeries(owner, seriesB, repeat(8), asDates(previewB.body.dates)),
]);
const createdTotal = (raceA.body.created?.length ?? 0) + (raceB.body.created?.length ?? 0);
const skippedAll = [...(raceA.body.skipped ?? []), ...(raceB.body.skipped ?? [])];
ok(raceA.status === 201 && raceB.status === 201 && createdTotal === 10 && skippedAll.length === 6, "una detrás de otra: 8 + 2 creadas y 6 saltadas", [raceA.body, raceB.body]);
ok(skippedAll.every((item: { reason: string }) => item.reason === "Se ocupó mientras revisabas la lista"), "lo que no se creó vuelve en skipped, con su motivo", skippedAll);
ok(overlaps(race) === 0, "ninguna cita activa del profesional se solapa con otra (tsrange &&)", overlaps(race));

console.log("Una serie y una reserva online a la vez");
const online = agenda();
const profile: PublicBusinessProfile = (await agent()("GET", `/public/businesses/${sql(`select slug from businesses where id = '${businessId}'`)}?t=${Date.now()}`)).body;
const publicService = profile.services.find((s) => s.id === service)!;
const nowZoned = getZonedNow(profile.business.timezone);
const context = { ...profile, settings: profile.business.bookingSettings, now: nowZoned };
let slot: { date: string; time: string } | null = null;
for (let d = 3; d < 40 && !slot; d++) {
  const date = addDaysISO(nowZoned.date, d);
  const [time] = getAvailableSlots(date, publicService.durationMinutes, scopeToProfessional(context, online));
  if (time) slot = { date, time };
}
ok(slot !== null && publicService !== undefined, "una hora libre en la página de reservas", slot);
const mia = patient("Mia Carrera");
const visitorEmail = `reserva.carrera.${tag}@correo.ec`;
const [bookingReply, seriesReply] = await Promise.all([
  agent({ ip: "198.51.100.211" })("POST", `/public/businesses/${profile.business.slug}/bookings`, {
    serviceId: service,
    professionalId: online,
    date: slot!.date,
    startTime: slot!.time,
    documentId: cedulaFor(visitorEmail),
    name: "Visitante Carrera",
    email: visitorEmail,
    phone: "+593 99 777 1234",
    notes: "",
  }),
  createSeries(owner, appointmentInput({ clientId: mia.id, professionalId: online, date: slot!.date, startTime: slot!.time }), repeat(2), [
    { date: slot!.date, startTime: slot!.time },
    { date: addDaysISO(slot!.date, 7), startTime: slot!.time },
  ]),
]);
const bookingWon = bookingReply.status === 200;
ok(
  (bookingWon && seriesReply.status === 201 && seriesReply.body.skipped[0]?.date === slot!.date) ||
    (!bookingWon && bookingReply.status === 409 && seriesReply.status === 201 && seriesReply.body.created[0]?.date === slot!.date),
  "una de las dos se queda la hora; la otra no la pisa",
  [bookingReply.status, bookingReply.body, seriesReply.status, seriesReply.body?.skipped],
);
ok(overlaps(online) === 0, "y ninguna cita se solapa", overlaps(online));

/* ------------------------------------------------------------------------- ntfy -- */

console.log("ntfy: un aviso por serie");
const ntfy = await fakeNtfy();
try {
  await runCron(ntfy.url);
  ntfy.received.length = 0;
  const p11 = agenda();
  const nora = patient("Nora Avisos");
  r = await createSeries(owner, appointmentInput({ clientId: nora.id, professionalId: p11 }), repeat(8), [
    ...[0, 1, 2, 3, 4, 5, 6].map((n) => ({ date: week(n), startTime: "10:00" })),
  ]);
  const noraSeries = r.body as AppointmentSeriesCreated;
  ok(r.status === 201 && noraSeries.created.length === 7, "una serie de 7 (de 8 pedidas)", r.body);
  let run = await runCron(ntfy.url);
  const seriesNotices = ntfy.received.filter((n) => n.title === "Agenda360: nueva serie de citas");
  const message = seriesNotices[0]?.message ?? "";
  ok(run.code === 0 && seriesNotices.length === 1, "un solo aviso «Agenda360: nueva serie de citas»", ntfy.received.map((n) => n.title));
  ok(
    message.startsWith(`${businessName} · serie de 7 citas desde el panel\nCada semana · `) &&
      message.includes("\nPaciente: Nora A. · no***@correo.ec · ***") &&
      message.includes("\n1 fecha no se creó\n") &&
      message.includes("\nAgendada desde el panel por Jhordan H. (Propietario)\n") &&
      message.includes("• Al paciente → no***@correo.ec") &&
      message.includes("• Copia al profesional → pr***@correo.ec"),
    "con «serie de 7 citas desde el panel», el paciente a medias, quién la agendó y sus emails",
    message,
  );
  ok(!ntfy.received.some((n) => n.title === "Agenda360: nueva cita" && n.message.includes("Nora A.")), "sus citas no salen como «Agenda360: nueva cita»", ntfy.received.map((n) => n.title));
  ok(/series del panel: 1 · series canceladas: 0/.test(run.output), "el registro del cron lo cuenta", run.output.slice(-500));
  ntfy.received.length = 0;
  r = await owner("POST", `${B}/appointments/${noraSeries.created[2].id}/cancel-following`, { notify: true });
  ok(r.status === 200 && r.body.cancelled.length === 5, "se cancelan 5", r.body);
  run = await runCron(ntfy.url);
  const cancelNotices = ntfy.received.filter((n) => n.title === "Agenda360: serie de citas cancelada");
  const cancelMessage = cancelNotices[0]?.message ?? "";
  ok(cancelNotices.length === 1, "un solo aviso «Agenda360: serie de citas cancelada»", ntfy.received.map((n) => n.title));
  ok(
    cancelMessage.startsWith(`${businessName} · 5 citas canceladas desde `) &&
      cancelMessage.includes("\nPaciente: Nora A. · no***@correo.ec") &&
      cancelMessage.includes("\nCancelada desde el panel por Jhordan H. (Propietario)\n") &&
      cancelMessage.includes("• Al paciente → no***@correo.ec") &&
      cancelMessage.includes("• Copia al profesional → pr***@correo.ec"),
    "cuántas, desde cuándo, quién y sus emails",
    cancelMessage,
  );
  ok(!ntfy.received.some((n) => n.title === "Agenda360: cita cancelada"), "ningún aviso de cambio de estado por cada cita", ntfy.received.map((n) => n.title));
  ok(/series del panel: 0 · series canceladas: 1/.test(run.output), "el registro del cron lo cuenta", run.output.slice(-500));
  const all = [...seriesNotices, ...cancelNotices];
  ok(
    all.every((n) => !n.title.includes(businessName)) && all.every((n) => !n.message.includes(nora.email) && !n.message.includes(nora.phone) && !n.message.includes(COPY_EMAIL)),
    "ningún título nombra al negocio y ningún mensaje lleva un email o un teléfono completos",
    all,
  );
} finally {
  ntfy.close();
}

await pool.end();
done("de las citas que se repiten");
