import { one, pool, transaction, type Db } from "../db/pool.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { formatUsdAmount } from "../shared/lib/constants/business.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { addDaysISO, endOfMonthISO, getZonedNow } from "../shared/lib/time.ts";
import { awsCostAlertSchema } from "../shared/lib/validations/admin.ts";
import type { AwsAccountPlan, AwsCosts, AwsServiceCost, ISODate, ISODateTime } from "../shared/types/index.ts";
import { logAudit } from "./audit.ts";
import { signAwsRequest, type AwsCredentials } from "./aws-signature.ts";
import { authorizeSuperAdmin, parseInput, type RequestContext } from "./context.ts";
import { appOrigin, queueEmail } from "./notifications.ts";

/**
 * Los costos de AWS en /admin (spec 031): lo que cuesta el backend en AWS en el mes, la previsión, el
 * desglose por servicio y los créditos, sin entrar a AWS.
 *
 * - **Una consulta al día, desde el cron de GitHub** (refreshAwsCosts, al estilo de saveDailyDatabaseStats):
 *   Cost Explorer cobra $0,01 por consulta (aprobado por el dueño del producto) y sólo actualiza sus datos
 *   unas tres veces al día. Desde las 06:00 de Ecuador, si hoy no salió bien; si falla, reintenta pasadas 3
 *   horas, hasta 3 consultas al día. La pantalla sólo lee lo guardado: abrirla nunca consulta a AWS.
 * - **Una sola consulta da todo:** `GetCostAndUsage` del mes en curso agrupado por servicio y por tipo de
 *   registro: lo gastado por servicio y, aparte, lo que cubren los créditos (`Credit`). El plan de la cuenta y
 *   los créditos que quedan salen del Free Tier API (`GetAccountPlanState`, sin costo); si falla, los costos se
 *   guardan igual.
 * - **Las credenciales** son las de un rol de AWS sólo de lectura de los costos, que deja el paso de GitHub en
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y AWS_SESSION_TOKEN. Sin ellas (en local, o antes de los pasos en
 *   AWS) no consulta: queda «sin credenciales». La firma va a mano (aws-signature.ts), sin el SDK de AWS.
 * - **El mes** es el de la facturación de AWS: corta a medianoche UTC (las 19:00 de Ecuador).
 * - **El aviso:** cuando lo gastado pasa el monto que puso el super admin, un email al super admin principal
 *   (con dedupeKey) y el ntfy del cron (buildCostNotice), una vez por mes y por monto.
 * - **Los registros del cron son públicos:** el resumen de esta pasada lleva los montos sólo para el ntfy; la
 *   línea del registro no los muestra. Los errores se guardan en palabras sencillas, nunca el mensaje de AWS
 *   tal cual (puede llevar el número de la cuenta).
 */

/* ---------------------------------------------------------------- Reglas ---- */

/** Desde qué hora de Ecuador consulta el cron (como la foto de la base y la analítica). */
export const AWS_COSTS_HOUR = 6;
/** Tras un fallo, el cron reintenta pasadas estas horas, con hasta AWS_COSTS_MAX_ATTEMPTS consultas al día. */
export const AWS_COSTS_RETRY_HOURS = 3;
export const AWS_COSTS_MAX_ATTEMPTS = 3;
/** El tiempo máximo de cada petición a AWS. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Las páginas de Cost Explorer que se siguen (cada una es una consulta de $0,01): un mes cabe en una. */
const MAX_PAGES = 2;
/** Cost Explorer y el Free Tier API sólo están en us-east-1, aunque la API corra en Oregón. */
const REGION = "us-east-1";

const COST_EXPLORER = {
  url: "https://ce.us-east-1.amazonaws.com/",
  service: "ce",
  contentType: "application/x-amz-json-1.1",
  target: "AWSInsightsIndexService.GetCostAndUsage",
};
const FREE_TIER = {
  url: "https://freetier.us-east-1.api.aws/",
  service: "freetier",
  contentType: "application/x-amz-json-1.0",
  target: "AWSFreeTierService.GetAccountPlanState",
};

