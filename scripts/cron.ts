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
import type { ScheduledTasksReport, SentEmail } from "../src/jobs/scheduled-tasks.ts";
import { formatShortDate } from "../src/shared/lib/format.ts";
import type { EmailType } from "../src/shared/types/index.ts";
import { env, notify, type Notice } from "./notify.ts";

/** Reintentos ante un fallo (p. ej. la base de datos no responde un momento). */
const RETRY_DELAYS_MS = [5_000, 20_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Grupos del aviso, en este orden: primero lo de las citas. [singular, plural] */
const EMAIL_GROUPS: Record<EmailType, [string, string]> = {
  appointment_reminder: ["Recordatorio de cita", "Recordatorios de cita"],
  booking_created: ["Reserva recibida (al cliente, pendiente de confirmar)", "Reservas recibidas (al cliente, pendientes de confirmar)"],
  appointment_confirmed: ["Cita confirmada", "Citas confirmadas"],
  appointment_updated: ["Cita modificada", "Citas modificadas"],
  appointment_cancelled: ["Cita cancelada", "Citas canceladas"],
  booking_received: ["Aviso de nueva reserva (al negocio)", "Avisos de nueva reserva (al negocio)"],
  professional_new_appointment: ["Aviso de cita nueva (al profesional)", "Avisos de cita nueva (al profesional)"],
  professional_daily_agenda: ["Agenda del día (al profesional)", "Agendas del día (al profesional)"],
  business_created: ["Negocio creado", "Negocios creados"],
  team_invite: ["Alta en un equipo", "Altas en un equipo"],
  password_reset: ["Contraseña cambiada", "Contraseñas cambiadas"],
  welcome: ["Bienvenida", "Bienvenidas"],
  business_suspended: ["Negocio suspendido", "Negocios suspendidos"],
  business_reactivated: ["Negocio reactivado", "Negocios reactivados"],
  plan_change_requested: ["Solicitud de cambio de plan", "Solicitudes de cambio de plan"],
  plan_change_approved: ["Cambio de plan aprobado", "Cambios de plan aprobados"],
  plan_changed: ["Cambio de plan", "Cambios de plan"],
  plan_change_rejected: ["Cambio de plan rechazado", "Cambios de plan rechazados"],
  platform_admin_added: ["Alta de super admin", "Altas de super admin"],
};

/** "mar 7 oct 10:00" */
const when = (email: SentEmail) => (email.date ? `${formatShortDate(email.date)}${email.startTime ? ` ${email.startTime}` : ""}` : null);

/** Una línea por email: a quién (nombre abreviado y email enmascarado), de qué negocio y la cita. */
function describeEmail(email: SentEmail): string {
  const appointment = when(email);
  if (email.type === "booking_received") {
    const booking = email.clientName ? `reserva de ${email.clientName}${appointment ? ` para el ${appointment}` : ""}` : null;
    return `• ${[email.businessName ?? email.to, booking].filter(Boolean).join(" · ")} (${email.to})`;
  }
  const recipient = email.clientName ? `${email.clientName} (${email.to})` : email.to;
  return `• ${[recipient, appointment, email.businessName].filter(Boolean).join(" · ")}`;
}

/**
 * Los emails enviados agrupados por tipo ("Recordatorios de cita · 3" y uno por línea). Si hubo
 * más de los que trae el detalle, se dice cuántos faltan.
 */
export function describeSentEmails(sent: SentEmail[], total: number): string[] {
  const groups = new Map<EmailType, SentEmail[]>();
  for (const type of Object.keys(EMAIL_GROUPS) as EmailType[]) {
    const ofType = sent.filter((email) => email.type === type);
    if (ofType.length > 0) groups.set(type, ofType);
  }
  const lines: string[] = [];
  for (const [type, ofType] of groups) {
    const [one, many] = EMAIL_GROUPS[type];
    if (lines.length > 0) lines.push("");
    lines.push(`${ofType.length === 1 ? one : many} · ${ofType.length}`, ...ofType.map(describeEmail));
  }
  if (total > sent.length) lines.push("", `…y ${total - sent.length} más (detalle en el panel: Actividad → Emails).`);
  return lines;
}

/** Qué avisar según el resumen (null: nada que contar). */
export function buildNotice(report: ScheduledTasksReport, options: { gmailConfigured?: boolean } = {}): Notice | null {
  const { emails } = report;
  const sentDetail = describeSentEmails(report.sentEmails ?? [], report.sentSinceLastRun);
  const lines = [
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
      message: [
        ...lines,
        "",
        "Errores:",
        ...emails.errors.map((error) => `• ${error}`),
        ...(sentDetail.length > 0 ? ["", `Sí se enviaron (${report.sentSinceLastRun}):`, "", ...sentDetail] : []),
      ].join("\n"),
      // Fallo definitivo: alta. Sólo reintentos (p. ej. Gmail caído un momento): normal.
      priority: emails.failed > 0 ? 4 : 3,
      tags: ["warning"],
      click: "/admin/activity",
    };
  }
  if (report.sentSinceLastRun > 0) {
    return {
      title: `Agenda360: ${plural(report.sentSinceLastRun, "correo enviado", "correos enviados")}`,
      message: [...sentDetail, ...(lines.length > 0 ? ["", ...lines] : [])].join("\n"),
      priority: 2,
      tags: ["white_check_mark"],
      click: "/admin/activity",
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
        `alertas de seguridad: ${report.security.length} · auditoría depurada: ${report.auditPurged} · ` +
        `emails sin contenido (más de 90 días): ${report.emailContentPurged} · ${report.durationMs} ms`,
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
