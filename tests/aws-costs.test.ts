// Los costos de AWS en /admin (spec 031), con un AWS falso local (nunca la cuenta de verdad): la firma
// (Signature V4) con los ejemplos oficiales de AWS; la lectura de Cost Explorer (lo gastado sin créditos ni
// reembolsos, lo que cubren los créditos, lo que se paga y los servicios de mayor a menor, también con dos
// páginas) y la del plan de la cuenta; la previsión (el día 1, null; a mitad de mes, el ritmo); el cron (una
// consulta al día —el AWS falso cuenta las peticiones—, nada antes de las 06:00, «sin credenciales», los fallos
// de AWS en palabras sencillas y sin datos de la cuenta, el reintento a las 3 horas hasta 3 veces, el plan que
// falla sin frenar los costos y las direcciones de prueba que en producción no se leen); el aviso (una vez
// por mes y por monto, al cambiar el monto y en el mes nuevo otra vez, nunca por debajo, con el email al
// principal y el ntfy); la API (quién los ve, no-store, el monto validado y en la actividad sólo si cambia, y
// /public/platform-settings sin campos nuevos), y el cron de GitHub de verdad, con su registro sin montos.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { agent, checks, count, fakeNtfy, freePort, login, runCron, sql, startApi, BASE } from "./helpers/harness.ts";
import type { AwsCosts } from "../src/shared/types/index.ts";

const { ok, done } = checks();
const { signAwsRequest } = await import("../src/services/aws-signature.ts");
const { AWS_COSTS_ERRORS, forecastUsage, readAccountPlan, readCostPages, refreshAwsCosts } = await import("../src/services/aws-costs.ts");
const { buildCostNotice, describeAwsCostsLine } = await import("../scripts/cron.ts");
const { emailTemplates } = await import("../src/shared/lib/email/templates.ts");
const { getZonedNow } = await import("../src/shared/lib/time.ts");
const { pool } = await import("../src/db/pool.ts");

const CE = "AWSInsightsIndexService.GetCostAndUsage";
const FREE_TIER = "AWSFreeTierService.GetAccountPlanState";
const KEY_ID = "AKIDPRUEBA00000000000";
const SECRET = "secreto/de+prueba0000000000000000000000";
const TOKEN = "token-de-sesion-de-prueba";
/** El número de una cuenta de AWS de mentira: nunca debe llegar a la pantalla ni a los registros. */
const ACCOUNT_ID = "123456789012";

/* ------------------------------------------------------------ El AWS falso ---- */

interface AwsReply {
  status: number;
  body: unknown;
}
interface AwsRequestSeen {
  target: string;
  body: Record<string, unknown> | null;
  /** La firma coincide con la que se calcula aquí con lo que llegó (Host, cabeceras y cuerpo). */
  signed: boolean;
  token: string | undefined;
  contentType: string | undefined;
}

/** Cost Explorer y el Free Tier API de mentira en 127.0.0.1: comprueban la firma y cuentan las peticiones. */
async function fakeAws() {
  const requests: AwsRequestSeen[] = [];
  const handlers: Record<string, (body: Record<string, unknown>) => AwsReply> = {};
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const target = String(req.headers["x-amz-target"] ?? "");
      const date = String(req.headers["x-amz-date"] ?? "");
      const at = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
      const token = req.headers["x-amz-security-token"] as string | undefined;
      const expected = Number.isNaN(at.getTime())
        ? null
        : signAwsRequest(
            {
              method: req.method ?? "",
              url: `http://${req.headers.host}${req.url}`,
              headers: { "Content-Type": String(req.headers["content-type"] ?? ""), "X-Amz-Target": target },
              body: raw,
              service: target === CE ? "ce" : "freetier",
              region: "us-east-1",
            },
            { accessKeyId: KEY_ID, secretAccessKey: SECRET, sessionToken: token },
            at,
          ).Authorization;
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      requests.push({ target, body, signed: req.headers.authorization === expected, token, contentType: req.headers["content-type"] });
      const reply = handlers[target]?.(body ?? {}) ?? { status: 404, body: { __type: "UnknownOperationException" } };
      res.statusCode = reply.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    requests,
    handlers,
    calls: (target: string) => requests.filter((request) => request.target === target).length,
    close: () => server.close(),
  };
}