/** Los tipos de registro que no son gasto: los créditos (en negativo) y los reembolsos. */
const CREDIT = "Credit";
const REFUND = "Refund";

/** Lo que dice la pantalla cuando no se pudo actualizar, en palabras sencillas (nunca el mensaje de AWS). */
export const AWS_COSTS_ERRORS = {
  noCredentials: "El cron no tiene las credenciales de AWS: falta el rol de sólo lectura de los costos (el secreto AWS_COSTS_ROLE_ARN de GitHub)",
  credentials: "AWS no aceptó las credenciales del cron",
  permission: "Falta el permiso de AWS para leer los costos",
  notEnabled: "Cost Explorer no está activado en la cuenta de AWS",
  noData: "Cost Explorer todavía no tiene datos (tarda hasta un día tras activarlo)",
  throttled: "AWS pidió esperar: hubo demasiadas consultas seguidas",
  network: "AWS no respondió",
  unexpected: "AWS respondió con un error inesperado",
} as const;

/** Un fallo de AWS ya en palabras sencillas: es lo que se guarda y lo que ve el super admin. */
class AwsCostsError extends Error {}

/** Cuatro decimales, como la tabla (AWS da fracciones de centavo: 0,0000012). */
const round4 = (amount: number) => Math.round(amount * 10_000) / 10_000;
/** En centavos, para comparar con el monto del aviso como se ven en la pantalla. */
const cents = (amount: number) => Math.round(amount * 100);

/* --------------------------------------------------------- Las credenciales ---- */

type Env = Record<string, string | undefined>;

/** Las del paso de GitHub (configure-aws-credentials); null si faltan. */
function credentialsFrom(env: Env): AwsCredentials | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = env.AWS_SESSION_TOKEN?.trim();
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

/**
 * Las direcciones de AWS. AWS_COST_EXPLORER_URL y AWS_FREE_TIER_URL las cambian SÓLO las pruebas (un AWS falso
 * local, tests/aws-costs.test.ts): con NODE_ENV=production no se leen, así el cron de verdad nunca firma
 * peticiones para otra dirección.
 */
function endpoints(env: Env): { costExplorer: string; freeTier: string } {
  const testing = env.NODE_ENV !== "production";
  return {
    costExplorer: (testing && env.AWS_COST_EXPLORER_URL?.trim()) || COST_EXPLORER.url,
    freeTier: (testing && env.AWS_FREE_TIER_URL?.trim()) || FREE_TIER.url,
  };
}

/* ------------------------------------------------------------ Las peticiones ---- */

/** El fallo de AWS en palabras sencillas, por su tipo (`__type`) y su código HTTP. Nunca su mensaje tal cual. */
function describeAwsError(status: number, text: string): string {
  let type = "";
  let message = "";
  try {
    const body = JSON.parse(text) as { __type?: unknown; code?: unknown; message?: unknown; Message?: unknown };
    type = String(body.__type ?? body.code ?? "").split("#").pop() ?? "";
    message = String(body.message ?? body.Message ?? "");
  } catch {
    // Sin JSON: sólo cuenta el código HTTP.
  }
  if (/DataUnavailable/i.test(type)) return AWS_COSTS_ERRORS.noData;
  if (/not enabled|enable cost explorer/i.test(message)) return AWS_COSTS_ERRORS.notEnabled;
  if (/UnrecognizedClient|InvalidClientTokenId|ExpiredToken|SignatureDoesNotMatch|MissingAuthenticationToken|IncompleteSignature/i.test(type)) {
    return AWS_COSTS_ERRORS.credentials;
  }
  if (status === 403 || /AccessDenied|NotAuthorized|Unauthorized/i.test(type)) return AWS_COSTS_ERRORS.permission;
  if (status === 429 || /LimitExceeded|Throttl|TooManyRequests/i.test(type)) return AWS_COSTS_ERRORS.throttled;
  return `${AWS_COSTS_ERRORS.unexpected} (código ${status})`;
}

