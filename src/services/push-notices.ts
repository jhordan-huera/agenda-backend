import { many, one, pool, type Db } from "../db/pool.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { EVENING_SUMMARY_HOUR, UNCLOSED_AFTER_MINUTES } from "../shared/lib/constants/push.ts";
import { capitalize, formatShortDate, joinNames, plural } from "../shared/lib/format.ts";
import { addDaysISO, getZonedNow } from "../shared/lib/time.ts";
import type { Appointment, AppointmentStatus, Business, ISODate, TimeString } from "../shared/types/index.ts";
import { shortName } from "./masking.ts";
import {
  cleanupPush,
  emptyPushReport,
  guardedPush,
  hasPushRecipients,
  insertPush,
  processPushQueue,
  type PushAudience,
  type PushMessageInput,
  type PushQueueReport,
} from "./push-delivery.ts";

/**
 * Qué dice cada aviso en el celular y a quién va (spec 013, R5, R7–R14).
 *
 * - **Privacidad (principio II, RF-006):** el paciente siempre a medias (`shortName`: «Juan P.»),
 *   nunca su cédula, su email, su teléfono ni nada de la historia clínica. El servicio sí va, porque lo
 *   pidió el dueño en el texto («Limpieza»), y el profesional («· con Dra. Pérez») sólo si el negocio
 *   tiene más de una agenda activa.
 * - **El día**, en la zona del negocio: «Hoy 16:00», «Mañana 16:00» o «Mar 20 oct 16:00».
 * - **Nunca rompen lo que los provoca:** cada aviso va en un punto de guardado (guardedPush): si falla,
 *   la reserva y los emails siguen igual (RF-011).
 */

/** La cita como la cuentan los avisos: sólo lo que se muestra, con los pacientes a medias. */
interface AppointmentNotice {
  id: string;
  businessId: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  status: AppointmentStatus;
  timezone: string;
  ownerId: string | null;
  /** Agendas activas del negocio: con más de una, el aviso dice de quién es. */
  agendas: number;
  serviceName: string | null;
  professionalName: string | null;
  professionalUserId: string | null;
  /** El principal primero y después los demás, en su orden. */
  patients: { name: string; toVerify: boolean }[];
}

async function appointmentNotice(db: Db, appointmentId: string): Promise<AppointmentNotice | null> {
  return one<AppointmentNotice>(
    db,
    `select a.id, a.business_id as "businessId", a.date, a.start_time as "startTime", a.end_time as "endTime", a.status,
            b.timezone, b.owner_id as "ownerId",
            (select count(*)::int from professionals p2 where p2.business_id = a.business_id and p2.is_active) as agendas,
            s.name as "serviceName", p.display_name as "professionalName", p.user_id as "professionalUserId",
            coalesce((
              select json_agg(json_build_object('name', x.name, 'toVerify', x.to_verify) order by x.position, x.added_at)
                from (select c.name, c.claimed_client_id is not null as to_verify, 0 as position, null::timestamptz as added_at
                        from clients c where c.id = a.client_id
                      union all
                      select c.name, c.claimed_client_id is not null, 1, ac.created_at
                        from appointment_clients ac join clients c on c.id = ac.client_id
                       where ac.appointment_id = a.id) x), '[]'::json) as patients
       from appointments a
       join businesses b on b.id = a.business_id
       left join services s on s.id = a.service_id
       left join professionals p on p.id = a.professional_id
      where a.id = $1`,
    [appointmentId],
  );
}

/** Hoy en la zona del negocio (con una zona inválida, la de Ecuador: un aviso no debe fallar por eso). */
function todayIn(timezone: string): ISODate {
  try {
    return getZonedNow(timezone).date;
  } catch {
    return getZonedNow(DEFAULT_TIMEZONE).date;
  }
}

/** «hoy», «mañana» o «mar 20 oct». */
function dayLabel(date: ISODate, timezone: string): string {
  const today = todayIn(timezone);
  if (date === today) return "hoy";
  if (date === addDaysISO(today, 1)) return "mañana";
  return formatShortDate(date);
}

