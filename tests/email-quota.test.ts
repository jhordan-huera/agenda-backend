// Cupo de Gmail (spec 015): los envíos de 24 h se cuentan todos juntos frente al cupo de la cuenta;
// salen primero los del equipo, después los del paciente y al final los del negocio; lo que no cabe
// espera en la cola sin gastar intentos y sale en cuanto hay cupo (ninguna copia se pierde); un
// recordatorio que ya no llega a tiempo no sale; los topes contra el abuso (spec 009) siguen igual;
// Salud da las cifras y ntfy avisa una vez al día. Con un cupo pequeño: 10, con reservas de 2 y de 4
// (el equipo hasta 10, el paciente hasta 8 y el negocio hasta 6).
import { readFileSync } from "node:fs";
import type { OutgoingEmail } from "../src/services/mailer.ts";
import type { EmailType, PlatformStats } from "../src/shared/types/index.ts";
import { checks, fakeNtfy, login, sleep, sql, startApi } from "./helpers/harness.ts";

const { ok, done } = checks();

// Sólo los emails de esta prueba: lo demás de la cola, fuera, y lo enviado de los datos demo, fuera de la ventana de 24 h.
sql("update notifications set status = 'failed' where status = 'queued'");
sql("update notifications set sent_at = now() - interval '3 days' where status = 'sent' and sent_at > now() - interval '25 hours'");
/** Emails al paciente de las reservas online y los registros en 24 h (los cuenta el tope del público, spec 009). */
const publicSoFar = Number(
  sql(
    `select count(*) from notifications n
      where n.created_at between now() - interval '24 hours' and now() and (n.status <> 'failed' or n.attempts > 0)
        and (n.type = 'welcome' or exists (select 1 from appointments a where a.id = n.appointment_id and a.source = 'booking_page' and a.created_at = n.created_at))`,
  ),
);

const ntfy = await fakeNtfy();
Object.assign(process.env, {
  EMAIL_DAILY_QUOTA: "10",
  EMAIL_TEAM_RESERVE: "2",
  EMAIL_PATIENT_RESERVE: "4",
  PUBLIC_EMAILS_PER_DAY: String(publicSoFar + 1),
  NTFY_TOPIC: "agenda-pruebas",
  NTFY_SERVER: ntfy.url,
});
const { pool, transaction } = await import("../src/db/pool.ts");
const { processEmailQueue } = await import("../src/services/mailer.ts");
const { EMAIL_PRIORITY, QUOTA_WAIT_NOTE, newPatientEmailHold } = await import("../src/services/email-limits.ts");
const { queueEmail } = await import("../src/services/notifications.ts");
const { reminderKeySql } = await import("../src/services/reminder-rules.ts");

let counter = 0;
/** Un email listo en la cola (cada uno, un segundo más nuevo que el anterior). Devuelve su id. */
const queue = (type: EmailType, extra: { appointmentId?: string; dedupeKey?: string } = {}) => {
  counter++;
  return sql(
    `insert into notifications (business_id, type, to_email, subject, body, status, appointment_id, dedupe_key, created_at, next_attempt_at)
     values (null, '${type}', 'cupo${counter}@correo.ec', 'Cupo ${counter}', 'Hola', 'queued',
             ${extra.appointmentId ? `'${extra.appointmentId}'` : "null"}, ${extra.dedupeKey ? `'${extra.dedupeKey}'` : "null"},
             now() - interval '1 hour' + make_interval(secs => ${counter}), now())
     returning id`,
  ).split("\n")[0];
};
/** Envíos que ya cuentan frente al cupo (hace una hora). */
const alreadySent = (count: number) =>
  sql(
    `insert into notifications (business_id, type, to_email, subject, body, status, attempts, sent_at)
     select null, 'appointment_confirmed', 'enviado' || g || '@correo.ec', 'Enviado', '', 'sent', 1, now() - interval '1 hour'
       from generate_series(1, ${count}) g`,
  );