/** Una página de GetCostAndUsage con sus grupos [servicio, tipo de registro, monto]. */
const ceReply = (groups: [string, string, number | string][], nextPageToken?: string): AwsReply => ({
  status: 200,
  body: {
    GroupDefinitions: [
      { Type: "DIMENSION", Key: "SERVICE" },
      { Type: "DIMENSION", Key: "RECORD_TYPE" },
    ],
    ResultsByTime: [
      {
        TimePeriod: { Start: "2026-10-01", End: "2026-10-16" },
        Total: {},
        Groups: groups.map(([service, type, amount]) => ({ Keys: [service, type], Metrics: { UnblendedCost: { Amount: String(amount), Unit: "USD" } } })),
        Estimated: true,
      },
    ],
    DimensionValueAttributes: [],
    ...(nextPageToken ? { NextPageToken: nextPageToken } : {}),
  },
});
/** Un mes de verdad en pequeño: Lambda, registros, la consulta, transferencia, impuestos, créditos y un reembolso. */
const MONTH_GROUPS: [string, string, number | string][] = [
  ["AWS Lambda", "Usage", "0.2000001"],
  ["AmazonCloudWatch", "Usage", "0.08"],
  ["AWS Cost Explorer", "Usage", "0.03"],
  ["AWS Data Transfer", "Usage", "0.0004"],
  ["Amazon Simple Storage Service", "Usage", "0"],
  ["Tax", "Tax", "0.01"],
  ["AWS Lambda", "Credit", "-0.2000001"],
  ["AmazonCloudWatch", "Credit", "-0.08"],
  ["AWS Cost Explorer", "Credit", "-0.03"],
  ["Tax", "Credit", "-0.01"],
  ["AWS Lambda", "Refund", "-0.05"],
];
/** Todo en Lambda, cubierto por los créditos. */
const usageReply = (usage: number) => ceReply([["AWS Lambda", "Usage", usage], ["AWS Lambda", "Credit", -usage]]);
const EXPIRES = Date.UTC(2027, 9, 8) / 1000;
const PLAN_REPLY: AwsReply = {
  status: 200,
  body: {
    accountId: ACCOUNT_ID,
    accountPlanType: "PAID",
    accountPlanStatus: "ACTIVE",
    accountPlanRemainingCredits: { amount: 140, unit: "USD" },
    accountPlanExpirationDate: EXPIRES,
  },
};
const DENIED: AwsReply = {
  status: 400,
  body: {
    __type: "com.amazon.coral.service#AccessDeniedException",
    Message: `User: arn:aws:sts::${ACCOUNT_ID}:assumed-role/agenda-costos-lectura/GitHubActions is not authorized to perform: ce:GetCostAndUsage`,
  },
};

const aws = await fakeAws();
const AWS_ENV = {
  NODE_ENV: "test",
  AWS_ACCESS_KEY_ID: KEY_ID,
  AWS_SECRET_ACCESS_KEY: SECRET,
  AWS_SESSION_TOKEN: TOKEN,
  AWS_COST_EXPLORER_URL: aws.url,
  AWS_FREE_TIER_URL: aws.url,
};
/** Un momento en la hora de Ecuador. */
const at = (day: string, time: string) => new Date(`${day}T${time}:00-05:00`);
const refresh = (now: Date, env: Record<string, string | undefined> = AWS_ENV) => refreshAwsCosts({ now, env });
/** Sin costos, sin intentos, sin aviso y sin emails del aviso. */
const reset = () =>
  sql(`delete from aws_costs;
       delete from notifications where type = 'aws_cost_alert';
       update platform_settings set aws_cost_alert = null, aws_cost_alerted_month = null, aws_cost_alerted_amount = null,
              aws_costs_attempted_at = null, aws_costs_attempts = 0, aws_costs_error = null;`);
/** Como si hoy no se hubiera intentado: para probar cada fallo desde cero. */
const freshDay = () => sql("update platform_settings set aws_costs_attempted_at = null, aws_costs_attempts = 0");
const settings = () =>
  JSON.parse(
    sql(`select json_build_object('alert', aws_cost_alert, 'alertedMonth', aws_cost_alerted_month, 'alertedAmount', aws_cost_alerted_amount,
                                  'attempts', aws_costs_attempts, 'error', aws_costs_error) from platform_settings`),
  );
const savedRow = (month: string) =>
  JSON.parse(
    sql(`select json_build_object('usage', usage_usd, 'credits', credits_usd, 'services', services, 'fetchedAt', fetched_at,
                                  'planType', plan_type, 'planStatus', plan_status, 'remaining', remaining_credits, 'expires', plan_expires_at)
           from aws_costs where month = '${month}'`) || "null",
  );
const alertEmails = () => count("select count(*) from notifications where type = 'aws_cost_alert'");
const lastAlertEmail = () =>
  sql(`select to_email || ' | ' || dedupe_key || ' | ' || subject || ' | ' || body from notifications where type = 'aws_cost_alert' order by created_at desc limit 1`);
const audits = () => count("select count(*) from audit_logs where action = 'platform.aws_cost_alert_changed'");
const lastAudit = () =>
  sql(`select coalesce(business_id::text, 'sin negocio') || ' | ' || summary || ' | ' || coalesce(changes::text, '')
         from audit_logs where action = 'platform.aws_cost_alert_changed' order by created_at desc, id desc limit 1`);

