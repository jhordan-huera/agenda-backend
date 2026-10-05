/**
 * Cron de recordatorios (lo ejecuta .github/workflows/cron.yml cada 10 min). Trabaja aislado de
 * Vercel: se conecta directamente a la base de datos y a Gmail, pone en cola y envía los
 * recordatorios de citas, reintenta los correos que la API no pudo enviar al momento y limpia lo
 * caducado. Avisa por ntfy de los correos enviados o de cualquier fallo; si no hubo correos ni
 * errores, no avisa. Los registros de Actions son públicos: sólo cifras, nunca datos de clientes.
 *
 * Variables: DATABASE_URL, DATABASE_SSL, GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 * GMAIL_REFRESH_TOKEN, GMAIL_FROM_NAME, FRONTEND_URL (enlaces de los emails), NODE_ENV=production
 * (si no, los emails se redirigen a la cuenta de Gmail), NTFY_TOPIC y, opcionales, NTFY_SERVER
 * (por defecto https://ntfy.sh) y APP_URL (enlace del aviso).
 *
 * Prueba local: node --env-file=.env scripts/cron.ts
 */
import type { ScheduledTasksReport } from "../src/jobs/scheduled-tasks.ts";

interface Notice {
  title: string;
  message: string;
  /** Escala de ntfy: 2 baja (sin sonido), 3 normal, 4 alta, 5 urgente (el cron no pudo trabajar). */
  priority: 2 | 3 | 4 | 5;
  tags: string[];
}

/** Reintentos ante un fallo (p. ej. la base de datos no responde un momento). */
const RETRY_DELAYS_MS = [5_000, 20_000];
/** ntfy no muestra como texto los mensajes de más de 4096 bytes. */
const NTFY_LIMIT = 4_000;

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Qué avisar según el resumen (null: nada que contar). */
export function buildNotice(report: ScheduledTasksReport, options: { gmailConfigured?: boolean } = {}): Notice | null {
  const { emails } = report;
  const lines = [
    report.sentSinceLastRun > 0 &&
      `Enviados desde la revisión anterior: ${report.sentSinceLastRun}` +
        (report.reminders > 0 ? ` (${plural(report.reminders, "recordatorio nuevo", "recordatorios nuevos")})` : ""),
    emails.retrying > 0 && `Se reintentarán en la próxima revisión: ${emails.retrying}`,
    emails.failed > 0 && `No se enviarán (5 intentos fallidos): ${emails.failed}`,
    report.pending > 0 && `Siguen en cola: ${report.pending}`,
  ].filter(Boolean) as string[];

  if (options.gmailConfigured === false && report.pending > 0) {
    return {
      title: "Agenda360: el cron no tiene acceso a Gmail",
      message: [
        ...lines,
        "",
        "Faltan las credenciales de Gmail (GMAIL_*) en los secretos del repositorio: los recordatorios quedan en cola sin enviarse.",
      ].join("\n"),
      priority: 4,
      tags: ["warning"],
    };
  }
  if (emails.retrying > 0 || emails.failed > 0 || emails.errors.length > 0) {
    const problems = emails.failed + emails.retrying;
    return {
      title:
        problems > 0
          ? `Agenda360: ${plural(problems, "correo no se pudo enviar", "correos no se pudieron enviar")}`
          : "Agenda360: error al procesar los correos",
      message: [...lines, "", "Errores:", ...emails.errors.map((error) => `• ${error}`)].join("\n"),
      // Fallo definitivo: alta. Sólo reintentos (p. ej. Gmail caído un momento): normal.
      priority: emails.failed > 0 ? 4 : 3,
      tags: ["warning"],
    };
  }
  if (report.sentSinceLastRun > 0) {
    return {
      title: `Agenda360: ${plural(report.sentSinceLastRun, "correo enviado", "correos enviados")}`,
      message: lines.join("\n"),
      priority: 2,
      tags: ["white_check_mark"],
    };
  }
  return null;
}

/** Alerta de seguridad: cuentas con muchos intentos fallidos de inicio de sesión. */
export function buildSecurityNotice(report: ScheduledTasksReport): Notice | null {
  if (report.security.length === 0) return null;
  return {
    title: "Agenda360: posibles intentos de adivinar contraseñas",
    message: [
      ...report.security.map((alert) => `• ${alert.account}: ${alert.attempts} intentos fallidos en la última hora`),
      "",
      "Revisa Actividad → Seguridad en el panel de plataforma.",
    ].join("\n"),
    priority: 4,
    tags: ["lock"],
  };
}

async function notify(notice: Notice): Promise<void> {
  const topic = env("NTFY_TOPIC");
  // Sólo el título: el registro de Actions es público y el mensaje puede llevar cuentas.
  console.info(`[ntfy] ${notice.title}`);
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

/** El cron no pudo trabajar: aviso urgente y el job de GitHub termina con error. */
async function fail(reason: string): Promise<void> {
  await notify({
    title: "Agenda360: el cron de correos falló",
    message: `${reason}\n\nLos recordatorios y correos pendientes se intentarán en la próxima ejecución.`,
    priority: 5,
    tags: ["rotating_light"],
  });
  process.exitCode = 1;
}

async function main(): Promise<void> {
  if (!env("DATABASE_URL")) return fail("Falta DATABASE_URL (secreto del repositorio en GitHub).");

  // Se cargan aquí y no arriba: validan la configuración al importarse (las pruebas sólo usan buildNotice).
  const { config } = await import("../src/config.ts");
  const { pool } = await import("../src/db/pool.ts");
  const { disableImmediateDelivery } = await import("../src/services/mailer.ts");
  const { runScheduledTasks } = await import("../src/jobs/scheduled-tasks.ts");
  // Este proceso envía él mismo, al final, lo que pone en cola.
  disableImmediateDelivery();
  if (!config.isProduction) console.warn(`NODE_ENV=${config.env}: los emails se redirigen a ${config.emailRedirectTo ?? "(nadie)"}.`);

  try {
    let report: ScheduledTasksReport;
    for (let attempt = 0; ; attempt++) {
      try {
        report = await runScheduledTasks();
        break;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return await fail(`No se pudo completar: ${reason}`);
        console.warn(`Fallo: ${reason}. Reintento en ${delay / 1000} s…`);
        await sleep(delay);
      }
    }

    console.info(
      `Recordatorios: ${report.reminders} · enviados desde la anterior: ${report.sentSinceLastRun} · ` +
        `reintentos: ${report.emails.retrying} · fallidos: ${report.emails.failed} · en cola: ${report.pending} · ` +
        `alertas de seguridad: ${report.security.length} · auditoría depurada: ${report.auditPurged} · ${report.durationMs} ms`,
    );
    const notices = [buildNotice(report, { gmailConfigured: Boolean(config.gmail) }), buildSecurityNotice(report)].filter(
      (notice) => notice !== null,
    );
    for (const notice of notices) await notify(notice);
    if (notices.length === 0) console.info("Sin correos, errores ni alertas: no se envía aviso.");
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// Sólo al ejecutarlo como script (las pruebas importan buildNotice).
if (import.meta.main) await main();
