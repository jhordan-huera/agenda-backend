/**
 * Cron de recordatorios (lo ejecuta .github/workflows/cron.yml cada 10 min). Trabaja aislado de
 * Vercel: se conecta directamente a la base de datos y a Gmail, pone en cola y envía los
 * recordatorios de citas, reintenta los correos que la API no pudo enviar al momento y limpia lo
 * caducado. Avisa por ntfy de los correos enviados o de cualquier fallo; si no hubo correos ni
 * errores, no avisa. Los registros de Actions son públicos: sólo cifras, nunca datos de clientes.
 * Los avisos de ntfy dicen a quién salió cada correo, a medias (decisión del usuario, 2026-10-12):
 * "Juan P." y "ju***@gmail.com", con la copia al profesional en la misma línea (ver masking.ts).
 *
 * Variables: DATABASE_URL, DATABASE_SSL, GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 * GMAIL_REFRESH_TOKEN, GMAIL_FROM_NAME, FRONTEND_URL (enlaces de los emails), NODE_ENV=production
 * (si no, los emails se redirigen a la cuenta de Gmail), NTFY_TOPIC y, opcionales, NTFY_SERVER
 * (por defecto https://ntfy.sh), APP_URL (enlace del aviso) y SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY (sin ellas no se borran los comprobantes de más de 3 meses). Avisos en el
 * celular (spec 013): VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (sin ellas no se envían: quedan en cola y
 * caducan) y, opcional, VAPID_SUBJECT. Las campanas del panel (spec 014) no necesitan nada más. El cupo
 * de Gmail (spec 015), opcional: EMAIL_DAILY_QUOTA, EMAIL_TEAM_RESERVE y EMAIL_PATIENT_RESERVE, los
 * mismos valores que la API. La analítica del super admin (spec 016) se prepara aquí cada mañana, sin
 * variables nuevas. El aviso de la mañana y el aviso al super admin de los recordatorios enviados (spec
 * 021), tampoco. La foto diaria del tamaño de la base (spec 024), tampoco. Las invitaciones de calendario
 * de las citas que entran en la ventana de 14 días (spec 027), tampoco: salen con la misma cuenta de Gmail.
 * El cobro de las mensualidades (spec 029: el cobro de cada mes, el email de los tres días antes, el aviso
 * de cada comprobante y el borrado de los de más de 12 meses), tampoco.
 *
 * Prueba local, sólo contra la base de `npm run dev:local` (puerto 54329). NUNCA con --env-file=.env: la
 * DATABASE_URL de .env es la de PRODUCCIÓN, y la pasada entera (recordatorios, mensualidades, limpiezas)
 * sería real. `env -i` empieza sin ninguna variable, así que tampoco lee .env ni Gmail: lo que ponga en cola
 * lo envía el servidor de dev:local (su invitación de calendario sale con el organizador de prueba
 * avisos@agenda360.invalid; para probarlas basta el servidor de dev:local, que ya hace ese paso):
 *
 *   env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development DATABASE_URL=postgresql://postgres@127.0.0.1:54329/agenda FRONTEND_URL=http://localhost:5173 node scripts/cron.ts
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
  appointment_pending: ["Cita pendiente de confirmar", "Citas pendientes de confirmar"],
  appointment_completed: ["Gracias por la visita", "Gracias por la visita"],
  appointment_no_show: ["Aviso de No asistió", "Avisos de No asistió"],
  appointment_series: ["Serie de citas", "Series de citas"],
  appointment_series_cancelled: ["Serie de citas cancelada", "Series de citas canceladas"],
  booking_received: ["Aviso de nueva reserva (al negocio)", "Avisos de nueva reserva (al negocio)"],
  professional_new_appointment: ["Aviso de cita nueva (al profesional)", "Avisos de cita nueva (al profesional)"],
  appointment_copy: ["Copia al profesional", "Copias al profesional"],
  calendar_invite: ["Invitación de calendario (al profesional)", "Invitaciones de calendario (al profesional)"],
  billing_reminder: ["Recordatorio de la mensualidad (al propietario)", "Recordatorios de la mensualidad (al propietario)"],
  billing_paid: ["Mensualidad pagada (al propietario)", "Mensualidades pagadas (al propietario)"],
  billing_rejected: ["Comprobante de mensualidad rechazado (al propietario)", "Comprobantes de mensualidad rechazados (al propietario)"],
  billing_voided: ["Cobro de mensualidad anulado (al propietario)", "Cobros de mensualidad anulados (al propietario)"],
  professional_daily_agenda: ["Agenda del día (al profesional)", "Agendas del día (al profesional)"],
  payment_receipt_received: ["Comprobante de pago (al negocio)", "Comprobantes de pago (al negocio)"],
  patient_cancelled: ["Aviso de cancelación del paciente (al negocio)", "Avisos de cancelación del paciente (al negocio)"],
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
  account_security_changed: ["Cambio de seguridad de una cuenta", "Cambios de seguridad de cuentas"],
};

/** "mar 7 oct 10:00" */
const when = (email: SentEmail) => (email.date ? `${formatShortDate(email.date)}${email.startTime ? ` ${email.startTime}` : ""}` : null);