/** La ventana de 24 h libera todo el cupo: lo enviado hasta ahora pasa a hace más de un día. */
const freeWindow = () => sql("update notifications set sent_at = sent_at - interval '25 hours' where status = 'sent' and sent_at > now() - interval '24 hours'");
/** Lo que queda en cola de esta prueba, fuera (para empezar el siguiente caso de cero). */
const clearQueue = () => sql("update notifications set status = 'failed' where status = 'queued'");
const row = (id: string) =>
  JSON.parse(
    sql(
      `select json_build_object('status', status, 'attempts', attempts, 'note', last_error,
              'waitMinutes', round(extract(epoch from next_attempt_at - now()) / 60), 'to', to_email)
         from notifications where id = '${id}'`,
    ),
  ) as { status: string; attempts: number; note: string | null; waitMinutes: number; to: string };
const toOf = (id: string) => row(id).to;
const waiting = (id: string) => {
  const r = row(id);
  return r.status === "queued" && r.attempts === 0 && r.note === QUOTA_WAIT_NOTE;
};

const sent: OutgoingEmail[] = [];
const send = async (email: OutgoingEmail) => {
  sent.push(email);
};
const sentTo = () => sent.map((email) => email.to);
const quotaAlerts = () => ntfy.received.filter((alert) => /cupo de Gmail/.test(alert.title));