/** Un POST firmado a AWS, con su tope de tiempo. Devuelve el JSON de la respuesta o lanza AwsCostsError. */
async function callAws(
  api: typeof COST_EXPLORER,
  url: string,
  body: unknown,
  credentials: AwsCredentials,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const payload = JSON.stringify(body);
  const headers = signAwsRequest(
    { method: "POST", url, headers: { "Content-Type": api.contentType, "X-Amz-Target": api.target }, body: payload, service: api.service, region: REGION },
    credentials,
  );
  let status: number;
  let text: string;
  try {
    const response = await fetchImpl(url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    status = response.status;
    text = await response.text();
  } catch {
    throw new AwsCostsError(AWS_COSTS_ERRORS.network);
  }
  if (status < 200 || status >= 300) throw new AwsCostsError(describeAwsError(status, text));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AwsCostsError(AWS_COSTS_ERRORS.unexpected);
  }
}

/** Una página de GetCostAndUsage (sólo lo que se lee). */
interface CostExplorerPage {
  ResultsByTime?: { Groups?: { Keys?: string[]; Metrics?: Record<string, { Amount?: string; Unit?: string }> }[] }[];
  NextPageToken?: string;
}

/** Lo que se lee de Cost Explorer: lo gastado (sin créditos ni reembolsos), lo que cubren los créditos y cada servicio. */
export interface AwsCostReading {
  usage: number;
  credits: number;
  /** De mayor a menor (con el mismo monto, por nombre). */
  services: AwsServiceCost[];
}

/**
 * Las páginas de GetCostAndUsage, agrupadas por servicio y por tipo de registro: lo gastado es todo menos los
 * créditos y los reembolsos (el uso, los impuestos, las cuotas…), los créditos van en negativo (se suman en
 * positivo) y cada servicio suma su gasto. Nada baja de cero.
 */
