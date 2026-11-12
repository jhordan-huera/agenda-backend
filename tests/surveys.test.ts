// Encuesta después de la cita (spec 048). El interruptor (sólo el propietario, con la actividad); el envío
// (queueSurveyRequests, con el momento como parámetro): desde las 10:00, del día siguiente a la cita hasta 3 días
// después, sólo Atendidas, sólo el paciente principal con email y sin la marca, una por paciente y como mucho cada 90
// días, sin copia al profesional; la página (responder una vez, la validación, caducada, 404); el aviso de 1 o 2
// estrellas sin el comentario; «No quiero recibir estas encuestas»; las opiniones de Reportes (el promedio, los
// conteos, el rol Profesional, Recepción 403); el informe mensual; la descarga de datos; el borrado con el paciente;
// y el descarte a los 2 días en la cola. Datos inventados en fechas a unas semanas, a horas de la noche.
import { cedulaFor } from "./helpers/cedula.mjs";
import { agent, checks, count, login, sql } from "./helpers/harness.ts";
import { DISCARD_REASONS } from "../src/services/email-limits.ts";
import type { OutgoingEmail } from "../src/services/mailer.ts";
import { emailTemplates } from "../src/shared/lib/email/templates.ts";
import { addDaysISO } from "../src/shared/lib/time.ts";
import type { Business, PublicSurvey, SurveySummary } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { queueSurveyRequests } = await import("../src/jobs/scheduled-tasks.ts");
const { processEmailQueue } = await import("../src/services/mailer.ts");
const { monthStats } = await import("../src/services/monthly-report.ts");
const { pool } = await import("../src/db/pool.ts");

let ipSeq = 0;
const nextIp = () => `198.20.0.${(ipSeq++ % 250) + 1}`;
const as = (email: string) => login(email, { ip: nextIp() });
const anonymous = () => agent({ ip: nextIp() });

const ricardo = await as("ricardo@demo.com"); // propietario
const elena = await as("elena@demo.com"); // Recepción
const valeria = await as("valeria@demo.com"); // rol Profesional
const laura = await as("laura@demo.com"); // otro negocio
const businessId: string = ricardo.session.businessId;
const B = `/businesses/${businessId}`;
const zone = sql(`select timezone from businesses where id = '${businessId}'`);
const today = sql(`select (now() at time zone '${zone}')::date`);
const agendaOf = (email: string) =>
  sql(`select id from professionals where business_id = '${businessId}' and user_id = (select id from users where email = '${email}')`);
const ricardoAgenda = agendaOf("ricardo@demo.com");
const valeriaAgenda = agendaOf("valeria@demo.com");
const service = sql(`select id from services where business_id = '${businessId}' and name = 'Consulta odontológica'`);
const X = addDaysISO(today, 30);
const at = (date: string, time: string) =>
  new Date(sql(`select to_char(((date '${date}' + time '${time}') at time zone '${zone}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`));