/** «Hoy 16:00», «Mañana 16:00» o «Mar 20 oct 16:00». */
export const describeWhen = (date: ISODate, time: TimeString, timezone: string) => `${capitalize(dayLabel(date, timezone))} ${time}`;

/** «Juan P.», «Juan P. y Ana M.» o «Juan P., Ana M. y Luis R.». */
const patientsOf = (notice: AppointmentNotice) => joinNames(notice.patients.map((patient) => shortName(patient.name)));

/** «· con Dra. Pérez», sólo si el negocio tiene más de una agenda activa. */
const withProfessional = (notice: AppointmentNotice) =>
  notice.agendas > 1 && notice.professionalName ? ` · con ${notice.professionalName}` : "";

const appointmentUrl = (notice: Pick<AppointmentNotice, "id" | "date">) => `/dashboard/calendar?date=${notice.date}&appointment=${notice.id}`;

const ownerOf = (notice: AppointmentNotice): PushAudience => ({ ownerOf: notice.businessId });

/**
 * Un aviso de una cita para el propietario: comprueba primero (una consulta) que tenga algún aparato
 * con ese tipo encendido, y sólo entonces arma el texto.
 */
async function notifyAboutAppointment(
  db: Db,
  appointment: Pick<Appointment, "id" | "businessId">,
  kind: PushMessageInput["kind"],
  build: (notice: AppointmentNotice) => PushMessageInput | null,
  excludeUserId: string | null = null,
): Promise<number> {
  return guardedPush(db, kind, async () => {
    const audience: PushAudience = { ownerOf: appointment.businessId, excludeUserId };
    if (!(await hasPushRecipients(db, audience, kind))) return 0;
    const notice = await appointmentNotice(db, appointment.id);
    const message = notice && build(notice);
    return message ? insertPush(db, audience, message) : 0;
  });
}

/* ------------------------------------------------------ Al momento (API) -- */

/**
 * Reserva online nueva (R8), también las «Por verificar» de la spec 009: «Nueva reserva · Mañana 16:00 ·
 * Limpieza · Juan P.». En una sesión en pareja o en familia, un solo aviso con todas las personas. Un
 * reintento de la misma reserva no llega aquí (findRepeatedBooking responde antes).
 */
export function notifyOnlineBooking(db: Db, appointment: Pick<Appointment, "id" | "businessId">): Promise<number> {
  return notifyAboutAppointment(db, appointment, "booking", (notice) => ({
    kind: "booking",
    title: "Nueva reserva",
    body: `${describeWhen(notice.date, notice.startTime, notice.timezone)} · ${notice.serviceName ?? "Cita"} · ${patientsOf(notice)}${withProfessional(notice)}${
      notice.patients.some((patient) => patient.toVerify) ? " · Por verificar" : ""
    }`,
    url: appointmentUrl(notice),
    tag: `reserva-${notice.id}`,
    urgency: "high",
  }));
}

/** Comprobante de pago recibido (R9): «Comprobante de pago · Juan P. · Mañana 16:00». */
export function notifyReceipt(db: Db, appointment: Pick<Appointment, "id" | "businessId">): Promise<number> {
  return notifyAboutAppointment(db, appointment, "receipt", (notice) => ({
    kind: "receipt",
    title: "Comprobante de pago",
    body: `${patientsOf(notice)} · ${describeWhen(notice.date, notice.startTime, notice.timezone)}`,
    url: appointmentUrl(notice),
    tag: `comprobante-${notice.id}`,
    urgency: "high",
  }));
}

/** El paciente canceló desde su email (spec 010, R10): «Cita cancelada por el paciente · Mañana 16:00 · Juan P.». */
export function notifyPatientCancel(db: Db, appointment: Pick<Appointment, "id" | "businessId">): Promise<number> {
  return notifyAboutAppointment(db, appointment, "patient_cancel", (notice) => ({
    kind: "patient_cancel",
    title: "Cita cancelada por el paciente",
    body: `${describeWhen(notice.date, notice.startTime, notice.timezone)} · ${patientsOf(notice)}`,
    url: appointmentUrl(notice),
    tag: `cancelada-${notice.id}`,
    urgency: "high",
  }));
}