/* ------------------------------------------------------------- La firma ---- */

console.log("La firma (Signature V4): los ejemplos oficiales de AWS");
{
  const example = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
  const when = new Date("2015-08-30T12:36:00Z");
  const sign = (method: string) => signAwsRequest({ method, url: "https://example.amazonaws.com/", service: "service", region: "us-east-1" }, example, when);
  const get = sign("GET");
  ok(
    get.Authorization ===
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31" &&
      get["X-Amz-Date"] === "20150830T123600Z",
    "get-vanilla: la misma firma que el ejemplo de AWS",
    get,
  );
  ok(sign("POST").Authorization.endsWith("Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b"), "post-vanilla: también", sign("POST"));
  const withToken = signAwsRequest(
    { method: "POST", url: "https://ce.us-east-1.amazonaws.com/", headers: { "X-Amz-Target": CE }, body: "{}", service: "ce", region: "us-east-1" },
    { ...example, sessionToken: "token" },
    when,
  );
  ok(
    withToken["X-Amz-Security-Token"] === "token" && /SignedHeaders=host;x-amz-date;x-amz-security-token;x-amz-target,/.test(withToken.Authorization) && !("host" in withToken),
    "con credenciales temporales: el token va firmado; Host no se devuelve (lo pone fetch)",
    withToken,
  );
}

/* ------------------------------------------------------------- La lectura ---- */

console.log("La lectura de Cost Explorer y del plan");
{
  const reading = readCostPages([ceReply(MONTH_GROUPS).body as never]);
  ok(reading.usage === 0.3204 && reading.credits === 0.32, "lo gastado (sin créditos ni el reembolso) y lo que cubren los créditos, en positivo", reading);
  ok(
    JSON.stringify(reading.services.map((service) => [service.name, service.amount])) ===
      JSON.stringify([
        ["AWS Lambda", 0.2],
        ["AmazonCloudWatch", 0.08],
        ["AWS Cost Explorer", 0.03],
        ["Tax", 0.01],
        ["AWS Data Transfer", 0.0004],
        ["Amazon Simple Storage Service", 0],
      ]),
    "los servicios de mayor a menor, también los de $0,00 (la pantalla los junta)",
    reading.services,
  );
  const paged = readCostPages([usageReply(0.5).body as never, ceReply([["AmazonCloudWatch", "Usage", "0.25"]]).body as never]);
  ok(paged.usage === 0.75 && paged.credits === 0.5 && paged.services[0].name === "AWS Lambda", "con dos páginas, las suma", paged);
  ok(readCostPages([{} as never, null as never]).usage === 0, "una respuesta vacía: $0, sin error");

  const plan = readAccountPlan(PLAN_REPLY.body);
  ok(
    JSON.stringify(plan) === JSON.stringify({ type: "PAID", status: "ACTIVE", remainingCredits: 140, expiresAt: "2027-10-08T00:00:00.000Z" }) &&
      !JSON.stringify(plan).includes(ACCOUNT_ID),
    "el plan: de pago, los $140 de créditos y hasta cuándo valen (la fecha en segundos de AWS); sin el número de la cuenta",
    plan,
  );
  const free = readAccountPlan({ accountPlanType: "FREE", accountPlanStatus: "SOMETHING_NEW", accountPlanExpirationDate: "2027-04-22T00:00:00Z" });
  ok(free?.type === "FREE" && free.status === null && free.remainingCredits === null && free.expiresAt === "2027-04-22T00:00:00.000Z", "el gratuito, con la fecha en texto; lo que no se conoce, null", free);
  ok(readAccountPlan({ accountId: ACCOUNT_ID }) === null && readAccountPlan(null) === null, "sin un plan conocido: null");
}

console.log("La previsión");
ok(forecastUsage(0.5, "2026-10-01", "2026-10-01T15:00:00Z") === null, "el día 1 (UTC): todavía sin previsión");
ok(forecastUsage(0.3, "2026-10-01", "2026-10-16T11:00:00Z") === 0.62, "el 16 de octubre: $0,30 en 15 días cerrados → $0,62 en 31 días", forecastUsage(0.3, "2026-10-01", "2026-10-16T11:00:00Z"));
ok(forecastUsage(1, "2026-02-01", "2026-02-15T03:00:00Z") === 2, "febrero: $1 en 14 días → $2 en 28");
ok(forecastUsage(0.9, "2026-10-01", "2026-11-01T02:00:00Z") === 0.9, "un mes ya cerrado: lo gastado");

/* ------------------------------------------------------------- El cron ---- */