export function readCostPages(pages: CostExplorerPage[]): AwsCostReading {
  const byService = new Map<string, number>();
  let usage = 0;
  let credits = 0;
  for (const page of pages) {
    for (const period of page?.ResultsByTime ?? []) {
      for (const group of period?.Groups ?? []) {
        const [service = "", recordType = ""] = group?.Keys ?? [];
        const amount = Number(group?.Metrics?.UnblendedCost?.Amount ?? 0);
        if (!Number.isFinite(amount) || recordType === REFUND) continue;
        if (recordType === CREDIT) {
          credits -= amount;
          continue;
        }
        usage += amount;
        const name = service.trim() || "Sin servicio";
        byService.set(name, (byService.get(name) ?? 0) + amount);
      }
    }
  }
  const services = [...byService]
    .map(([name, amount]) => ({ name, amount: Math.max(0, round4(amount)) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { usage: Math.max(0, round4(usage)), credits: Math.max(0, round4(credits)), services };
}

/**
 * Una fecha de AWS: en los servicios con JSON suele llegar en segundos desde 1970 (1791417600), y en algunos,
 * como texto ISO. null si no se entiende.
 */
function readAwsTime(value: unknown): ISODateTime | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null;
  const date = numeric !== null ? new Date(numeric < 1e12 ? numeric * 1000 : numeric) : typeof value === "string" && value.trim() !== "" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/** El plan de la cuenta de GetAccountPlanState (null si la respuesta no trae un plan conocido). */
export function readAccountPlan(body: unknown): AwsAccountPlan | null {
  const state = (body ?? {}) as {
    accountPlanType?: unknown;
    accountPlanStatus?: unknown;
    accountPlanRemainingCredits?: { amount?: unknown; unit?: unknown };
    accountPlanExpirationDate?: unknown;
  };
  if (state.accountPlanType !== "FREE" && state.accountPlanType !== "PAID") return null;
  const status = ["NOT_STARTED", "ACTIVE", "EXPIRED"].includes(String(state.accountPlanStatus))
    ? (state.accountPlanStatus as AwsAccountPlan["status"])
    : null;
  const credits = state.accountPlanRemainingCredits;
  const amount = Number(credits?.amount);
  const remainingCredits = credits && credits.amount !== null && Number.isFinite(amount) && (credits.unit ?? "USD") === "USD" ? round4(amount) : null;
  return { type: state.accountPlanType, status, remainingCredits, expiresAt: readAwsTime(state.accountPlanExpirationDate) };
}

/** Lo gastado en el mes de facturación hasta mañana (el fin es exclusivo): una consulta y, si hiciera falta, otra página. */
async function fetchMonthCosts(month: ISODate, end: ISODate, url: string, credentials: AwsCredentials, fetchImpl: typeof fetch): Promise<AwsCostReading> {
  const pages: CostExplorerPage[] = [];
  let nextPageToken: string | undefined;
  do {
    const query = {
      TimePeriod: { Start: month, End: end },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [
        { Type: "DIMENSION", Key: "SERVICE" },
        { Type: "DIMENSION", Key: "RECORD_TYPE" },
      ],
      ...(nextPageToken ? { NextPageToken: nextPageToken } : {}),
    };
    const page = (await callAws(COST_EXPLORER, url, query, credentials, fetchImpl)) as CostExplorerPage;
    pages.push(page);
    nextPageToken = typeof page?.NextPageToken === "string" && page.NextPageToken !== "" ? page.NextPageToken : undefined;
  } while (nextPageToken && pages.length < MAX_PAGES);
  return readCostPages(pages);
}

/* ---------------------------------------------------------------- Las cuentas ---- */

/**
 * La previsión para fin de mes: lo gastado al ritmo de los días ya cerrados (el día del mes en UTC menos 1)
 * por los días del mes. El día 1 todavía no hay ninguno cerrado: null («todavía sin previsión»). Si el dato es
 * de un mes ya cerrado, la previsión es lo gastado.
 */
export function forecastUsage(usage: number, month: ISODate, fetchedAt: Date | ISODateTime): number | null {
  const day = new Date(fetchedAt).toISOString().slice(0, 10);
  if (day.slice(0, 7) > month.slice(0, 7)) return usage;
  const closedDays = Number(day.slice(8, 10)) - 1;
  if (closedDays < 1) return null;
  const daysInMonth = Number(endOfMonthISO(month).slice(8, 10));
  return round4((usage / closedDays) * daysInMonth);
}

/** Lo que se paga de verdad: lo gastado menos los créditos, nunca menos de cero. */
const netOf = (usage: number, credits: number) => Math.max(0, round4(usage - credits));

/** La clave del email del aviso: uno por mes y por monto («aws-cost:2026-10:1.00»). */
const alertKey = (month: ISODate, amount: number) => `aws-cost:${month.slice(0, 7)}:${amount.toFixed(2)}`;

/* ------------------------------------------------------------ El cron ---- */

/** El aviso que salió en una pasada: lleva montos, así que sólo va a ntfy (nunca al registro público). */
export interface AwsCostAlertNotice {
  /** El día 1 del mes de facturación. */
  month: ISODate;
  usage: number;
  alertAmount: number;
  forecast: number | null;
  credits: number;
  net: number;
}

/** Lo que hizo una pasada del cron con los costos de AWS (para su registro: sin montos, salvo el aviso de ntfy). */
export interface AwsCostsRefresh {
  /**
   * saved: los guardó · ready: ya estaban los de hoy · early: antes de las 06:00 de Ecuador · no_credentials:
   * sin las credenciales de AWS (no consulta) · waiting: falló hace menos de 3 horas o ya van 3 consultas hoy ·
   * failed: falló (el motivo queda guardado para la pantalla).
   */
  status: "saved" | "ready" | "early" | "no_credentials" | "waiting" | "failed";
  /** Las consultas a AWS de hoy (hasta AWS_COSTS_MAX_ATTEMPTS). */
  attempts: number;
  /** Al guardar: si se leyó el plan de la cuenta (false: GetAccountPlanState falló y los costos se guardaron igual). */
  plan?: boolean;
  /** El aviso de esta pasada (null: ninguno). */
  alert: AwsCostAlertNotice | null;
}

/**
 * El aviso, después de guardar: si hay monto, lo gastado lo pasa (en centavos, como se ve) y todavía no se avisó
 * este mes con este monto, deja la marca y le pone en cola el email al super admin principal. Devuelve el aviso
 * para el ntfy, o null. Si el email ya había salido con este mes y este monto (p. ej. se volvió a un monto
 * anterior), no se repite nada.
 */
async function queueCostAlert(
  db: Db,
  costs: Omit<AwsCostAlertNotice, "alertAmount">,
  settings: { alert: number | null; alertedMonth: ISODate | null; alertedAmount: number | null },
): Promise<AwsCostAlertNotice | null> {
  const { alert } = settings;
  if (alert === null || cents(costs.usage) <= cents(alert)) return null;
  if (settings.alertedMonth === costs.month && settings.alertedAmount === alert) return null;
  await db.query("update platform_settings set aws_cost_alerted_month = $1, aws_cost_alerted_amount = $2", [costs.month, alert]);
  const notice: AwsCostAlertNotice = { ...costs, alertAmount: alert };
  const owner = await one<{ email: string }>(db, "select email from users where platform_owner and is_active limit 1");
  if (!owner) return notice;
  const queued = await queueEmail(db, {
    businessId: null,
    type: "aws_cost_alert",
    to: owner.email,
    dedupeKey: alertKey(costs.month, alert),
    ...emailTemplates.awsCostAlert({ ...notice, costsUrl: `${appOrigin()}/admin/costs` }),
  });
  return queued ? notice : null;
}

/**
 * La actualización de cada día (spec 031), en cada pasada del cron:
 * 1. antes de las 06:00 de Ecuador, nada (`early`); si hoy ya salió bien, nada (`ready`);
 * 2. sin credenciales de AWS no consulta (`no_credentials`) y la pantalla lo dice;
 * 3. si hoy ya falló, espera 3 horas desde el último intento, hasta 3 consultas al día (`waiting`);
 * 4. si no, anota el intento (antes de consultar: un corte a medias también cuenta), consulta a AWS los costos
 *    del mes de facturación (el de `now` en UTC) y el plan, guarda la fila del mes y, si toca, el aviso.
 * Si AWS falla, guarda el motivo en palabras sencillas y deja lo último guardado (`failed`). Nunca hay más de
 * una consulta correcta al día. `now`, `env` y `fetch`: las pruebas los cambian (un AWS falso local).
 */
export async function refreshAwsCosts(options: { now?: Date; env?: Env; fetch?: typeof fetch } = {}): Promise<AwsCostsRefresh> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const zoned = getZonedNow(DEFAULT_TIMEZONE, now);
  if (zoned.minutes < AWS_COSTS_HOUR * 60) return { status: "early", attempts: 0, alert: null };

  const state = (await one<{ savedToday: boolean; attempts: number }>(
    pool,
    `select exists (select 1 from aws_costs c where (c.fetched_at at time zone $1)::date = $2::date) as "savedToday",
            case when (s.aws_costs_attempted_at at time zone $1)::date = $2::date then s.aws_costs_attempts else 0 end as attempts
       from platform_settings s`,
    [DEFAULT_TIMEZONE, zoned.date],
  ))!;
  if (state.savedToday) return { status: "ready", attempts: state.attempts, alert: null };

  const credentials = credentialsFrom(env);
  if (!credentials) {
    // Sólo si cambia: el cron pasa cada 10 minutos.
    await pool.query("update platform_settings set aws_costs_error = $1 where aws_costs_error is distinct from $1", [AWS_COSTS_ERRORS.noCredentials]);
    return { status: "no_credentials", attempts: state.attempts, alert: null };
  }

  // El intento, de una vez: la condición (otro día, o menos de 3 hoy y 3 horas desde el último) y la cuenta.
  const claimed = await one<{ attempts: number }>(
    pool,
    `update platform_settings
        set aws_costs_attempts = case when (aws_costs_attempted_at at time zone $3)::date = $2::date then aws_costs_attempts + 1 else 1 end,
            aws_costs_attempted_at = $1
      where aws_costs_attempted_at is null
         or (aws_costs_attempted_at at time zone $3)::date <> $2::date
         or (aws_costs_attempts < $4 and aws_costs_attempted_at <= $1::timestamptz - make_interval(hours => $5))
      returning aws_costs_attempts as attempts`,
    [now.toISOString(), zoned.date, DEFAULT_TIMEZONE, AWS_COSTS_MAX_ATTEMPTS, AWS_COSTS_RETRY_HOURS],
  );
  if (!claimed) return { status: "waiting", attempts: state.attempts, alert: null };

  // El mes de facturación de AWS (UTC) hasta mañana: el fin es exclusivo, así entra lo de hoy.
  const today = now.toISOString().slice(0, 10);
  const month = `${today.slice(0, 7)}-01`;
  const urls = endpoints(env);
  let reading: AwsCostReading;
  try {
    reading = await fetchMonthCosts(month, addDaysISO(today, 1), urls.costExplorer, credentials, fetchImpl);
  } catch (error) {
    const reason = error instanceof AwsCostsError ? error.message : AWS_COSTS_ERRORS.unexpected;
    await pool.query("update platform_settings set aws_costs_error = $1", [reason]);
    return { status: "failed", attempts: claimed.attempts, alert: null };
  }
  // El plan y los créditos: si falla o falta el permiso, los costos se guardan igual (la pantalla dice dónde verlos).
  const plan = await callAws(FREE_TIER, urls.freeTier, {}, credentials, fetchImpl).then(readAccountPlan, () => null);

  const alert = await transaction(async (db) => {
    await db.query(
      `insert into aws_costs (month, usage_usd, credits_usd, services, fetched_at, plan_type, plan_status, remaining_credits, plan_expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (month) do update
         set usage_usd = excluded.usage_usd, credits_usd = excluded.credits_usd, services = excluded.services,
             fetched_at = excluded.fetched_at, plan_type = excluded.plan_type, plan_status = excluded.plan_status,
             remaining_credits = excluded.remaining_credits, plan_expires_at = excluded.plan_expires_at`,
      [
        month,
        reading.usage,
        reading.credits,
        JSON.stringify(reading.services),
        now.toISOString(),
        plan?.type ?? null,
        plan?.status ?? null,
        plan?.remainingCredits ?? null,
        plan?.expiresAt ?? null,
      ],
    );
    // Salió bien: sin motivo de fallo. La fila queda bloqueada hasta terminar (el aviso, uno detrás de otro).
    const settings = (await one<{ alert: number | null; alertedMonth: ISODate | null; alertedAmount: number | null }>(
      db,
      `update platform_settings set aws_costs_error = null
        returning aws_cost_alert as alert, aws_cost_alerted_month as "alertedMonth", aws_cost_alerted_amount as "alertedAmount"`,
    ))!;
    return queueCostAlert(
      db,
      {
        month,
        usage: reading.usage,
        forecast: forecastUsage(reading.usage, month, now),
        credits: reading.credits,
        net: netOf(reading.usage, reading.credits),
      },
      settings,
    );
  });
  return { status: "saved", attempts: claimed.attempts, plan: plan !== null, alert };
}

/* ------------------------------------------------------------- La API ---- */

interface AwsCostsRow {
  alertAmount: number | null;
  alertedMonth: ISODate | null;
  alertedAmount: number | null;
  lastAttemptAt: ISODateTime | null;
  lastError: string | null;
  month: ISODate | null;
  usage: number | null;
  credits: number | null;
  services: AwsServiceCost[] | null;
  fetchedAt: ISODateTime | null;
  planType: AwsAccountPlan["type"] | null;
  planStatus: AwsAccountPlan["status"];
  remainingCredits: number | null;
  planExpiresAt: ISODateTime | null;
}

/** Lo que ve la pantalla: el último mes guardado, el último intento y el aviso. */
async function readAwsCosts(db: Db): Promise<AwsCosts> {
  const row = (await one<AwsCostsRow>(
    db,
    `select s.aws_cost_alert as "alertAmount", s.aws_cost_alerted_month as "alertedMonth", s.aws_cost_alerted_amount as "alertedAmount",
            s.aws_costs_attempted_at as "lastAttemptAt", s.aws_costs_error as "lastError",
            c.month, c.usage_usd as usage, c.credits_usd as credits, c.services, c.fetched_at as "fetchedAt",
            c.plan_type as "planType", c.plan_status as "planStatus", c.remaining_credits as "remainingCredits",
            c.plan_expires_at as "planExpiresAt"
       from platform_settings s
       left join lateral (select * from aws_costs order by month desc limit 1) c on true`,
  ))!;
  const latest =
    row.month === null || row.usage === null || row.fetchedAt === null
      ? null
      : {
          month: row.month,
          usage: row.usage,
          credits: row.credits ?? 0,
          net: netOf(row.usage, row.credits ?? 0),
          forecast: forecastUsage(row.usage, row.month, row.fetchedAt),
          services: row.services ?? [],
          plan:
            row.planType === "FREE" || row.planType === "PAID"
              ? { type: row.planType, status: row.planStatus, remainingCredits: row.remainingCredits, expiresAt: row.planExpiresAt }
              : null,
          fetchedAt: row.fetchedAt,
        };
  return {
    latest,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    alertAmount: row.alertAmount,
    alertedThisMonth: Boolean(latest && row.alertAmount !== null && row.alertedMonth === latest.month && row.alertedAmount === row.alertAmount),
  };
}

/** «$5,00» o «Sin aviso». */
const alertLabel = (amount: number | null) => (amount === null ? "Sin aviso" : formatUsdAmount(amount));

export const awsCostsService = {
  /**
   * GET /api/admin/aws-costs: cualquier super admin (con la verificación en dos pasos); los negocios, nunca.
   * Lee lo que guardó el cron: no consulta a AWS. Ver la pantalla no va a la actividad: es una consulta.
   */
  async get(ctx: RequestContext): Promise<AwsCosts> {
    authorizeSuperAdmin(ctx);
    return readAwsCosts(pool);
  },

  /**
   * PUT /api/admin/aws-costs/alert: pone, cambia o quita (null) el monto del aviso. Un monto nuevo vuelve a
   * dejar el aviso disponible este mes (la marca es por mes y por monto). Queda en la actividad de la
   * plataforma, con el antes y el después; si no cambia, no se anota nada.
   */
  async setAlert(ctx: RequestContext, input: unknown): Promise<AwsCosts> {
    const actor = authorizeSuperAdmin(ctx);
    const { amount } = parseInput(awsCostAlertSchema, input);
    await transaction(async (db) => {
      // Una sola fila: bloqueada, dos super admins a la vez van uno detrás de otro.
      const before = (await one<{ amount: number | null }>(db, "select aws_cost_alert as amount from platform_settings for update"))!.amount;
      if (before === amount) return;
      await db.query("update platform_settings set aws_cost_alert = $1", [amount]);
      await logAudit(db, {
        businessId: null,
        actor,
        action: "platform.aws_cost_alert_changed",
        entityType: "platform",
        entityId: null,
        summary:
          amount === null
            ? `Quitó el aviso de los costos de AWS (era de ${formatUsdAmount(before!)})`
            : before === null
              ? `Puso el aviso de los costos de AWS en ${formatUsdAmount(amount)}`
              : `Cambió el aviso de los costos de AWS de ${formatUsdAmount(before)} a ${formatUsdAmount(amount)}`,
        changes: [{ label: "Aviso de los costos de AWS", before: alertLabel(before), after: alertLabel(amount) }],
      });
    });
    return readAwsCosts(pool);
  },
};