/**
 * La cita es de la agenda del propietario, la agendó otra persona (Recepción, un administrador o el
 * super admin en modo soporte) y está Pendiente o Confirmada (R11).
 */
const isNewInOwnerAgenda = (notice: AppointmentNotice, actorUserId: string | null) =>
  notice.ownerId !== null &&
  notice.professionalUserId === notice.ownerId &&
  actorUserId !== notice.ownerId &&
  (notice.status === "pending" || notice.status === "confirmed");

/**
 * Cita nueva desde el panel (R11): «Cita nueva en tu agenda · Mañana 16:00 · Juan P.», sólo si es de la
 * agenda del propietario y no la agendó él. Mover una cita a su agenda no avisa (no es nueva), y la
 * reserva online tiene su propio aviso.
 */
export function notifyNewAppointment(db: Db, appointment: Pick<Appointment, "id" | "businessId">, actorUserId: string | null): Promise<number> {
  return notifyAboutAppointment(
    db,
    appointment,
    "new_appointment",
    (notice) =>
      isNewInOwnerAgenda(notice, actorUserId)
        ? {
            kind: "new_appointment",
            title: "Cita nueva en tu agenda",
            body: `${describeWhen(notice.date, notice.startTime, notice.timezone)} · ${patientsOf(notice)}`,
            url: appointmentUrl(notice),
            tag: `cita-nueva-${notice.id}`,
            urgency: "high",
          }
        : null,
    actorUserId,
  );
}

/**
 * ENGANCHE PARA LA SPEC 011 (series de citas): una serie avisa UNA sola vez (R11 de esta spec), como
 * su email único: «Citas nuevas en tu agenda · 8 citas desde el mar 20 oct 10:00 · Juan P.», y abre la
 * primera. Lo llama `appointment-series-service.ts` al final de su transacción, con las citas que creó
 * (en cualquier orden) y quién las agendó: `await notifyNewSeries(db, created, actor.userId)`. Las
 * mismas condiciones que una cita suelta, con la primera. Con una sola cita, es el aviso de una cita.
 */
export async function notifyNewSeries(
  db: Db,
  appointments: Pick<Appointment, "id" | "businessId" | "date" | "startTime">[],
  actorUserId: string | null,
): Promise<number> {
  if (appointments.length === 0) return 0;
  const [first] = [...appointments].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  if (appointments.length === 1) return notifyNewAppointment(db, first, actorUserId);
  return notifyAboutAppointment(
    db,
    first,
    "new_appointment",
    (notice) => {
      if (!isNewInOwnerAgenda(notice, actorUserId)) return null;
      const day = dayLabel(notice.date, notice.timezone);
      const from = day === "hoy" || day === "mañana" ? day : `el ${day}`;
      return {
        kind: "new_appointment",
        title: "Citas nuevas en tu agenda",
        body: `${appointments.length} citas desde ${from} ${notice.startTime} · ${patientsOf(notice)}`,
        url: appointmentUrl(notice),
        tag: `cita-nueva-${notice.id}`,
        urgency: "high",
      };
    },
    actorUserId,
  );
}

/**
 * Negocio nuevo (R14): sólo el alta del onboarding (cuando alguien se registra); uno que crea un super
 * admin desde /admin no avisa. A los super admin, con el nombre y la categoría.
 */
export function notifyNewBusiness(db: Db, business: Pick<Business, "id" | "name" | "category">): Promise<number> {
  return guardedPush(db, "new_business", async () => {
    const audience: PushAudience = { platform: true };
    if (!(await hasPushRecipients(db, audience, "new_business"))) return 0;
    const category = await one<{ name: string }>(db, "select name from business_categories where id = $1", [business.category]);
    return insertPush(db, audience, {
      kind: "new_business",
      title: "Negocio nuevo",
      body: category ? `${business.name} · ${category.name}` : business.name,
      url: `/admin/businesses/${business.id}`,
      tag: `negocio-${business.id}`,
      urgency: "normal",
    });
  });
}