console.log("El cron: una consulta al día");
reset();
aws.handlers[CE] = () => ceReply(MONTH_GROUPS);
aws.handlers[FREE_TIER] = () => PLAN_REPLY;
let r = await refresh(at("2026-10-15", "05:59"));
ok(r.status === "early" && aws.requests.length === 0, "antes de las 06:00 de Ecuador, nada", r);
r = await refresh(at("2026-10-15", "06:00"), { NODE_ENV: "test", AWS_COST_EXPLORER_URL: aws.url });
ok(
  r.status === "no_credentials" && aws.requests.length === 0 && settings().error === AWS_COSTS_ERRORS.noCredentials && settings().attempts === 0,
  "sin las variables AWS_*: «sin credenciales», sin consultar, y la pantalla lo dirá",
  [r, settings()],
);
r = await refresh(at("2026-10-15", "06:00"));
ok(r.status === "saved" && r.attempts === 1 && r.plan === true && r.alert === null, "a las 06:00 los guarda", r);
ok(aws.calls(CE) === 1 && aws.calls(FREE_TIER) === 1, "con una consulta a Cost Explorer y otra al plan", aws.requests.map((request) => request.target));
ok(
  aws.requests.every((request) => request.signed && request.token === TOKEN) &&
    aws.requests[0].contentType === "application/x-amz-json-1.1" &&
    aws.requests[1].contentType === "application/x-amz-json-1.0",
  "cada petición firmada (la firma se vuelve a calcular con lo que llegó), con el token de sesión y su Content-Type",
  aws.requests,
);
ok(
  JSON.stringify(aws.requests[0].body) ===
    JSON.stringify({
      TimePeriod: { Start: "2026-10-01", End: "2026-10-16" },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [
        { Type: "DIMENSION", Key: "SERVICE" },
        { Type: "DIMENSION", Key: "RECORD_TYPE" },
      ],
    }),
  "el mes de facturación de AWS hasta mañana (el fin no entra), por servicio y por tipo de registro",
  aws.requests[0].body,
);
let row = savedRow("2026-10-01");
ok(
  row?.usage === 0.3204 && row.credits === 0.32 && row.services.length === 6 && row.planType === "PAID" && row.remaining === 140 && settings().error === null,
  "la fila del mes: lo gastado, los créditos, los servicios y el plan",
  row,
);
r = await refresh(at("2026-10-15", "06:10"));
ok(r.status === "ready" && aws.requests.length === 2, "la siguiente pasada del mismo día no consulta («ya estaban los de hoy»)", [r, aws.requests.length]);
r = await refresh(at("2026-10-15", "23:50"));
ok(r.status === "ready" && aws.requests.length === 2, "tampoco a las 23:50 (las 04:50 UTC del día siguiente, otro día en UTC)", r);

aws.handlers[CE] = () => usageReply(0.35);
r = await refresh(at("2026-10-16", "06:05"));
row = savedRow("2026-10-01");
ok(
  r.status === "saved" && r.attempts === 1 && aws.calls(CE) === 2 && row.usage === 0.35 && count("select count(*) from aws_costs") === 1,
  "al día siguiente, otra consulta: la fila del mes se reemplaza (una por mes)",
  [r, row],
);
const fetchedBefore = row.fetchedAt;

console.log("Si AWS falla");
aws.handlers[CE] = () => DENIED;
r = await refresh(at("2026-10-17", "06:00"));
ok(
  r.status === "failed" && r.attempts === 1 && settings().error === AWS_COSTS_ERRORS.permission && savedRow("2026-10-01").fetchedAt === fetchedBefore,
  "sin permiso: guarda el motivo en palabras sencillas y deja lo último guardado",
  [r, settings()],
);
ok(!sql("select coalesce(aws_costs_error, '') from platform_settings").includes(ACCOUNT_ID), "sin el número de la cuenta ni el mensaje de AWS");
const ceBefore = aws.calls(CE);
r = await refresh(at("2026-10-17", "08:59"));
ok(r.status === "waiting" && aws.calls(CE) === ceBefore, "antes de 3 horas, no reintenta", r);
r = await refresh(at("2026-10-17", "09:00"));
ok(r.status === "failed" && r.attempts === 2 && aws.calls(CE) === ceBefore + 1, "a las 3 horas, la segunda", r);
r = await refresh(at("2026-10-17", "12:05"));
ok(r.status === "failed" && r.attempts === 3 && aws.calls(CE) === ceBefore + 2, "y la tercera", r);
r = await refresh(at("2026-10-17", "18:00"));
ok(r.status === "waiting" && r.attempts === 3 && aws.calls(CE) === ceBefore + 2, "después de 3 consultas fallidas, nada más ese día", r);