/** Emails al paciente sobre su cita: los que llevan copia al profesional (ver notifications.ts). */
const COPIED_TYPES = new Set<EmailType>([
  "booking_created",
  "appointment_confirmed",
  "appointment_updated",
  "appointment_cancelled",
  "appointment_series",
  "appointment_series_cancelled",
]);

/**
 * Una línea por email: de qué negocio, de qué cita (cuándo y de quién) y a quién salió, con la copia
 * al profesional si la hubo: "• Mente Abierta · mar 14 oct 16:30 · Juan P. → ju***@gmail.com · copia: pr***@gmail.com".
 */
function describeEmail(email: SentEmail, copies: string[] = []): string {
  const appointment = when(email);
  const detail =
    email.type === "booking_received" && appointment
      ? `reserva${email.clientName ? ` de ${email.clientName}` : ""} para el ${appointment}`
      : [appointment, email.clientName].filter(Boolean).join(" · ");
  const about = [email.businessName, detail].filter(Boolean).join(" · ");
  const copy = copies.length > 0 ? ` · copia: ${copies.join(", ")}` : "";
  return `• ${about ? `${about} → ` : ""}${email.to}${copy}`;
}

/**
 * Los emails enviados agrupados por tipo ("Recordatorios de cita · 3" y uno por línea). Cada copia al
 * profesional va en la línea del email al paciente del que es copia (el siguiente de la misma cita);
 * sólo las que salieron sin él en esta tanda van aparte. Si hubo más de los que trae el detalle, se
 * dice cuántos faltan.
 */
export function describeSentEmails(sent: SentEmail[], total: number): string[] {
  const pendingCopies = new Map<string, SentEmail[]>();
  for (const email of sent) {
    if (email.type !== "appointment_copy" || !email.appointmentId) continue;
    pendingCopies.set(email.appointmentId, [...(pendingCopies.get(email.appointmentId) ?? []), email]);
  }
  const copiesOf = new Map<SentEmail, string[]>();
  const paired = new Set<SentEmail>();
  for (const email of sent) {
    if (!COPIED_TYPES.has(email.type) || !email.appointmentId) continue;
    const copy = pendingCopies.get(email.appointmentId)?.shift();
    if (!copy) continue;
    copiesOf.set(email, [copy.to]);
    paired.add(copy);
  }

  const groups = new Map<EmailType, SentEmail[]>();
  for (const type of Object.keys(EMAIL_GROUPS) as EmailType[]) {
    const ofType = sent.filter((email) => email.type === type && !paired.has(email));
    if (ofType.length > 0) groups.set(type, ofType);
  }
  const lines: string[] = [];
  for (const [type, ofType] of groups) {
    const [one, many] = EMAIL_GROUPS[type];
    if (lines.length > 0) lines.push("");
    lines.push(`${ofType.length === 1 ? one : many} · ${ofType.length}`, ...ofType.map((email) => describeEmail(email, copiesOf.get(email))));
  }
  if (total > sent.length) lines.push("", `…y ${total - sent.length} más (detalle en el panel: Actividad → Emails).`);
  return lines;
}