/**
 * Solicitud de cambio de plan (R14): «Mente Abierta · de Free a Pro». Sólo la ve el super admin: los
 * negocios siguen sin ver planes ni precios.
 */
export function notifyPlanRequest(
  db: Db,
  request: { id: string; businessId: string; businessName: string; currentPlanName: string; requestedPlanName: string },
): Promise<number> {
  return guardedPush(db, "plan_request", async () => {
    const audience: PushAudience = { platform: true };
    if (!(await hasPushRecipients(db, audience, "plan_request"))) return 0;
    return insertPush(db, audience, {
      kind: "plan_request",
      title: "Solicitud de cambio de plan",
      body: `${request.businessName} · de ${request.currentPlanName} a ${request.requestedPlanName}`,
      url: `/admin/businesses/${request.businessId}`,
      tag: `plan-${request.id}`,
      urgency: "normal",
    });
  });
}

/* ------------------------------------------------------------- Del cron -- */

/** El cron estuvo parado: se avisa como mucho de lo de las últimas 3 horas (R12, R13). */
const MAX_WINDOW_MS = 3 * 60 * 60_000;
/** Citas por cerrar avisadas en cada pasada, como mucho. */
const MAX_UNCLOSED_PER_RUN = 100;

/** La ventana (desde, hasta] de esta pasada, con el tope de 3 horas. Sin pasada anterior, las últimas 3 h. */
function cronWindow(since: string | null, until: string): { from: string; until: string } {
  const end = Date.parse(until);
  const start = Math.max(since ? Date.parse(since) : 0, end - MAX_WINDOW_MS);
  return { from: new Date(start).toISOString(), until: new Date(end).toISOString() };
}

/** Negocios activos con propietario que tiene algún aparato con este tipo encendido. */
async function businessesWithRecipients(kind: string): Promise<{ id: string; timezone: string }[]> {
  return many<{ id: string; timezone: string }>(
    pool,
    `select b.id, b.timezone
       from businesses b
      where b.status = 'active' and b.owner_id is not null
        and exists (select 1 from push_subscriptions s join users u on u.id = s.user_id and u.is_active
                     where s.user_id = b.owner_id and s.signed_out_at is null and not ($1 = any (s.muted_kinds)))
      order by b.id`,
    [kind],
  );
}

/**
 * Citas por cerrar (R12): las Pendientes o Confirmadas cuyo fin más 30 minutos cayó en la ventana de
 * esta pasada del cron. Se comparan instantes en la zona de cada negocio: una cita que termina a las
 * 23:45 se avisa a las 00:15. Cada cita entra en una sola ventana, y la clave del aviso impide repetirla
 * si el cron reintenta la pasada; si ya se cerró, no se avisa. Un negocio que falla no frena a los demás.
 */