const failures: [AwsReply, string, string][] = [
  [{ status: 400, body: { __type: "DataUnavailableException", Message: "Data is not available. Please try to adjust the time period." } }, AWS_COSTS_ERRORS.noData, "sin datos todavía"],
  [{ status: 400, body: { __type: "AccessDeniedException", Message: "User not enabled for cost explorer access" } }, AWS_COSTS_ERRORS.notEnabled, "Cost Explorer sin activar"],
  [{ status: 400, body: { __type: "UnrecognizedClientException", message: "The security token included in the request is invalid." } }, AWS_COSTS_ERRORS.credentials, "credenciales que AWS no acepta"],
  [{ status: 400, body: { __type: "LimitExceededException", Message: "Rate exceeded" } }, AWS_COSTS_ERRORS.throttled, "demasiadas consultas"],
  [{ status: 503, body: "<html>Service Unavailable</html>" }, `${AWS_COSTS_ERRORS.unexpected} (código 503)`, "un error de AWS sin JSON"],
];
for (const [reply, message, label] of failures) {
  freshDay();
  aws.handlers[CE] = () => reply;
  r = await refresh(at("2026-10-17", "19:00"));
  ok(r.status === "failed" && settings().error === message, `${label}: «${message}»`, settings());
}
freshDay();
const closedPort = await freePort();
r = await refresh(at("2026-10-17", "19:00"), { ...AWS_ENV, AWS_COST_EXPLORER_URL: `http://127.0.0.1:${closedPort}/` });
ok(r.status === "failed" && settings().error === AWS_COSTS_ERRORS.network, `sin respuesta: «${AWS_COSTS_ERRORS.network}»`, settings());

aws.handlers[CE] = () => ceReply(MONTH_GROUPS);
aws.handlers[FREE_TIER] = () => DENIED;
r = await refresh(at("2026-10-18", "06:00"));
row = savedRow("2026-10-01");
ok(
  r.status === "saved" && r.plan === false && row.usage === 0.3204 && row.planType === null && row.remaining === null && settings().error === null,
  "si el plan falla (sin su permiso), los costos se guardan igual, sin plan, y el motivo anterior se borra",
  [r, row, settings()],
);

aws.handlers[FREE_TIER] = () => PLAN_REPLY;
aws.handlers[CE] = (body) =>
  body.NextPageToken === "pagina-2"
    ? ceReply([["AmazonCloudWatch", "Usage", "0.25"]], "pagina-3")
    : ceReply([["AWS Lambda", "Usage", "0.5"], ["AWS Lambda", "Credit", "-0.5"]], "pagina-2");
const pagesBefore = aws.calls(CE);
r = await refresh(at("2026-10-19", "06:00"));
ok(
  r.status === "saved" && aws.calls(CE) === pagesBefore + 2 && savedRow("2026-10-01").usage === 0.75,
  "con otra página la sigue, pero no más de dos (cada una cuesta $0,01)",
  [r, aws.calls(CE) - pagesBefore, savedRow("2026-10-01")],
);

{
  // En producción, las direcciones de prueba no se leen: el cron de verdad sólo firma para AWS.
  const seen: string[] = [];
  const stub = (async (url: string | URL | Request) => {
    seen.push(String(url));
    return new Response(JSON.stringify(String(url).includes("freetier") ? PLAN_REPLY.body : usageReply(0.1).body), { status: 200 });
  }) as typeof fetch;
  r = await refreshAwsCosts({ now: at("2026-10-20", "06:00"), env: { ...AWS_ENV, NODE_ENV: "production" }, fetch: stub });
  ok(
    r.status === "saved" && JSON.stringify(seen) === JSON.stringify(["https://ce.us-east-1.amazonaws.com/", "https://freetier.us-east-1.api.aws/"]),
    "con NODE_ENV=production no se leen AWS_COST_EXPLORER_URL ni AWS_FREE_TIER_URL (sólo para las pruebas)",
    seen,
  );
}

/* --------------------------------------------------------------- La API ---- */

console.log("Quién los ve");
const admin = await login("admin@demo.com", { ip: "10.31.0.1" });
const owner = await login("jhordan@demo.com", { ip: "10.31.0.2" });
const read = async (browser = admin) => {
  const reply = await browser("GET", "/admin/aws-costs");
  return { ...reply, costs: reply.body as AwsCosts };
};
const auditBefore = count("select count(*) from audit_logs");
const requestsBefore = aws.requests.length;
let api = await read();
ok(api.status === 200 && api.headers.get("cache-control") === "no-store", "el super admin los lee, sin caché (no-store)", [api.status, api.headers.get("cache-control")]);
ok(
  api.costs.latest?.month === "2026-10-01" &&
    api.costs.latest.usage === 0.1 &&
    api.costs.latest.credits === 0.1 &&
    api.costs.latest.net === 0 &&
    api.costs.latest.forecast === 0.1632 &&
    api.costs.latest.plan?.remainingCredits === 140 &&
    api.costs.latest.fetchedAt === at("2026-10-20", "06:00").toISOString() &&
    api.costs.lastError === null &&
    api.costs.alertAmount === null &&
    api.costs.alertedThisMonth === false,
  "el mes, lo gastado, lo cubierto, lo que se paga, la previsión, el plan y cuándo se actualizó",
  api.costs,
);
await read();
await read();
ok(aws.requests.length === requestsBefore, "abrir la página varias veces no consulta a AWS");
ok(count("select count(*) from audit_logs") === auditBefore, "leer no va a la actividad");
ok(!JSON.stringify(api.body).includes(ACCOUNT_ID), "ni el número de la cuenta de AWS");
r = await refresh(at("2026-10-21", "06:00"), { NODE_ENV: "test" });
api = await read();
ok(api.costs.latest?.usage === 0.1 && api.costs.lastError === AWS_COSTS_ERRORS.noCredentials, "si la última no salió bien: lo último guardado y el motivo", api.costs);