/** Qué avisar según el resumen (null: nada que contar). */
export function buildNotice(report: ScheduledTasksReport, options: { gmailConfigured?: boolean } = {}): Notice | null {
  const { emails } = report;
  const businessFailures = report.reminderFailures ?? 0;
  const sentDetail = describeSentEmails(report.sentEmails ?? [], report.sentSinceLastRun);
  const lines = [
    emails.retrying > 0 && `Se reintentarán más tarde (la espera crece con cada fallo): ${emails.retrying}`,
    emails.failed > 0 && `No se enviarán (agotaron los reintentos): ${emails.failed}`,
    report.pending > 0 && `Siguen en cola: ${report.pending}`,
    // Spec 015: el cupo diario de Gmail se llenó; salen en cuanto haya cupo (el aviso del cupo lo da la API una vez al día).
    (emails.waiting ?? 0) > 0 && `Esperan el cupo diario de Gmail: ${emails.waiting} (salen en cuanto haya cupo, sin perderse)`,
    businessFailures > 0 &&
      `${plural(businessFailures, "negocio", "negocios")} con error al preparar los recordatorios (detalle en el registro de Actions); los demás siguieron`,
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
  if (emails.retrying > 0 || emails.failed > 0 || emails.errors.length > 0 || businessFailures > 0) {
    const problems = emails.failed + emails.retrying;
    return {
      title:
        problems > 0
          ? `Agenda360: ${plural(problems, "correo no se pudo enviar", "correos no se pudieron enviar")}`
          : emails.errors.length > 0
            ? "Agenda360: error al procesar los correos"
            : "Agenda360: error al preparar los recordatorios",
      message: [
        ...lines,
        ...(emails.errors.length > 0 ? ["", "Errores:", ...emails.errors.map((error) => `• ${error}`)] : []),
        ...(sentDetail.length > 0 ? ["", `Sí se enviaron (${report.sentSinceLastRun}):`, "", ...sentDetail] : []),
      ].join("\n"),
      // Fallo definitivo o un negocio sin recordatorios: alta. Sólo reintentos (p. ej. Gmail caído un momento): normal.
      priority: emails.failed > 0 || businessFailures > 0 ? 4 : 3,
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

/**
 * Un aviso por cada reserva desde la página pública, cada cita y cada serie de citas agendada desde el
 * panel, cada serie cancelada, cada paciente registrado desde el panel y cada importación de pacientes
 * (ver booking-alerts.ts) y, si hubo más de los que se detallan, otro con cuántos faltan.
 */
export function buildBookingNotices(report: ScheduledTasksReport): Notice[] {
  const notices: Notice[] = [...(report.bookingNotices ?? [])];
  const rest = (report.onlineBookings ?? 0) - notices.length;
  if (rest > 0) {
    notices.push({
      title: "Agenda360: más reservas",
      message: `…y ${plural(rest, "reserva más", "reservas más")} por la página (detalle en el panel de cada negocio).`,
      priority: 3,
      tags: ["calendar"],
      click: "/admin/businesses",
    });
  }
  const appointmentNotices = report.appointmentNotices ?? [];
  notices.push(...appointmentNotices);
  const restAppointments = (report.panelAppointments ?? 0) - appointmentNotices.length;
  if (restAppointments > 0) {
    notices.push({
      title: "Agenda360: más citas",
      message: `…y ${plural(restAppointments, "cita más", "citas más")} agendadas desde el panel (detalle en la agenda de cada negocio).`,
      priority: 3,
      tags: ["date"],
      click: "/admin/businesses",
    });
  }
  const seriesNotices = report.seriesNotices ?? [];
  notices.push(...seriesNotices);
  const restSeries = (report.panelSeries ?? 0) - seriesNotices.length;
  if (restSeries > 0) {
    notices.push({
      title: "Agenda360: más series de citas",
      message: `…y ${plural(restSeries, "serie más", "series más")} de citas agendadas desde el panel (detalle en la agenda de cada negocio).`,
      priority: 3,
      tags: ["repeat"],
      click: "/admin/businesses",
    });
  }
  const statusNotices = report.statusNotices ?? [];
  notices.push(...statusNotices);
  const restStatus = (report.statusChanges ?? 0) - statusNotices.length;
  if (restStatus > 0) {
    notices.push({
      title: "Agenda360: más cambios de estado",
      message: `…y ${plural(restStatus, "cambio de estado más", "cambios de estado más")} en citas (detalle en la actividad de cada negocio).`,
      priority: 3,
      tags: ["arrows_counterclockwise"],
      click: "/admin/activity",
    });
  }
  const seriesCancelNotices = report.seriesCancelNotices ?? [];
  notices.push(...seriesCancelNotices);
  const restCancelled = (report.seriesCancellations ?? 0) - seriesCancelNotices.length;
  if (restCancelled > 0) {
    notices.push({
      title: "Agenda360: más series canceladas",
      message: `…y ${plural(restCancelled, "serie cancelada más", "series canceladas más")} desde el panel (detalle en la actividad de cada negocio).`,
      priority: 3,
      tags: ["arrows_counterclockwise"],
      click: "/admin/activity",
    });
  }
  const clientNotices = report.clientNotices ?? [];
  notices.push(...clientNotices);
  const restClients = (report.panelClients ?? 0) - clientNotices.length;
  if (restClients > 0) {
    notices.push({
      title: "Agenda360: más pacientes nuevos",
      message: `…y ${plural(restClients, "paciente nuevo más", "pacientes nuevos más")} registrados desde el panel (detalle en cada negocio).`,
      priority: 3,
      tags: ["bust_in_silhouette"],
      click: "/admin/businesses",
    });
  }
  const importNotices = report.importNotices ?? [];
  notices.push(...importNotices);
  const restImports = (report.clientImports ?? 0) - importNotices.length;
  if (restImports > 0) {
    notices.push({
      title: "Agenda360: más importaciones",
      message: `…y ${plural(restImports, "importación más", "importaciones más")} de pacientes (detalle en la actividad de cada negocio).`,
      priority: 3,
      tags: ["inbox_tray"],
      click: "/admin/businesses",
    });
  }
  // Los comprobantes de mensualidades (spec 029): uno por comprobante, con el negocio y el monto.
  const billingNotices = report.billingReceiptNotices ?? [];
  notices.push(...billingNotices);
  const restBilling = (report.billing?.receipts ?? 0) - billingNotices.length;
  if (restBilling > 0) {
    notices.push({
      title: "Agenda360: más comprobantes de mensualidades",
      message: `…y ${plural(restBilling, "comprobante más", "comprobantes más")} de mensualidades por revisar (detalle en Cobros).`,
      priority: 3,
      tags: ["receipt"],
      click: "/admin/billing",
    });
  }
  return notices;
}

/**
 * Un aviso por cada cambio de seguridad en una cuenta de super admin (verificación en dos pasos o
 * contraseña, spec 009) y, si hubo más de los que se detallan, otro con cuántos faltan.
 */
export function buildAccountNotices(report: ScheduledTasksReport): Notice[] {
  const notices: Notice[] = [...(report.accountNotices ?? [])];
  const rest = (report.accountChanges ?? 0) - notices.length;
  if (rest > 0) {
    notices.push({
      title: "Agenda360: más cambios en cuentas de super admin",
      message: `…y ${plural(rest, "cambio más", "cambios más")} de seguridad en cuentas de super admin (detalle en Actividad → Seguridad).`,
      priority: 4,
      tags: ["key"],
      click: "/admin/activity",
    });
  }
  return notices;
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

/**
 * Avisos en el celular (spec 013): si en esta pasada fallaron avisos y no salió ninguno (p. ej. las
 * claves VAPID mal puestas), ntfy lo dice. Sólo el servicio y el código de respuesta, nunca un aviso.
 */
export function buildPushNotice(report: ScheduledTasksReport): Notice | null {
  const push = report.push;
  if (!push || push.failed === 0 || push.sent > 0) return null;
  const detail = push.errors.length > 0 ? ` (servicio: ${push.errors.join("; ")})` : "";
  return {
    title: "Agenda360: los avisos en la app no salen",
    message: `Fallaron ${plural(push.failed, "aviso", "avisos")} en esta pasada${detail}. Revisa las claves VAPID en Vercel, Lambda y GitHub.`,
    priority: 4,
    tags: ["warning"],
    click: "/admin/activity",
  };
}

/**
 * Recordatorios de citas por cerrar enviados (spec 021): a qué negocios salió en esta pasada el resumen de
 * la mañana o el de las 8, con sus cifras. Los nombres de los negocios sólo van en el mensaje (a ntfy); el
 * título, que queda en el registro público de Actions, no nombra ninguno.
 */
export function buildRemindersNotice(report: ScheduledTasksReport): Notice | null {
  const sent = report.push?.reminders ?? [];
  if (sent.length === 0) return null;
  return {
    title: "Agenda360: recordatorios de citas por cerrar enviados",
    message: sent.map((batch) => batch.body).join("\n"),
    priority: 2,
    tags: ["bell"],
    click: "/admin/businesses",
  };
}

/**
 * "· avisos de la mañana: N · recordatorios: mañana N negocios · noche N negocios" (spec 021). Sólo cifras:
 * el registro es público.
 */
export function describeRemindersLine(report: ScheduledTasksReport): string {
  if (!report.push) return "";
  const businesses = (batch: "morning" | "evening") =>
    plural(report.push?.reminders?.find((sent) => sent.batch === batch)?.businesses ?? 0, "negocio", "negocios");
  return ` · avisos de la mañana: ${report.push.morning ?? 0} · recordatorios: mañana ${businesses("morning")} · noche ${businesses("evening")}`;
}

/** "· avisos en la app: enviados N · fallidos N · aparatos dados de baja N" (sólo cifras: el registro es público). */
export function describePushLine(report: ScheduledTasksReport, problem: string | null = null): string {
  if (!report.push) return "";
  const { sent, failed, removedDevices } = report.push;
  return ` · avisos en la app: enviados ${sent} · fallidos ${failed} · aparatos dados de baja ${removedDevices}${problem ? ` (${problem})` : ""}`;
}

/**
 * "· mensualidades: cobros N · recordatorios N · comprobantes N (borrados, más de 12 meses: N)" (spec 029).
 * Sólo cifras: el registro es público.
 */
export function describeBillingLine(report: ScheduledTasksReport): string {
  if (!report.billing) return "";
  const { charges, reminders, receipts, receiptsPurged } = report.billing;
  return ` · mensualidades: cobros ${charges} · recordatorios ${reminders} · comprobantes ${receipts} (borrados, más de 12 meses: ${
    receiptsPurged ?? "sin almacenamiento"
  })`;
}

/**
 * "· avisos del panel: N (borrados, más de 30 días: N)": lo que guardó esta pasada en las campanas del
 * panel (spec 014). Sólo cifras: el registro es público.
 */
export function describePanelLine(report: ScheduledTasksReport): string {
  if (!report.panelNotices) return "";
  const { created, purged } = report.panelNotices;
  return ` · avisos del panel: ${created} (borrados, más de 30 días: ${purged ?? "no se pudo"})`;
}

/**
 * "· analítica: preparada (N negocios)": la foto diaria del super admin (spec 016). Sólo cifras: el
 * registro es público.
 */
export function describeAnalyticsLine(report: ScheduledTasksReport): string {
  if (!report.analytics) return "";
  const { status, businesses } = report.analytics;
  const detail =
    status === "prepared"
      ? `preparada (${plural(businesses ?? 0, "negocio", "negocios")})`
      : status === "ready"
        ? "ya estaba la de hoy"
        : status === "early"
          ? "se prepara después de las 06:00"
          : "falló (se reintenta en la próxima pasada)";
  return ` · analítica: ${detail}`;
}

/**
 * "· base de datos: foto guardada (16,2 MB)": la foto diaria del tamaño de la base (spec 024). Sólo la
 * cifra: el registro es público.
 */
export function describeDatabaseLine(report: ScheduledTasksReport): string {
  if (!report.databaseStats) return "";
  const { status, sizeBytes } = report.databaseStats;
  const detail =
    status === "saved"
      ? `foto guardada (${((sizeBytes ?? 0) / 1024 / 1024).toFixed(1).replace(".", ",")} MB)`
      : status === "ready"
        ? "ya estaba la de hoy"
        : status === "early"
          ? "se guarda después de las 06:00"
          : "falló (se reintenta en la próxima pasada)";
  return ` · base de datos: ${detail}`;
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
  const { disableImmediateDelivery, scrubEmails } = await import("../src/services/mailer.ts");
  const { disableImmediatePushDelivery } = await import("../src/services/push-delivery.ts");
  const { runScheduledTasks, EMAIL_CONTENT_DAYS } = await import("../src/jobs/scheduled-tasks.ts");
  // Este proceso envía él mismo, al final, lo que pone en cola (emails y avisos en el celular).
  disableImmediateDelivery();
  disableImmediatePushDelivery();
  if (!config.isProduction) console.warn(`NODE_ENV=${config.env}: los emails se redirigen a ${config.emailRedirectTo ?? "(nadie)"}.`);

  try {
    let report: ScheduledTasksReport;
    for (let attempt = 0; ; attempt++) {
      try {
        report = await runScheduledTasks();
        break;
      } catch (error) {
        // Sin direcciones de email: el registro de Actions es público y el aviso va a ntfy.
        const reason = scrubEmails(error instanceof Error ? error.message : String(error));
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return await fail(`No se pudo completar: ${reason}`);
        console.warn(`Fallo: ${reason}. Reintento en ${delay / 1000} s…`);
        await sleep(delay);
      }
    }

    console.info(
      `Recordatorios: ${report.reminders} · invitaciones de calendario: ${report.calendarInvites ?? 0} · ` +
        `reservas por la página: ${report.onlineBookings ?? 0} · ` +
        `pacientes nuevos del panel: ${report.panelClients ?? 0} · citas del panel: ${report.panelAppointments ?? 0} · ` +
        `series del panel: ${report.panelSeries ?? 0} · series canceladas: ${report.seriesCancellations ?? 0} · ` +
        `cambios de estado: ${report.statusChanges ?? 0} · cambios de cuenta: ${report.accountChanges ?? 0} · ` +
        `importaciones: ${report.clientImports ?? 0} · ` +
        `enviados desde la anterior: ${report.sentSinceLastRun} · ` +
        `negocios con error: ${report.reminderFailures} · ` +
        `reintentos: ${report.emails.retrying} · fallidos: ${report.emails.failed} · en cola: ${report.pending} · ` +
        `esperan el cupo de Gmail: ${report.emails.waiting ?? 0} · ` +
        `alertas de seguridad: ${report.security.length} · auditoría depurada: ${report.auditPurged} · ` +
        `emails sin contenido (más de ${EMAIL_CONTENT_DAYS} días): ${report.emailContentPurged} · ` +
        `comprobantes borrados (más de 3 meses): ${report.receiptsPurged ?? "sin almacenamiento"}` +
        `${describeBillingLine(report)}` +
        `${describePanelLine(report)}` +
        `${describePushLine(report, config.webPushProblem ? `sin envío: ${config.webPushProblem}` : null)}` +
        `${describeRemindersLine(report)}` +
        `${describeDatabaseLine(report)}` +
        `${describeAnalyticsLine(report)} · ${report.durationMs} ms`,
    );
    const notices = [
      ...buildBookingNotices(report),
      buildNotice(report, { gmailConfigured: Boolean(config.gmail) }),
      buildSecurityNotice(report),
      ...buildAccountNotices(report),
      buildPushNotice(report),
      buildRemindersNotice(report),
    ].filter((notice) => notice !== null);
    for (const notice of notices) await notify(notice);
    if (notices.length === 0) console.info("Sin correos, errores ni alertas: no se envía aviso.");
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// Sólo al ejecutarlo como script (las pruebas importan buildNotice).
if (import.meta.main) await main();