export async function queueUnclosedNotices(since: string | null, until: string): Promise<number> {
  const window = cronWindow(since, until);
  let queued = 0;
  let remaining = MAX_UNCLOSED_PER_RUN;
  for (const business of await businessesWithRecipients("unclosed")) {
    if (remaining <= 0) break;
    try {
      const due = await many<{ id: string }>(
        pool,
        `select a.id from appointments a
          where a.business_id = $1 and a.status in ('pending', 'confirmed')
            and a.date between ($2::timestamptz at time zone $4)::date - 1 and ($3::timestamptz at time zone $4)::date
            and ((a.date + a.end_time) at time zone $4) + make_interval(mins => $5) > $2::timestamptz
            and ((a.date + a.end_time) at time zone $4) + make_interval(mins => $5) <= $3::timestamptz
          order by a.date, a.end_time
          limit $6`,
        [business.id, window.from, window.until, business.timezone, UNCLOSED_AFTER_MINUTES, remaining],
      );
      remaining -= due.length;
      for (const { id } of due) {
        queued += await guardedPush(
          pool,
          "unclosed",
          async () => {
            const notice = await appointmentNotice(pool, id);
            if (!notice) return 0;
            return insertPush(pool, ownerOf(notice), {
              kind: "unclosed",
              title: "Cita por cerrar",
              body: `${notice.startTime} · ${notice.serviceName ?? "Cita"} · ${patientsOf(notice)}${withProfessional(notice)}: márcala Completada o No asistió`,
              url: appointmentUrl(notice),
              tag: `por-cerrar-${notice.id}`,
              urgency: "normal",
              dedupeKey: `por-cerrar:${notice.id}:${notice.date}T${notice.endTime}`,
            });
          },
          { inTransaction: false },
        );
      }
    } catch (error) {
      // Sólo el id del negocio y el código: los registros del cron son públicos.
      console.error(`[avisos] Citas por cerrar: falló el negocio ${business.id} (${(error as { code?: string })?.code ?? "error"}).`);
    }
  }
  return queued;
}

/**
 * Resumen de las 8 de la noche (R13): en la pasada en cuya ventana caen las 20:00 de hoy en la zona del
 * negocio, cuántas citas de hoy que ya terminaron (hasta las 20:00) siguen Pendientes o Confirmadas. Si
 * no hay ninguna, nada. Una vez por día (clave `resumen:<negocio>:<fecha>`); si el cron no corre entre
 * las 20:00 y las 23:00, ese día no llega.
 */
export async function queueEveningSummaries(since: string | null, until: string): Promise<number> {
  const window = cronWindow(since, until);
  let queued = 0;
  for (const business of await businessesWithRecipients("evening_summary")) {
    try {
      const summary = await one<{ date: ISODate; open: number }>(
        pool,
        `select d as date,
                (select count(*)::int from appointments a
                  where a.business_id = $1 and a.date = d and a.status in ('pending', 'confirmed')
                    and a.end_time <= make_time($5, 0, 0)) as open
           from (select distinct x as d from (values (($2::timestamptz at time zone $4)::date), (($3::timestamptz at time zone $4)::date)) v (x)) days
          where ((d + make_time($5, 0, 0)) at time zone $4) > $2::timestamptz
            and ((d + make_time($5, 0, 0)) at time zone $4) <= $3::timestamptz
          order by d desc
          limit 1`,
        [business.id, window.from, window.until, business.timezone, EVENING_SUMMARY_HOUR],
      );
      if (!summary || summary.open === 0) continue;
      queued += await guardedPush(
        pool,
        "evening_summary",
        () =>
          insertPush(
            pool,
            { ownerOf: business.id },
            {
              kind: "evening_summary",
              title: `Tienes ${plural(summary.open, "cita", "citas")} de hoy sin cerrar`,
              body: `${summary.open === 1 ? "Márcala" : "Márcalas"} Completada o No asistió para que la agenda y los reportes cuadren.`,
              url: `/dashboard/calendar?date=${summary.date}`,
              tag: `resumen-${summary.date}`,
              urgency: "normal",
              dedupeKey: `resumen:${business.id}:${summary.date}`,
            },
          ),
        { inTransaction: false },
      );
    } catch (error) {
      console.error(`[avisos] Resumen de las 8: falló el negocio ${business.id} (${(error as { code?: string })?.code ?? "error"}).`);
    }
  }
  return queued;
}

/** Un cambio de seguridad de una cuenta de super admin, como lo devuelve findAccountChanges (spec 009). */
export interface AccountSecurityChange {
  /** El registro de actividad: la clave del aviso. */
  id: string;
  /** Ya enmascarada ("ma***@gmail.com"). */
  account: string;
  change: string;
}

/**
 * Cambios de seguridad en cuentas de super admin (R14), además del aviso de ntfy: «ma***@gmail.com ·
 * Desactivó la verificación en dos pasos». Uno por registro (clave `cuenta:<id>`).
 */