let reply = await owner("GET", "/admin/aws-costs");
ok(reply.status === 403 && !("latest" in (reply.body ?? {})), "un propietario: 403", reply.body);
reply = await owner("PUT", "/admin/aws-costs/alert", { amount: 5 });
ok(reply.status === 403 && settings().alert === null, "ni cambia el aviso", reply.body);
reply = await agent({ ip: "10.31.0.3" })("GET", "/admin/aws-costs");
ok(reply.status === 401, "sin sesión: 401", reply.status);
reply = await admin("POST", "/admin/platform-admins", { firstName: "Sofía", lastName: "Soporte", email: "sofia.costos@example.com", password: "Soporte-2026" });
ok(reply.status === 200 && reply.body.user.platformOwner === false, "el principal agrega a otro super admin", reply.body);
const helper = agent({ ip: "10.31.0.4" });
await helper("POST", "/auth/login", { email: "sofia.costos@example.com", password: "Soporte-2026", remember: true });
ok((await read(helper)).status === 200, "otro super admin (no el principal) también los ve");
const strict = await startApi({ SUPER_ADMIN_2FA: "required" });
const strictAdmin = await login("admin@demo.com", { base: strict.base, ip: "10.31.0.5" });
reply = await strictAdmin("GET", "/admin/aws-costs");
ok(reply.status === 403 && reply.body.error.code === "two_factor_required", "sin la verificación en dos pasos: two_factor_required, como el resto de /admin", reply.body);
reply = await strictAdmin("PUT", "/admin/aws-costs/alert", { amount: 5 });
ok(reply.status === 403 && reply.body.error.code === "two_factor_required", "tampoco cambia el aviso", reply.body);
strict.stop();

console.log("El monto del aviso");
for (const [amount, label] of [
  [0, "$0"],
  [-1, "un monto negativo"],
  [1.234, "más de dos decimales"],
  [100_000.01, "más de $100.000"],
  ["abc", "un texto"],
  ["", "vacío (para quitarlo se envía null)"],
  [undefined, "sin monto"],
] as const) {
  reply = await admin("PUT", "/admin/aws-costs/alert", { amount });
  ok(reply.status === 400 && reply.body.error.code === "validation", `${label} → 400`, reply.body);
}
const auditsBefore = audits();
reply = await admin("PUT", "/admin/aws-costs/alert", { amount: 1 });
ok(reply.status === 200 && (reply.body as AwsCosts).alertAmount === 1 && settings().alert === 1, "el super admin pone el aviso en $1", reply.body);
ok(
  audits() === auditsBefore + 1 &&
    lastAudit().startsWith("sin negocio | Puso el aviso de los costos de AWS en $1,00 | ") &&
    lastAudit().includes('"before": "Sin aviso"') &&
    lastAudit().includes('"after": "$1,00"'),
  "queda en la actividad de la plataforma, con el antes y el después",
  lastAudit(),
);
reply = await admin("PUT", "/admin/aws-costs/alert", { amount: 1 });
ok(reply.status === 200 && audits() === auditsBefore + 1, "el mismo otra vez no anota nada");

const pub = await fetch(`${BASE}/public/platform-settings`);
const pubText = await pub.text();
ok(Object.keys(JSON.parse(pubText)).sort().join(",") === "allowPublicSignup,supportEmail,supportPhone", "/public/platform-settings sigue sin campos nuevos", pubText);

/* --------------------------------------------------------------- El aviso ---- */

console.log("El aviso: una vez por mes y por monto");
sql(`delete from aws_costs; delete from notifications where type = 'aws_cost_alert';
     update platform_settings set aws_costs_attempted_at = null, aws_costs_attempts = 0, aws_costs_error = null,
            aws_cost_alerted_month = null, aws_cost_alerted_amount = null;`);