console.log("Cada tipo de email tiene su nivel");
{
  const source = readFileSync(new URL("../src/shared/types/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("export type EmailType =");
  const declared = [...source.slice(start, source.indexOf(";", start)).matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
  const mapped = Object.keys(EMAIL_PRIORITY).sort();
  ok(
    declared.length > 20 && JSON.stringify(declared) === JSON.stringify(mapped),
    `cada EmailType (${declared.length}) tiene su nivel en EMAIL_PRIORITY, y no sobra ninguno`,
    { sinNivel: declared.filter((type) => !mapped.includes(type)), sobran: mapped.filter((type) => !declared.includes(type)) },
  );
  // La tabla de R2 (research.md).
  const R2: Record<string, EmailType[]> = {
    team: [
      "password_reset", "team_invite", "account_security_changed", "platform_admin_added", "business_suspended", "business_reactivated",
      "plan_change_requested", "plan_change_approved", "plan_change_rejected", "plan_changed", "business_created",
    ],
    patient: [
      "welcome", "booking_created", "appointment_confirmed", "appointment_updated", "appointment_cancelled", "appointment_reminder",
      "appointment_pending", "appointment_completed", "appointment_no_show", "appointment_series", "appointment_series_cancelled",
    ],
    business: [
      "appointment_copy", "booking_received", "professional_new_appointment", "professional_daily_agenda", "payment_receipt_received", "patient_cancelled",
      "calendar_invite",
    ],
  };
  const wrong = Object.entries(R2).flatMap(([level, types]) => types.filter((type) => EMAIL_PRIORITY[type] !== level));
  ok(wrong.length === 0, "los niveles son los de la tabla R2: equipo, paciente (con los recordatorios) y negocio (con la copia al profesional)", wrong);
}

console.log("Con más emails que el cupo: primero el equipo, después el paciente y al final el negocio");
alreadySent(3);
const copies = [1, 2, 3, 4].map(() => queue("appointment_copy"));
const patients = [1, 2, 3, 4].map(() => queue("appointment_confirmed"));
const team = [1, 2, 3].map(() => queue("password_reset"));
let report = await processEmailQueue({ send });
ok(
  report.sent === 5 && sentTo().join(",") === [...team, patients[0], patients[1]].map(toOf).join(","),
  "con 3 ya enviados: salen los 3 del equipo y los 2 más antiguos del paciente (hasta 8, el cupo menos la reserva del equipo)",
  { report, enviados: sentTo() },
);
ok(
  [...patients.slice(2), ...copies].every(waiting),
  "los que no caben siguen en cola, sin gastar un intento y con la marca de espera (también las 4 copias al profesional)",
  [...patients.slice(2), ...copies].map(row),
);
ok([...patients.slice(2), ...copies].every((id) => row(id).waitMinutes === 30), "se vuelven a mirar a los 30 minutos", row(copies[0]));
ok(report.waiting === 6 && report.failed === 0 && report.skipped === 0, "la pasada dice cuántos esperan; ninguno se descarta", report);
for (let i = 0; i < 30 && quotaAlerts().length === 0; i++) await sleep(100);
const [alert] = quotaAlerts();
ok(
  alert?.title === "Agenda360: se llegó al cupo de Gmail" && /Van 8 envíos/.test(alert.message) && /es de 10/.test(alert.message) && /Esperan en la cola 6/.test(alert.message),
  "al llegar al límite del paciente, ntfy avisa con las cifras",
  ntfy.received,
);
ok(alert && !alert.message.includes("@"), "sólo cifras: ninguna dirección", alert?.message);

console.log("El equipo sale siempre");
sent.length = 0;
const security = queue("account_security_changed");
const latePatient = queue("booking_created");
report = await processEmailQueue({ send });
ok(row(security).status === "sent" && report.sent === 1, "con el paciente lleno, el aviso de seguridad del equipo sale igual (hasta el cupo entero)", [report, row(security)]);
ok(waiting(latePatient), "el email al paciente que llega después también espera", row(latePatient));
await sleep(300);
ok(quotaAlerts().length === 1, "ntfy no repite el aviso del cupo en el mismo día", quotaAlerts().length);

console.log("En cuanto la ventana libera cupo, salen por orden de llegada");
const newCopy = queue("appointment_copy");
freeWindow();
sent.length = 0;
report = await processEmailQueue({ send });
ok(
  sentTo().join(",") === [patients[2], patients[3], latePatient, copies[0], copies[1], copies[2]].map(toOf).join(","),
  "los que esperaban salen ya (aunque falten minutos para su hora): primero lo del paciente, después 3 copias (hasta 6)",
  sentTo(),
);
ok(row(copies[0]).attempts === 1 && row(patients[2]).attempts === 1, "con un solo intento: la espera no los gastó", [row(copies[0]), row(patients[2])]);
ok(waiting(copies[3]) && waiting(newCopy), "la copia que llegó hoy espera detrás de la que ya esperaba", [row(copies[3]), row(newCopy)]);
freeWindow();
sent.length = 0;
report = await processEmailQueue({ send });
ok(sentTo().join(",") === [copies[3], newCopy].map(toOf).join(","), "y al día siguiente salen las dos, la más antigua primero", sentTo());
ok(
  Number(sql("select count(*) from notifications where to_email like 'cupo%@correo.ec' and type = 'appointment_copy' and status <> 'sent'")) === 0,
  "ninguna copia al profesional se perdió: todas salieron",
);

console.log("En un lote, los avisos al negocio no le quitan el sitio al paciente");
freeWindow();
sent.length = 0;
const notices = Array.from({ length: 12 }, () => queue("booking_received"));
const lastPatient = queue("appointment_updated");
report = await processEmailQueue({ send });
ok(sentTo()[0] === toOf(lastPatient), "el email al paciente sale primero aunque llegó después de 12 avisos al negocio", sentTo());
ok(
  report.sent === 6 && notices.slice(0, 5).every((id) => row(id).status === "sent") && notices.slice(5).every(waiting),
  "los avisos, hasta el límite del negocio (el cupo menos la reserva del paciente); los demás esperan",
  report,
);
clearQueue();

console.log("El envío al momento de la API no toma los recordatorios (son del cron)");
freeWindow();
alreadySent(8);
const reminder = queue("appointment_reminder");
const confirmation = queue("appointment_confirmed");
await processEmailQueue({ send, skipReminders: true });
ok(row(reminder).note === null && row(reminder).waitMinutes <= 0, "con el paciente lleno, no toca el recordatorio: lo deja para el cron", row(reminder));
ok(waiting(confirmation), "pero lo demás del paciente sí espera", row(confirmation));
clearQueue();

console.log("Recordatorios que ya no llegan a tiempo");
freeWindow();
const businessId = sql("select id from businesses where slug = 'jhordan'");
const clientId = sql(`select id from clients where business_id = '${businessId}' order by created_at limit 1`);
const serviceId = sql(`select id from services where business_id = '${businessId}' order by created_at limit 1`);
const agendaId = sql(`insert into professionals (business_id, display_name) values ('${businessId}', 'Agenda del cupo') returning id`).split("\n")[0];
// Una zona en la que ahora es mediodía: fuera de las horas de silencio de los recordatorios.
const offset = ((12 - new Date().getUTCHours() + 36) % 24) - 12;
const noon = offset === 0 ? "UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
const timezone = sql(`select timezone from businesses where id = '${businessId}'`);
sql(`update businesses set timezone = '${noon}' where id = '${businessId}'`);
const pastAppointment = (date: string) =>
  sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price)
     values ('${businessId}', '${clientId}', '${serviceId}', '${agendaId}', '${date}', '10:00', '10:30', 'confirmed', 0) returning id`,
  ).split("\n")[0];
const keyOf = (appointmentId: string) => sql(`select ${reminderKeySql("a")} from appointments a where a.id = '${appointmentId}'`);
// Una cita que ya empezó y cuyo recordatorio (y su copia) esperaban en la cola.
const started = pastAppointment("2025-01-06");
const lateReminder = queue("appointment_reminder", { appointmentId: started, dedupeKey: keyOf(started) });
const lateCopy = queue("appointment_copy", { appointmentId: started, dedupeKey: `${keyOf(started)}:copy` });
// Otra cuyo recordatorio sí salió a tiempo y su copia esperó el cupo hasta después de la cita.
const attended = pastAppointment("2025-01-07");
sql(
  `insert into notifications (business_id, type, to_email, subject, body, appointment_id, status, attempts, sent_at, dedupe_key)
   values ('${businessId}', 'appointment_reminder', 'paciente.cupo@correo.ec', 'Recordatorio', '', '${attended}', 'sent', 1, now() - interval '2 days', '${keyOf(attended)}')`,
);
const waitedCopy = queue("appointment_copy", { appointmentId: attended, dedupeKey: `${keyOf(attended)}:copy` });
sent.length = 0;
report = await processEmailQueue({ send });
const statusOf = (id: string) => sql(`select status || ' · ' || coalesce(last_error, '') from notifications where id = '${id}'`);
ok(/^failed · Recordatorio descartado: la cita ya empezó/.test(statusOf(lateReminder)), "el recordatorio de una cita que ya empezó no se envía", statusOf(lateReminder));
ok(/^failed · Recordatorio descartado/.test(statusOf(lateCopy)), "ni la copia de un recordatorio que no salió (sería copia de nada)", statusOf(lateCopy));
ok(
  /^sent/.test(statusOf(waitedCopy)) && sentTo().includes(toOf(waitedCopy)),
  "la copia de un recordatorio que sí le llegó al paciente sale aunque la cita ya pasó: la copia nunca se descarta",
  statusOf(waitedCopy),
);
sql(`update businesses set timezone = '${timezone}' where id = '${businessId}'`);
clearQueue();

console.log("Los topes contra el abuso (spec 009) siguen como hoy");
freeWindow();
alreadySent(10);
const content = { subject: "Bienvenida", body: "Hola", html: "<p>Hola</p>" };
const welcome = (to: string) => transaction((db) => queueEmail(db, { businessId: null, type: "welcome", to, ...content }));
const firstWelcome = await welcome("bienvenida1@correo.ec");
const secondWelcome = await welcome("bienvenida2@correo.ec");
const held = sql("select status || ' · ' || attempts || ' · ' || coalesce(last_error, '') from notifications where to_email = 'bienvenida2@correo.ec'");
ok(firstWelcome && !secondWelcome, "el tope de lo que provoca el público frena la bienvenida siguiente", [firstWelcome, secondWelcome]);
ok(/^failed · 0 · No enviado: se alcanzó el tope de \d+ emails de reservas online y registros/.test(held), "y queda «No enviado…» con el motivo, como hoy", held);
const panelEmail = await transaction((db) =>
  queueEmail(db, { businessId, type: "appointment_confirmed", to: "panel.cupo@correo.ec", ...content }),
);
ok(
  panelEmail && sql("select status || ' · ' || coalesce(last_error, '(sin motivo)') from notifications where to_email = 'panel.cupo@correo.ec'") === "queued · (sin motivo)",
  "con la cuenta llena, un email del panel no se descarta al ponerlo en cola (ya no está el tope de 400): espera",
);
const newcomer = sql(
  `insert into clients (business_id, name, email, source) values ('${businessId}', 'Paciente Nuevo Cupo', 'nuevo.cupo@correo.ec', 'booking_page') returning id`,
).split("\n")[0];
const newcomerAppointment = sql(
  `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
   values ('${businessId}', '${newcomer}', '${serviceId}', '${agendaId}', '2031-05-05', '10:00', '10:30', 'pending', 0, 'booking_page') returning id`,
).split("\n")[0];
sql(
  `insert into notifications (business_id, type, to_email, subject, body, appointment_id, status, attempts, sent_at)
   select '${businessId}', 'booking_created', 'relleno' || g || '@correo.ec', 'Reserva', '', '${newcomerAppointment}', 'sent', 1, now() - interval '25 hours'
     from generate_series(1, 20) g`,
);
sql(`update notifications set created_at = now() - interval '1 hour' where appointment_id = '${newcomerAppointment}'`);
const newPatientHold = await transaction((db) => newPatientEmailHold(db, businessId, newcomer));
ok(/tope de 20 emails a pacientes nuevos/.test(newPatientHold ?? ""), "el de 20 emails a pacientes nuevos por negocio, también", newPatientHold);
ok((await transaction((db) => newPatientEmailHold(db, businessId, clientId))) === null, "y no frena a un paciente que ya era del negocio");
sql("delete from notifications where to_email like 'relleno%@correo.ec'");
clearQueue();

console.log("Salud del super admin");
freeWindow();
alreadySent(9);
const waitingPatient = queue("appointment_cancelled");
const waitingCopies = [queue("appointment_copy"), queue("payment_receipt_received")];
await processEmailQueue({ send });
ok(waiting(waitingPatient) && waitingCopies.every(waiting), "con 9 de 10 enviados, el del paciente y los del negocio esperan", [row(waitingPatient), ...waitingCopies.map(row)]);
const api = await startApi({});
try {
  const admin = await login("admin@demo.com", { base: api.base });
  const stats = (await admin("GET", "/admin/stats")).body as PlatformStats;
  const sent24h = Number(sql("select count(*) from notifications where status = 'sent' and sent_at > now() - interval '24 hours'"));
  ok(
    JSON.stringify(stats.health?.emailQuota) === JSON.stringify({ quota: 10, sent24h, patientLimit: 8, waiting: { patient: 1, business: 2 } }) && sent24h === 9,
    "getStats da el cupo, los envíos de 24 h, el límite del paciente y los que esperan (al paciente y al negocio)",
    stats.health?.emailQuota,
  );
  ok(!JSON.stringify(stats.health).includes("@"), "sólo cifras, sin direcciones");
} finally {
  api.stop();
}
ok(quotaAlerts().length === 1, "en todo el día, un solo aviso del cupo por ntfy", quotaAlerts().length);
clearQueue();

ntfy.close();
await pool.end();
done("del cupo de Gmail");