export async function queueAccountSecurityNotices(changes: AccountSecurityChange[]): Promise<number> {
  let queued = 0;
  for (const change of changes) {
    queued += await guardedPush(
      pool,
      "account_security",
      () =>
        insertPush(
          pool,
          { platform: true },
          {
            kind: "account_security",
            title: "Cambio de seguridad en una cuenta de super admin",
            body: `${change.account} · ${change.change}`,
            url: "/admin/activity?ver=seguridad",
            tag: `cuenta-${change.id}`,
            urgency: "high",
            dedupeKey: `cuenta:${change.id}`,
          },
        ),
      { inTransaction: false },
    );
  }
  return queued;
}

/**
 * Posibles intentos de adivinar contraseñas (R14), con lo que ya encuentra el cron para ntfy: un solo
 * aviso con la primera cuenta y «y 2 cuentas más». Como mucho uno por cuenta y por hora, aunque el
 * ataque siga en cada pasada. `at`: la hora de la pasada.
 */
export async function queueLoginAttackNotice(alerts: { account: string; attempts: number }[], at: string): Promise<number> {
  const [first] = alerts;
  if (!first) return 0;
  const hour = new Date(at).toISOString().slice(0, 13);
  const others = alerts.length - 1;
  return guardedPush(
    pool,
    "login_attack",
    () =>
      insertPush(
        pool,
        { platform: true },
        {
          kind: "login_attack",
          title: "Posibles intentos de adivinar contraseñas",
          body: `${first.account}: ${first.attempts} intentos fallidos en la última hora${others > 0 ? ` y ${plural(others, "cuenta más", "cuentas más")}` : ""}`,
          url: "/admin/activity?ver=seguridad",
          tag: `intentos-${hour}`,
          urgency: "high",
          dedupeKey: `intentos:${first.account}:${hour}`,
        },
      ),
    { inTransaction: false },
  );
}

/** Lo que hizo el cron con los avisos en el celular (va en cron_runs.report: sólo cifras). */
export interface PushReport extends PushQueueReport {
  /** Avisos puestos en cola por el cron en esta pasada (citas por cerrar, resumen, super admin). */
  queued: number;
}

/** Tiempo del cron para enviar avisos (el job de GitHub tiene 10 minutos). */
const CRON_PUSH_BUDGET_MS = 60_000;

/**
 * Los avisos del cron (R15), después de los de ntfy: citas por cerrar, el resumen de las 8 y los del
 * super admin; después, el envío de todo lo pendiente (también lo que la API no llegó a enviar) y la
 * limpieza. Nada de esto corre en Vercel. Si algo falla (p. ej. falta la migración 040), el cron sigue.
 */
export async function runPushJobs(input: {
  since: string | null;
  until: string;
  accountChanges: AccountSecurityChange[];
  loginAttacks: { account: string; attempts: number }[];
}): Promise<PushReport> {
  const report: PushReport = { queued: 0, ...emptyPushReport() };
  const steps: [string, () => Promise<number>][] = [
    ["citas por cerrar", () => queueUnclosedNotices(input.since, input.until)],
    ["resumen de las 8", () => queueEveningSummaries(input.since, input.until)],
    ["cambios de cuenta", () => queueAccountSecurityNotices(input.accountChanges)],
    ["intentos fallidos", () => queueLoginAttackNotice(input.loginAttacks, input.until)],
  ];
  for (const [name, step] of steps) {
    try {
      report.queued += await step();
    } catch (error) {
      console.error(`[avisos] Falló «${name}» (${(error as { code?: string })?.code ?? "error"}).`);
    }
  }
  const sent = await processPushQueue({ deadline: Date.now() + CRON_PUSH_BUDGET_MS });
  Object.assign(report, { ...sent, queued: report.queued });
  await cleanupPush().catch((error: unknown) =>
    console.error(`[avisos] No se pudo limpiar la cola (${(error as { code?: string })?.code ?? "error"}).`),
  );
  return report;
}