const principal = sql("select email from users where platform_owner and is_active limit 1");
aws.handlers[CE] = () => usageReply(1.2);
r = await refresh(at("2026-11-10", "06:00"));
ok(
  r.status === "saved" &&
    JSON.stringify(r.alert) === JSON.stringify({ month: "2026-11-01", usage: 1.2, forecast: 4, credits: 1.2, net: 0, alertAmount: 1 }),
  "con $1,20 gastados sobre un aviso de $1: el aviso de esta pasada, con la previsión ($1,20 en 9 días → $4 en 30) y los créditos",
  r.alert,
);
ok(alertEmails() === 1 && lastAlertEmail().startsWith(`${principal} | aws-cost:2026-11:1.00 | Agenda360: los costos de AWS pasaron tu aviso de $1,00 | `), "un email al super admin principal", lastAlertEmail().slice(0, 160));
const alertBody = lastAlertEmail();
ok(
  ["noviembre de 2026", "$1,20", "$1,00", "$4,00", "Pagas de verdad", "/admin/costs"].every((text) => alertBody.includes(text)),
  "con lo gastado, el monto, la previsión, lo que cubren los créditos y el enlace a «Costos»",
  alertBody,
);
ok(JSON.stringify(settings()).includes('"alertedMonth":"2026-11-01","alertedAmount":1'), "y la marca del mes y el monto", settings());
api = await read();
ok(api.costs.alertedThisMonth === true && api.costs.alertAmount === 1, "la página sabe que ya se avisó este mes", api.costs);
const notice = buildCostNotice({ awsCosts: r } as never);
ok(
  notice?.title === "Agenda360: costos de AWS" &&
    notice.priority === 4 &&
    notice.click === "/admin/costs" &&
    ["$1,20", "$1,00", "$4,00", "Pagas: $0,00"].every((text) => notice.message.includes(text)),
  "el ntfy: título fijo (el registro de Actions sólo guarda el título) y los montos en el mensaje",
  notice,
);
ok(buildCostNotice({ awsCosts: { status: "saved", attempts: 1, alert: null } } as never) === null && buildCostNotice({} as never) === null, "sin aviso, sin ntfy");

aws.handlers[CE] = () => usageReply(1.3);
r = await refresh(at("2026-11-11", "06:00"));
ok(r.status === "saved" && r.alert === null && alertEmails() === 1, "al día siguiente, aunque siga por encima, no se repite", r);

reply = await admin("PUT", "/admin/aws-costs/alert", { amount: 1.25 });
ok(
  reply.status === 200 && (reply.body as AwsCosts).alertedThisMonth === false && lastAudit().includes("Cambió el aviso de los costos de AWS de $1,00 a $1,25"),
  "cambiar el monto lo vuelve a dejar disponible (y queda en la actividad)",
  [reply.body, lastAudit()],
);
r = await refresh(at("2026-11-12", "06:00"));
ok(r.alert?.alertAmount === 1.25 && alertEmails() === 2 && lastAlertEmail().includes("aws-cost:2026-11:1.25"), "con $1,30 sobre el nuevo de $1,25: otra vez", r.alert);

reply = await admin("PUT", "/admin/aws-costs/alert", { amount: 1 });
aws.handlers[CE] = () => usageReply(1.4);
r = await refresh(at("2026-11-13", "06:00"));
ok(r.alert === null && alertEmails() === 2, "volver a un monto con el que ya se avisó este mes no lo repite (ni el email ni el ntfy)", r);

reply = await admin("PUT", "/admin/aws-costs/alert", { amount: 2 });
aws.handlers[CE] = () => usageReply(2.004);
r = await refresh(at("2026-11-14", "06:00"));
ok(r.alert === null && alertEmails() === 2, "lo que se ve igual al monto ($2,00 sobre $2) no lo pasa", r);

reply = await admin("PUT", "/admin/aws-costs/alert", { amount: 1 });
aws.handlers[CE] = () => usageReply(1.1);
r = await refresh(at("2026-12-02", "06:00"));
ok(r.alert?.month === "2026-12-01" && r.alert.forecast === 34.1 && alertEmails() === 3 && lastAlertEmail().includes("aws-cost:2026-12:1.00"), "en el mes nuevo, otra vez", r.alert);

aws.handlers[CE] = () => usageReply(0.5);
r = await refresh(at("2027-01-05", "06:00"));
api = await read();
ok(
  r.alert === null && alertEmails() === 3 && api.costs.latest?.forecast === 3.875 && api.costs.latest.usage < 1 && api.costs.alertedThisMonth === false,
  "por debajo, nunca, aunque la previsión lo pase (la página lo señala, sin aviso)",
  [r, api.costs.latest?.forecast],
);

reply = await admin("PUT", "/admin/aws-costs/alert", { amount: null });
ok(
  reply.status === 200 && (reply.body as AwsCosts).alertAmount === null && lastAudit().startsWith("sin negocio | Quitó el aviso de los costos de AWS (era de $1,00)"),
  "quitar el aviso (null) también queda en la actividad",
  [reply.body, lastAudit()],
);
aws.handlers[CE] = () => usageReply(50);
r = await refresh(at("2027-01-06", "06:00"));
ok(r.alert === null && alertEmails() === 3, "sin aviso no se avisa nada", r);