const tag = Date.now().toString(36);
let seq = 0;
const patient = (name: string, options: { email?: boolean } = {}) => {
  const email = options.email === false ? "" : `encuesta.${++seq}.${tag}@correo.ec`;
  const id = sql(
    `insert into clients (business_id, name, document_id, email, phone)
     values ('${businessId}', '${name}', '${cedulaFor(`${tag}-${seq}-${name}`)}', '${email}', '') returning id`,
  ).split("\n")[0];
  return { id, email, name };
};
let minute = 0;
const appointment = (clientId: string, date: string, status = "completed", agenda = ricardoAgenda) => {
  minute += 20;
  const start = `${String(19 + Math.floor((minute % 240) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return sql(
    `insert into appointments (business_id, client_id, service_id, professional_id, date, start_time, end_time, status, price, source)
     values ('${businessId}', '${clientId}', '${service}', '${agenda}', '${date}', '${start}', '${start}'::time + interval '15 minutes', '${status}', 20, 'dashboard')
     returning id`,
  ).split("\n")[0];
};
const surveysOf = (clientId: string) => count(`select count(*) from surveys where client_id = '${clientId}'`);
const tokenOf = (clientId: string) => sql(`select token from surveys where client_id = '${clientId}' order by sent_at desc limit 1`);
const auditCount = (action: string) => count(`select count(*) from audit_logs where business_id = '${businessId}' and action = '${action}'`);
const businessNow = async () => (await ricardo("GET", B)).body as Business;
const setSurveys = async (browser: typeof ricardo, on: boolean) => {
  const current = await businessNow();
  return browser("PATCH", B, { notificationSettings: { ...current.notificationSettings, surveys: on } });
};

/* ======================================================================================== */
console.log("El interruptor");
const ana = patient("Ana Encuesta");
appointment(ana.id, addDaysISO(X, -1));
let result = await queueSurveyRequests(at(X, "10:30"));
ok(result.queued === 0 && surveysOf(ana.id) === 0, "apagada, no sale ninguna", result);
let r = await setSurveys(elena, true);
ok(r.status === 403, "Recepción no la enciende", r.status);
r = await setSurveys(ricardo, true);
ok(r.status === 200 && (await businessNow()).notificationSettings.surveys === true, "el propietario la enciende", r.body);
ok(
  count(`select count(*) from audit_logs where business_id = '${businessId}' and action = 'business.updated' and changes::text like '%Encuesta después de la cita%'`) >= 1,
  "y queda en la actividad",
);

/* ======================================================================================== */
console.log("\nQuién la recibe");
const bruno = patient("Bruno Mismo Día");
appointment(bruno.id, X);
const carla = patient("Carla Cuatro Días");
appointment(carla.id, addDaysISO(X, -4));
const diego = patient("Diego Confirmada");
appointment(diego.id, addDaysISO(X, -1), "confirmed");
const eva = patient("Eva Sin Email", { email: false });
appointment(eva.id, addDaysISO(X, -1));
const fabi = patient("Fabi No Quiere");
sql(`update clients set surveys_opted_out_at = now() where id = '${fabi.id}'`);
appointment(fabi.id, addDaysISO(X, -1));
const gina = patient("Gina Dos Citas");
const ginaOlder = appointment(gina.id, addDaysISO(X, -2), "completed", valeriaAgenda);
const ginaNewer = appointment(gina.id, addDaysISO(X, -1), "completed", valeriaAgenda);
const hugo = patient("Hugo Principal");
const ines = patient("Ines Pareja");
const couple = appointment(hugo.id, addDaysISO(X, -1));
sql(`insert into appointment_clients (appointment_id, client_id, business_id) values ('${couple}', '${ines.id}', '${businessId}')`);

result = await queueSurveyRequests(at(X, "09:30"));
ok(result.queued === 0, "antes de las 10:00 no sale nada", result);
result = await queueSurveyRequests(at(X, "10:30"));
ok(result.queued === 3 && result.failures === 0, "desde las 10:00: Ana, Gina y Hugo", result);
ok(surveysOf(ana.id) === 1 && surveysOf(hugo.id) === 1, "Ana y Hugo (el principal de la pareja)");
ok(surveysOf(ines.id) === 0, "no la otra persona de la pareja");
ok(
  [bruno, carla, diego, eva, fabi].every((p) => surveysOf(p.id) === 0),
  "no el mismo día, ni pasados 3 días, ni una Confirmada, ni sin email, ni con la marca",
);
ok(surveysOf(gina.id) === 1 && sql(`select appointment_id from surveys where client_id = '${gina.id}'`) === ginaNewer, "una sola para Gina, la de su cita más reciente");
ok(sql(`select appointment_id from surveys where client_id = '${gina.id}'`) !== ginaOlder, "no la anterior");
ok(
  count(`select count(*) from notifications where type = 'survey_request' and to_email = '${ana.email}'`) === 1,
  "a Ana le llega el email",
);
ok(
  count(`select count(*) from notifications where type = 'appointment_copy' and appointment_id in (select appointment_id from surveys)`) === 0,
  "sin copia al profesional",
);
const anaBody = sql(`select body from notifications where type = 'survey_request' and to_email = '${ana.email}'`);
ok(anaBody.includes(`/encuesta/${tokenOf(ana.id)}?estrellas=5`) && anaBody.includes("?no-recibir=1"), "con las estrellas y «No quiero recibir estas encuestas»", anaBody.slice(0, 300));
result = await queueSurveyRequests(at(X, "11:00"));
ok(result.queued === 0, "la pasada siguiente no repite", result);

console.log("\nComo mucho una cada 90 días");
appointment(ana.id, addDaysISO(X, 29));
await queueSurveyRequests(at(addDaysISO(X, 30), "10:30"));
ok(surveysOf(ana.id) === 1, "a los 30 días, no");
appointment(ana.id, addDaysISO(X, 90));
await queueSurveyRequests(at(addDaysISO(X, 91), "10:30"));
ok(surveysOf(ana.id) === 2, "a los 91 días, sí");

/* ======================================================================================== */
console.log("\nLa página de la encuesta");
const page = anonymous();
const anaToken = sql(`select token from surveys where client_id = '${ana.id}' order by sent_at limit 1`);
r = await page("GET", `/public/surveys/${anaToken}`);
const shown = r.body as PublicSurvey;
ok(r.status === 200 && shown.status === "open" && shown.firstName === "Ana" && shown.serviceName === "Consulta odontológica", "muestra la cita y está abierta", r.body);
ok(/no-store/.test(r.headers.get("cache-control") ?? ""), "sin caché");
r = await page("POST", `/public/surveys/${anaToken}`, { rating: 0 });
ok(r.status === 400, "0 estrellas, rechazada", r.status);
r = await page("POST", `/public/surveys/${anaToken}`, { rating: 4, comment: "x".repeat(1001) });
ok(r.status === 400, "un comentario de más de 1000 caracteres, rechazado", r.status);
r = await page("POST", `/public/surveys/${anaToken}`, { rating: 4, comment: "Muy amable la doctora" });
ok(r.status === 200 && (r.body as PublicSurvey).status === "answered", "responde con 4 estrellas", r.body);
r = await page("POST", `/public/surveys/${anaToken}`, { rating: 5 });
ok(r.status === 409, "no responde dos veces", r.status);
const answeredLog = sql(`select summary from audit_logs where business_id = '${businessId}' and action = 'survey.answered' order by created_at desc limit 1`);
ok(answeredLog.includes("4 estrellas") && !answeredLog.includes("amable"), "la actividad dice las estrellas, no el comentario", answeredLog);
ok(count(`select count(*) from panel_notices where kind = 'survey_low' and business_id = '${businessId}'`) === 0, "con 4 estrellas, ningún aviso");

const ginaToken = tokenOf(gina.id);
r = await page("POST", `/public/surveys/${ginaToken}`, { rating: 2, comment: "Esperé mucho" });
ok(r.status === 200, "Gina responde con 2 estrellas", r.body);
const lowNotice = sql(`select data::text from panel_notices where kind = 'survey_low' and business_id = '${businessId}'`);
ok(/"rating": 2/.test(lowNotice) && !lowNotice.includes("Esperé"), "la campana avisa, sin el comentario", lowNotice);

const hugoToken = tokenOf(hugo.id);
sql(`update surveys set expires_at = now() - interval '1 minute' where client_id = '${hugo.id}'`);
r = await page("GET", `/public/surveys/${hugoToken}`);
ok((r.body as PublicSurvey).status === "expired", "pasados 14 días, cerrada", r.body);
r = await page("POST", `/public/surveys/${hugoToken}`, { rating: 5 });
ok(r.status === 400, "y ya no se responde", r.status);
r = await page("GET", "/public/surveys/00000000000000000000000000000000");
ok(r.status === 404, "un enlace que no existe, 404", r.status);

console.log("\n«No quiero recibir estas encuestas»");
r = await page("POST", `/public/surveys/${hugoToken}/opt-out`);
ok(r.status === 200 && sql(`select surveys_opted_out_at is not null from clients where id = '${hugo.id}'`) === "t", "pone la marca");
r = await page("POST", `/public/surveys/${hugoToken}/opt-out`);
ok(auditCount("client.surveys_opted_out") === 1, "una sola entrada en la actividad aunque lo repita");
appointment(hugo.id, addDaysISO(X, 120));
await queueSurveyRequests(at(addDaysISO(X, 121), "10:30"));
ok(surveysOf(hugo.id) === 1, "y no vuelve a recibirlas");

/* ======================================================================================== */
console.log("\nLas opiniones");
const range = `from=${addDaysISO(X, -5)}&to=${X}`;
r = await ricardo("GET", `${B}/surveys?${range}`);
let summary = r.body as SurveySummary;
ok(
  r.status === 200 && summary.count === 2 && summary.average === 3 && JSON.stringify(summary.byRating) === "[0,1,0,1,0]",
  "el propietario: 2 respuestas, promedio 3, una de 2 y una de 4",
  summary,
);
ok(summary.responses.some((response) => response.comment === "Muy amable la doctora" && response.clientName === "Ana Encuesta"), "con el comentario y el paciente");
r = await ricardo("GET", `${B}/surveys?${range}&clientId=${ana.id}`);
ok((r.body as SurveySummary).count === 1, "las de un paciente (su ficha)");
r = await valeria("GET", `${B}/surveys?${range}`);
summary = r.body as SurveySummary;
ok(r.status === 200 && summary.count === 1 && summary.responses[0]?.clientName === "Gina Dos Citas", "el rol Profesional, sólo las de su agenda", summary.count);
r = await elena("GET", `${B}/surveys?${range}`);
ok(r.status === 403, "Recepción no las ve", r.status);
r = await laura("GET", `${B}/surveys?${range}`);
ok(r.status === 403, "otro negocio, 403", r.status);

console.log("\nEl informe mensual");
const monthFrom = `${today.slice(0, 8)}01`;
const nextMonth = addDaysISO(monthFrom, 32).slice(0, 8) + "01";
const previousFrom = addDaysISO(monthFrom, -1).slice(0, 8) + "01";
const stats = await monthStats(pool, businessId, zone, { from: monthFrom, to: nextMonth, previousFrom, key: monthFrom.slice(0, 7) });
ok(stats.surveys === 2 && stats.surveyAverage === 3, "cuenta las respuestas del mes y su promedio", stats);
const report = emailTemplates.monthlyReport({
  ...stats,
  firstName: "Ricardo",
  businessName: "Clínica",
  month: monthFrom,
  currency: "USD",
  reportsUrl: "https://ejemplo.invalid/dashboard/reports",
  referralUrl: null,
});
ok(report.body.includes("Opinión de tus pacientes") && !report.body.includes("amable"), "el email lo suma, sin comentarios");

console.log("\nLa descarga de datos");
r = await ricardo("GET", `${B}/export`);
ok(r.status === 200 && r.body.counts.surveys === 2, "el resumen cuenta las respondidas", r.body?.counts);
r = await ricardo("GET", `${B}/export/surveys`);
ok(r.status === 200 && r.body.items.length === 2 && r.body.items.some((item: { comment: string }) => item.comment === "Esperé mucho"), "encuestas.xlsx trae las dos", r.body?.items?.length);
r = await valeria("GET", `${B}/export/surveys`);
ok(r.status === 200 && r.body.items.length === 1, "el rol Profesional, la de su agenda", r.body?.items?.length);

console.log("\nEl descarte a los 2 días en la cola");
const stale = sql(`select id from notifications where type = 'survey_request' and to_email = '${gina.email}'`);
sql(`update notifications set status = 'queued', attempts = 0, created_at = now() - interval '49 hours', next_attempt_at = now() where id = '${stale}'`);
const sent: OutgoingEmail[] = [];
await processEmailQueue({ send: async (email: OutgoingEmail) => void sent.push(email) });
ok(
  sql(`select status || '|' || coalesce(last_error, '') from notifications where id = '${stale}'`) === `failed|${DISCARD_REASONS.staleSurvey}`,
  "la que esperó más de 2 días se descarta",
  sql(`select status || '|' || coalesce(last_error, '') from notifications where id = '${stale}'`),
);

console.log("\nSe borra con el paciente");
r = await ricardo("DELETE", `${B}/clients/${ana.id}`);
ok(r.status === 204 && surveysOf(ana.id) === 0, "al borrar a Ana, sus encuestas también", r.status);

console.log("\nApagada otra vez");
await setSurveys(ricardo, false);
const late = patient("Luis Tarde");
appointment(late.id, addDaysISO(X, 199));
result = await queueSurveyRequests(at(addDaysISO(X, 200), "10:30"));
ok(result.queued === 0 && surveysOf(late.id) === 0, "no sale ninguna más", result);

done("de la encuesta después de la cita");
// La tarea del cron y el envío abren su conexión a la base: sin esto, la suite espera a que se cierre sola.
process.exit();
