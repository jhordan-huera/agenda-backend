/**
 * Cliente del cron (lo ejecuta .github/workflows/cron.yml cada 10 min): llama a POST /api/cron/run de la
 * API en Vercel y avisa por ntfy de los correos enviados o de cualquier fallo. Si no hubo
 * correos ni errores, no avisa.
 *
 * Variables: API_URL (p. ej. https://agenda-backend.vercel.app), CRON_SECRET, NTFY_TOPIC y,
 * opcionales, NTFY_SERVER (por defecto https://ntfy.sh) y APP_URL (enlace del aviso).
 *
 * Prueba local: API_URL=http://localhost:4000 CRON_SECRET=… NTFY_TOPIC=… node scripts/cron.ts
 */

interface EmailQueueReport {
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
  errors: string[];
}

interface CronReport {
  reminders: number;
  emails: EmailQueueReport;
  sentSinceLastRun: number;
  since: string | null;
  pending: number;
  durationMs: number;
}

interface Notice {
  title: string;
  message: string;
  /** Escala de ntfy: 2 baja (sin sonido), 3 normal, 4 alta, 5 urgente (la API no responde). */
  priority: 2 | 3 | 4 | 5;
  tags: string[];
}

const REQUEST_TIMEOUT_MS = 120_000;
/** Reintentos ante errores de red o 5xx (arranque en frío, base de datos ocupada). */
const RETRY_DELAYS_MS = [5_000, 20_000];
/** ntfy no muestra como texto los mensajes de más de 4096 bytes. */
const NTFY_LIMIT = 4_000;

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

class CronError extends Error {}

async function callApi(apiUrl: string, secret: string): Promise<CronReport> {
  const url = `${apiUrl.replace(/\/+$/, "")}/api/cron/run`;
  for (let attempt = 0; ; attempt++) {
    let failure: string;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      if (response.ok) return JSON.parse(text) as CronReport;
      failure = `La API respondió ${response.status}: ${text.slice(0, 300)}`;
      // 4xx (secreto incorrecto, ruta desactivada): reintentar no lo arregla.
      if (response.status < 500) throw new CronError(failure);
    } catch (error) {
      if (error instanceof CronError) throw error;
      failure = `No se pudo conectar con la API: ${error instanceof Error ? error.message : String(error)}`;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) throw new CronError(failure);
    console.warn(`${failure}. Reintento en ${delay / 1000} s…`);
    await sleep(delay);
  }
}

/** Qué avisar según el resumen (null: nada que contar). */
export function buildNotice(report: CronReport): Notice | null {
  const { emails } = report;
  const lines = [
    report.sentSinceLastRun > 0 &&
      `Enviados desde la revisión anterior: ${report.sentSinceLastRun}` +
        (report.reminders > 0 ? ` (${plural(report.reminders, "recordatorio nuevo", "recordatorios nuevos")})` : ""),
    emails.retrying > 0 && `Se reintentarán en la próxima revisión: ${emails.retrying}`,
    emails.failed > 0 && `No se enviarán (5 intentos fallidos): ${emails.failed}`,
    report.pending > 0 && `Siguen en cola: ${report.pending}`,
  ].filter(Boolean) as string[];

  if (emails.retrying > 0 || emails.failed > 0 || emails.errors.length > 0) {
    const problems = emails.failed + emails.retrying;
    return {
      title:
        problems > 0
          ? `Agendo: ${plural(problems, "correo no se pudo enviar", "correos no se pudieron enviar")}`
          : "Agendo: error al procesar los correos",
      message: [...lines, "", "Errores:", ...emails.errors.map((error) => `• ${error}`)].join("\n"),
      // Fallo definitivo: alta. Sólo reintentos (p. ej. Gmail caído un momento): normal.
      priority: emails.failed > 0 ? 4 : 3,
      tags: ["warning"],
    };
  }
  if (report.sentSinceLastRun > 0) {
    return {
      title: `Agendo: ${plural(report.sentSinceLastRun, "correo enviado", "correos enviados")}`,
      message: lines.join("\n"),
      priority: 2,
      tags: ["white_check_mark"],
    };
  }
  return null;
}

async function notify(notice: Notice): Promise<void> {
  const topic = env("NTFY_TOPIC");
  console.info(`[ntfy] ${notice.title}\n${notice.message}`);
  if (!topic) {
    console.warn("Sin NTFY_TOPIC: el aviso sólo queda en este registro.");
    return;
  }
  const server = (env("NTFY_SERVER") ?? "https://ntfy.sh").replace(/\/+$/, "");
  const appUrl = env("APP_URL");
  const message =
    Buffer.byteLength(notice.message) <= NTFY_LIMIT
      ? notice.message
      : Buffer.from(notice.message).subarray(0, NTFY_LIMIT - 10).toString().replace(/�+$/, "") + "\n…";
  const response = await fetch(`${server}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      title: notice.title,
      message,
      priority: notice.priority,
      tags: notice.tags,
      ...(appUrl ? { click: `${appUrl.replace(/\/+$/, "")}/admin` } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ntfy respondió ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function main(): Promise<void> {
  const apiUrl = env("API_URL");
  const secret = env("CRON_SECRET");
  if (!apiUrl || !secret) {
    console.error("Faltan API_URL o CRON_SECRET (variables del repositorio en GitHub).");
    process.exitCode = 1;
    return;
  }

  let report: CronReport;
  try {
    report = await callApi(apiUrl, secret);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await notify({
      title: "Agendo: el cron de correos falló",
      message: `${reason}\n\nLos correos y recordatorios pendientes se intentarán en la próxima ejecución.`,
      priority: 5,
      tags: ["rotating_light"],
    });
    process.exitCode = 1;
    return;
  }

  // Los registros de Actions son públicos: sólo cifras, nunca datos de clientes.
  console.info(
    `Recordatorios: ${report.reminders} · enviados desde la anterior: ${report.sentSinceLastRun} · ` +
      `reintentos: ${report.emails.retrying} · fallidos: ${report.emails.failed} · en cola: ${report.pending} · ${report.durationMs} ms`,
  );
  const notice = buildNotice(report);
  if (notice) await notify(notice);
  else console.info("Sin correos ni errores: no se envía aviso.");
}

// Sólo al ejecutarlo como script (las pruebas importan buildNotice).
if (import.meta.main) await main();