console.log("El email y el registro");
{
  const email = emailTemplates.awsCostAlert({ month: "2026-10-01", usage: 0.004, alertAmount: 0.01, forecast: null, credits: 0, net: 0.004, costsUrl: "https://agenda.example/admin/costs" });
  ok(
    email.subject === "Agenda360: los costos de AWS pasaron tu aviso de $0,01" &&
      email.body.includes("menos de $0,01") &&
      email.body.includes("Todavía sin previsión") &&
      email.html.includes("https://agenda.example/admin/costs"),
    "el email: lo que no llega a un centavo es «menos de $0,01» y el día 1, «Todavía sin previsión»",
    email.body,
  );
  const statuses = ["saved", "ready", "early", "no_credentials", "waiting", "failed"] as const;
  const lines = statuses.map((status) => describeAwsCostsLine({ awsCosts: { status, attempts: status === "waiting" ? 3 : 1, alert: r.alert } } as never));
  ok(
    lines.every((line) => line.startsWith(" · costos de AWS: ") && !/\$|\d,\d/.test(line)) && lines[4].includes("se reintenta mañana"),
    "la línea del registro, en cada caso, sin montos",
    lines,
  );
}

console.log("El cron de GitHub de verdad (scripts/cron.ts)");
{
  reset();
  sql("update platform_settings set aws_cost_alert = 0.1");
  aws.handlers[CE] = () => ceReply(MONTH_GROUPS);
  aws.handlers[FREE_TIER] = () => PLAN_REPLY;
  const ntfy = await fakeNtfy();
  const cronEnv = AWS_ENV;
  const afterSix = getZonedNow("America/Guayaquil").minutes >= 6 * 60;
  const ceStart = aws.calls(CE);
  let run = await runCron(ntfy.url, cronEnv);
  const lastReport = () => JSON.parse(sql("select report->'awsCosts' from cron_runs order by ran_at desc limit 1") || "null");
  const costNotice = ntfy.received.find((received) => received.title === "Agenda360: costos de AWS");
  if (afterSix) {
    ok(
      run.code === 0 && / · costos de AWS: actualizados · base de datos: /.test(run.output) && lastReport()?.status === "saved" && aws.calls(CE) === ceStart + 1,
      "después de las 06:00 los actualiza: «costos de AWS: actualizados»",
      [run.output.slice(-400), lastReport()],
    );
    ok(
      costNotice?.priority === 4 && costNotice.click === "https://agendo.example/admin/costs" && costNotice.message.includes("$0,32") && costNotice.message.includes("$0,10"),
      "y, al pasar el aviso de $0,10, el ntfy con los montos",
      costNotice,
    );
    ok(
      run.output.includes("[ntfy] Agenda360: costos de AWS") && !/\$\s?\d/.test(run.output) && !run.output.includes(ACCOUNT_ID),
      "el registro (público) sólo lleva el título del aviso: ningún monto ni el número de la cuenta",
      run.output.slice(-600),
    );
    ok(alertEmails() === 1 && sql("select status from notifications where type = 'aws_cost_alert'") === "queued", "el email queda en cola (sale en la siguiente pasada)");
    run = await runCron(ntfy.url, cronEnv);
    ok(run.code === 0 && / · costos de AWS: ya estaban los de hoy · /.test(run.output) && aws.calls(CE) === ceStart + 1, "la segunda pasada no consulta", run.output.slice(-300));

    reset();
    run = await runCron(ntfy.url);
    ok(run.code === 0 && / · costos de AWS: sin credenciales \(falta el rol de AWS\) · /.test(run.output), "sin las credenciales (sin el secreto en GitHub): «sin credenciales»", run.output.slice(-300));

    reset();
    aws.handlers[CE] = () => DENIED;
    run = await runCron(ntfy.url, cronEnv);
    ok(
      run.code === 0 &&
        / · costos de AWS: falló \(se reintenta 3 horas después\) · /.test(run.output) &&
        /Recordatorios: \d+ · /.test(run.output) &&
        typeof JSON.parse(sql("select report->'reminders' from cron_runs order by ran_at desc limit 1")) === "number" &&
        settings().error === AWS_COSTS_ERRORS.permission &&
        !run.output.includes(ACCOUNT_ID),
      "si AWS falla, el resto del cron sigue igual y el registro no lleva el mensaje de AWS",
      run.output.slice(-400),
    );
  } else {
    ok(
      run.code === 0 && / · costos de AWS: se actualizan después de las 06:00 · /.test(run.output) && aws.calls(CE) === ceStart && !costNotice,
      "antes de las 06:00: «se actualizan después de las 06:00», sin consultar",
      run.output.slice(-300),
    );
  }
  ntfy.close();
}

aws.close();
await pool.end();
done("de los costos de AWS");
