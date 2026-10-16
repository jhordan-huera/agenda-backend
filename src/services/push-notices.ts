import { many, one, pool, type Db } from "../db/pool.ts";
import { EVENING_SUMMARY_HOUR, UNCLOSED_AFTER_MINUTES } from "../shared/lib/constants/push.ts";
import { describeNotice, type NoticeAppointment, type NoticeDataByKind, type NoticeText } from "../shared/lib/notices.ts";
import type { Appointment, AppointmentStatus, Business, ISODate, NoticeKind, TimeString } from "../shared/types/index.ts";
import { shortName } from "./masking.ts";
import { addAppointmentNotice, addPlatformNotice, noticePatientsSql } from "./panel-notices.ts";
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
 * Qué dice cada aviso en el celular y a quién va (spec 013, R5, R7–R14), y el aviso de la campana del
 * panel que sale en los mismos puntos (spec 014, R4).
 *
 * - **Los textos** salen de describeNotice (src/shared/lib/notices.ts), los mismos del celular, de la
 *   campana y de la beta. En el celular el paciente va siempre a medias (`shortName`: «Juan P.»); la
 *   campana arma el suyo al leer, con el nombre completo (panel-notices.ts).
 * - **Privacidad (principio II, RF-006):** nunca la cédula, el email, el teléfono ni nada de la historia
 *   clínica. El servicio sí va, porque lo pidió el dueño en el texto («Limpieza»), y el profesional
 *   («· con Dra. Pérez») sólo si el negocio tiene más de una agenda activa.
 * - **El día**, en la zona del negocio: «Hoy 16:00», «Mañana 16:00» o «Mar 20 oct 16:00».
 * - **La campana no depende del celular** (RF-003): su aviso se guarda siempre, haya o no aparatos, y
 *   antes de mirar los del celular. El celular sigue como en la spec 013: el propietario y los super
 *   admin con aparatos y, desde la spec 017, cada profesional con el resumen de las 8 de su agenda.
 * - **Nunca rompen lo que los provoca:** el aviso del panel y el del celular van cada uno en su punto de
 *   guardado (`aviso_panel` y `aviso_celular`): si fallan, la reserva y los emails siguen igual (RF-011).
 */

/** La cita como la cuentan los avisos, con lo que hace falta para decidir a quién van. */
interface AppointmentNotice extends NoticeAppointment {
  businessId: string;
  endTime: TimeString;
  status: AppointmentStatus;
  ownerId: string | null;
  professionalUserId: string | null;
}

async function appointmentNotice(db: Db, appointmentId: string): Promise<AppointmentNotice | null> {
  return one<AppointmentNotice>(
    db,
    `select a.id, a.business_id as "businessId", a.date, a.start_time as "startTime", a.end_time as "endTime", a.status,
            b.timezone, b.owner_id as "ownerId",
            (select count(*)::int from professionals p2 where p2.business_id = a.business_id and p2.is_active) as agendas,
            s.name as "serviceName", p.display_name as "professionalName", p.user_id as "professionalUserId",
            ${noticePatientsSql("a")} as patients
       from appointments a
       join businesses b on b.id = a.business_id
       left join services s on s.id = a.service_id
       left join professionals p on p.id = a.professional_id
      where a.id = $1`,
    [appointmentId],
  );
}

/** En el celular, el paciente siempre a medias («Juan P.»). */
const PHONE_NAMES = { name: shortName };

/** El texto del celular de un aviso (los mismos constructores que la campana). */
const phoneText = <K extends NoticeKind>(kind: K, data: NoticeDataByKind[K]): NoticeText => describeNotice(kind, data, PHONE_NAMES);

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
 * reintento de la misma reserva no llega aquí (findRepeatedBooking responde antes). En la campana: el
 * propietario, Recepción, los administradores y quien tiene esa agenda (spec 014).
 */
export async function notifyOnlineBooking(db: Db, appointment: Pick<Appointment, "id" | "businessId">): Promise<number> {
  await addAppointmentNotice(db, { kind: "booking", businessId: appointment.businessId, appointmentId: appointment.id });
  return notifyAboutAppointment(db, appointment, "booking", (notice) => ({
    kind: "booking",
    ...phoneText("booking", { appointment: notice }),
    tag: `reserva-${notice.id}`,
    urgency: "high",
  }));
}

/** Comprobante de pago recibido (R9): «Comprobante de pago · Juan P. · Mañana 16:00». */
export async function notifyReceipt(db: Db, appointment: Pick<Appointment, "id" | "businessId">): Promise<number> {
  await addAppointmentNotice(db, { kind: "receipt", businessId: appointment.businessId, appointmentId: appointment.id });
  return notifyAboutAppointment(db, appointment, "receipt", (notice) => ({
    kind: "receipt",
    ...phoneText("receipt", { appointment: notice }),
    tag: `comprobante-${notice.id}`,
    urgency: "high",
  }));
}

/** El paciente canceló desde su email (spec 010, R10): «Cita cancelada por el paciente · Mañana 16:00 · Juan P.». */
export async function notifyPatientCancel(db: Db, appointment: Pick<Appointment, "id" | "businessId">): Promise<number> {
  await addAppointmentNotice(db, { kind: "patient_cancel", businessId: appointment.businessId, appointmentId: appointment.id });
  return notifyAboutAppointment(db, appointment, "patient_cancel", (notice) => ({
    kind: "patient_cancel",
    ...phoneText("patient_cancel", { appointment: notice }),
    tag: `cancelada-${notice.id}`,
    urgency: "high",
  }));
}

/**
 * El paciente pulsó «Confirmo que voy» en su email (spec 010; aviso pedido por el dueño el 2026-10-15):
 * «El paciente confirmó · Mañana 16:00 · Juan P.». En una sesión con varias personas, cada una avisa con
 * su nombre. Sólo la primera vez: repetirlo no llega aquí.
 */
export async function notifyPatientConfirmed(db: Db, appointment: Pick<Appointment, "id" | "businessId">, clientId: string): Promise<number> {
  await addAppointmentNotice(db, { kind: "patient_confirm", businessId: appointment.businessId, appointmentId: appointment.id, clientId });
  return guardedPush(db, "patient_confirm", async () => {
    const audience: PushAudience = { ownerOf: appointment.businessId };
    if (!(await hasPushRecipients(db, audience, "patient_confirm"))) return 0;
    const notice = await appointmentNotice(db, appointment.id);
    const patient = await one<{ name: string }>(db, "select name from clients where id = $1", [clientId]);
    if (!notice || !patient) return 0;
    return insertPush(db, audience, {
      kind: "patient_confirm",
      ...phoneText("patient_confirm", { appointment: notice, confirmedBy: patient.name }),
      tag: `confirmo-${notice.id}-${clientId}`,
      urgency: "normal",
    });
  });
}

/**
 * En el celular: la cita es de la agenda del propietario, la agendó otra persona (Recepción, un
 * administrador o el super admin en modo soporte) y está Pendiente o Confirmada (R11). La campana avisa a
 * cualquier agenda con usuario (addAppointmentNotice, spec 014).
 */
const isNewInOwnerAgenda = (notice: AppointmentNotice, actorUserId: string | null) =>
  notice.ownerId !== null &&
  notice.professionalUserId === notice.ownerId &&
  actorUserId !== notice.ownerId &&
  (notice.status === "pending" || notice.status === "confirmed");

/**
 * Cita nueva desde el panel (R11): «Cita nueva en tu agenda · Mañana 16:00 · Juan P.». En el celular,
 * sólo si es de la agenda del propietario y no la agendó él; en la campana, a quien tenga esa agenda
 * (también el propietario), nunca a quien la agendó (spec 014, decisión 1). Mover una cita a otra agenda
 * no avisa (no es nueva), y la reserva online tiene su propio aviso.
 */
export async function notifyNewAppointment(db: Db, appointment: Pick<Appointment, "id" | "businessId">, actorUserId: string | null): Promise<number> {
  await addAppointmentNotice(db, { kind: "new_appointment", businessId: appointment.businessId, appointmentId: appointment.id, actorUserId });
  return notifyAboutAppointment(
    db,
    appointment,
    "new_appointment",
    (notice) =>
      isNewInOwnerAgenda(notice, actorUserId)
        ? { kind: "new_appointment", ...phoneText("new_appointment", { appointment: notice }), tag: `cita-nueva-${notice.id}`, urgency: "high" }
        : null,
    actorUserId,
  );
}

/**
 * ENGANCHE PARA LA SPEC 011 (series de citas): una serie avisa UNA sola vez (R11 de esta spec), como
 * su email único: «Citas nuevas en tu agenda · 8 citas desde el mar 20 oct 10:00 · Juan P.», y abre la
 * primera. Lo llama `appointment-series-service.ts` al final de su transacción, con las citas que creó
 * (en cualquier orden) y quién las agendó: `await notifyNewSeries(db, created, actor.userId)`. Las
 * mismas condiciones que una cita suelta, con la primera. Con una sola cita, es el aviso de una cita. En
 * la campana, también uno solo (con cuántas son).
 */
export async function notifyNewSeries(
  db: Db,
  appointments: Pick<Appointment, "id" | "businessId" | "date" | "startTime">[],
  actorUserId: string | null,
): Promise<number> {
  if (appointments.length === 0) return 0;
  const [first] = [...appointments].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  if (appointments.length === 1) return notifyNewAppointment(db, first, actorUserId);
  await addAppointmentNotice(db, {
    kind: "new_appointment",
    businessId: first.businessId,
    appointmentId: first.id,
    actorUserId,
    data: { count: appointments.length },
    dedupeKey: `serie:${first.id}`,
  });
  return notifyAboutAppointment(
    db,
    first,
    "new_appointment",
    (notice) =>
      isNewInOwnerAgenda(notice, actorUserId)
        ? {
            kind: "new_appointment",
            ...phoneText("new_appointment", { appointment: notice, count: appointments.length }),
            tag: `cita-nueva-${notice.id}`,
            urgency: "high",
          }
        : null,
    actorUserId,
  );
}

/**
 * Negocio nuevo (R14): sólo el alta del onboarding (cuando alguien se registra); uno que crea un super
 * admin desde /admin no avisa. A los super admin, con el nombre y la categoría, en el celular y en su
 * campana de /admin.
 */
export async function notifyNewBusiness(db: Db, business: Pick<Business, "id" | "name" | "category">): Promise<number> {
  const describe = async () => {
    const category = await one<{ name: string }>(db, "select name from business_categories where id = $1", [business.category]);
    return phoneText("new_business", { businessId: business.id, businessName: business.name, categoryName: category?.name ?? null });
  };
  await addPlatformNotice(db, { kind: "new_business", text: describe });
  return guardedPush(db, "new_business", async () => {
    const audience: PushAudience = { platform: true };
    if (!(await hasPushRecipients(db, audience, "new_business"))) return 0;
    return insertPush(db, audience, { kind: "new_business", ...(await describe()), tag: `negocio-${business.id}`, urgency: "normal" });
  });
}

/**
 * Solicitud de cambio de plan (R14): «Mente Abierta · de Free a Pro». Sólo la ve el super admin (en el
 * celular y en su campana): los negocios siguen sin ver planes ni precios.
 */
export async function notifyPlanRequest(
  db: Db,
  request: { id: string; businessId: string; businessName: string; currentPlanName: string; requestedPlanName: string },
): Promise<number> {
  const text = phoneText("plan_request", {
    businessId: request.businessId,
    businessName: request.businessName,
    currentPlanName: request.currentPlanName,
    requestedPlanName: request.requestedPlanName,
  });
  await addPlatformNotice(db, { kind: "plan_request", text, dedupeKey: `plan:${request.id}` });
  return guardedPush(db, "plan_request", async () => {
    const audience: PushAudience = { platform: true };
    if (!(await hasPushRecipients(db, audience, "plan_request"))) return 0;
    return insertPush(db, audience, { kind: "plan_request", ...text, tag: `plan-${request.id}`, urgency: "normal" });
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

/** Lo que guardó el cron en las campanas del panel en esta pasada (spec 014): va en el informe. */
export interface PanelTally {
  panel: number;
}

/** Negocios activos (los suspendidos no generan avisos), con su zona y su propietario. */
async function activeBusinesses(): Promise<{ id: string; timezone: string; ownerId: string | null }[]> {
  return many<{ id: string; timezone: string; ownerId: string | null }>(
    pool,
    `select b.id, b.timezone, b.owner_id as "ownerId" from businesses b where b.status = 'active' order by b.id`,
  );
}

/** ¿El propietario de este negocio tiene algún aparato con este tipo encendido? (si falla, como si no). */
const ownerHasPhone = (businessId: string, kind: PushMessageInput["kind"]) =>
  hasPushRecipients(pool, { ownerOf: businessId }, kind).catch(() => false);

/**
 * Citas por cerrar (R12): las Pendientes o Confirmadas cuyo fin más 30 minutos cayó en la ventana de
 * esta pasada del cron. Se comparan instantes en la zona de cada negocio: una cita que termina a las
 * 23:45 se avisa a las 00:15. Cada cita entra en una sola ventana, y la clave del aviso impide repetirla
 * si el cron reintenta la pasada; si ya se cerró, no se avisa. Un negocio que falla no frena a los demás.
 *
 * Desde la spec 014 mira todos los negocios activos (R5): el aviso de la campana sale siempre (al
 * propietario y a quien tiene esa agenda) y el del celular, como antes, sólo si el propietario tiene
 * aparatos. Devuelve los avisos del celular puestos en cola; los de la campana se suman a `tally`.
 */
export async function queueUnclosedNotices(since: string | null, until: string, tally?: PanelTally): Promise<number> {
  const window = cronWindow(since, until);
  let queued = 0;
  let remaining = MAX_UNCLOSED_PER_RUN;
  for (const business of await activeBusinesses()) {
    if (remaining <= 0) break;
    try {
      const due = await many<{ id: string; date: ISODate; endTime: TimeString }>(
        pool,
        `select a.id, a.date, a.end_time as "endTime" from appointments a
          where a.business_id = $1 and a.status in ('pending', 'confirmed')
            and a.date between ($2::timestamptz at time zone $4)::date - 1 and ($3::timestamptz at time zone $4)::date
            and ((a.date + a.end_time) at time zone $4) + make_interval(mins => $5) > $2::timestamptz
            and ((a.date + a.end_time) at time zone $4) + make_interval(mins => $5) <= $3::timestamptz
          order by a.date, a.end_time
          limit $6`,
        [business.id, window.from, window.until, business.timezone, UNCLOSED_AFTER_MINUTES, remaining],
      );
      remaining -= due.length;
      if (due.length === 0) continue;
      const toPhone = await ownerHasPhone(business.id, "unclosed");
      for (const { id, date, endTime } of due) {
        const saved = await addAppointmentNotice(
          pool,
          { kind: "unclosed", businessId: business.id, appointmentId: id, dedupeKey: `unclosed:${id}:${date}T${endTime}` },
          { inTransaction: false },
        );
        if (tally) tally.panel += saved;
        if (!toPhone) continue;
        queued += await guardedPush(
          pool,
          "unclosed",
          async () => {
            const notice = await appointmentNotice(pool, id);
            if (!notice) return 0;
            return insertPush(pool, ownerOf(notice), {
              kind: "unclosed",
              ...phoneText("unclosed", { appointment: notice }),
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
 *
 * Desde la spec 014, para todos los negocios activos (R5): en la campana, el del negocio entero al
 * propietario y uno por cada agenda con usuario que no sea el propietario, con sus propias citas (clave
 * `resumen:<agenda>:<fecha>`), si le queda alguna. En el celular, como antes, el del negocio al
 * propietario con aparatos y, desde la spec 017, el de su agenda a cada profesional con aparatos
 * (`userOf`: quien tiene la agenda ese día y sigue con el rol Profesional), con la misma clave. El
 * propietario no recibe un segundo aviso por su propia agenda, y el aviso sólo lleva la cifra, nunca un
 * paciente. Devuelve los del celular; los de la campana se suman a `tally`.
 */
export async function queueEveningSummaries(since: string | null, until: string, tally?: PanelTally): Promise<number> {
  const window = cronWindow(since, until);
  let queued = 0;
  for (const business of await activeBusinesses()) {
    try {
      const day = await one<{ date: ISODate }>(
        pool,
        `select d as date
           from (select distinct x as d from (values (($1::timestamptz at time zone $3)::date), (($2::timestamptz at time zone $3)::date)) v (x)) days
          where ((d + make_time($4, 0, 0)) at time zone $3) > $1::timestamptz
            and ((d + make_time($4, 0, 0)) at time zone $3) <= $2::timestamptz
          order by d desc
          limit 1`,
        [window.from, window.until, business.timezone, EVENING_SUMMARY_HOUR],
      );
      if (!day) continue;
      const agendas = await many<{ professionalId: string; userId: string | null; isActive: boolean; open: number }>(
        pool,
        `select a.professional_id as "professionalId", p.user_id as "userId", coalesce(p.is_active, false) as "isActive", count(*)::int as open
           from appointments a left join professionals p on p.id = a.professional_id
          where a.business_id = $1 and a.date = $2 and a.status in ('pending', 'confirmed')
            and a.end_time <= make_time($3, 0, 0)
          group by a.professional_id, p.user_id, p.is_active`,
        [business.id, day.date, EVENING_SUMMARY_HOUR],
      );
      const open = agendas.reduce((total, agenda) => total + agenda.open, 0);
      if (open === 0) continue;
      const save = async (professionalId: string | null, count: number, key: string) => {
        const saved = await addAppointmentNotice(
          pool,
          { kind: "evening_summary", businessId: business.id, appointmentId: null, professionalId, data: { date: day.date, count }, dedupeKey: key },
          { inTransaction: false },
        );
        if (tally) tally.panel += saved;
      };
      /** El aviso del celular: «Tienes N citas de hoy sin cerrar», que abre la agenda de ese día. */
      const toPhone = (audience: PushAudience, count: number, key: string) =>
        guardedPush(
          pool,
          "evening_summary",
          () =>
            insertPush(pool, audience, {
              kind: "evening_summary",
              ...phoneText("evening_summary", { date: day.date, count }),
              tag: `resumen-${day.date}`,
              urgency: "normal",
              dedupeKey: key,
            }),
          { inTransaction: false },
        );
      await save(null, open, `resumen:${business.id}:${day.date}`);
      if (await ownerHasPhone(business.id, "evening_summary")) {
        queued += await toPhone({ ownerOf: business.id }, open, `resumen:${business.id}:${day.date}`);
      }
      for (const agenda of agendas) {
        if (!agenda.userId || !agenda.isActive || agenda.userId === business.ownerId) continue;
        const key = `resumen:${agenda.professionalId}:${day.date}`;
        await save(agenda.professionalId, agenda.open, key);
        // Una consulta por agenda: si esa persona no tiene aparatos (o no es del rol Profesional), no pone nada.
        queued += await toPhone({ userOf: agenda.userId, businessId: business.id }, agenda.open, key);
      }
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
 * Desactivó la verificación en dos pasos». Uno por registro (clave `cuenta:<id>`), en el celular y en la
 * campana de /admin (siempre, haya o no aparatos).
 */
export async function queueAccountSecurityNotices(changes: AccountSecurityChange[], tally?: PanelTally): Promise<number> {
  let queued = 0;
  for (const change of changes) {
    const text = phoneText("account_security", { account: change.account, change: change.change });
    const saved = await addPlatformNotice(pool, { kind: "account_security", text, dedupeKey: `cuenta:${change.id}` }, { inTransaction: false });
    if (tally) tally.panel += saved;
    queued += await guardedPush(
      pool,
      "account_security",
      () =>
        insertPush(
          pool,
          { platform: true },
          { kind: "account_security", ...text, tag: `cuenta-${change.id}`, urgency: "high", dedupeKey: `cuenta:${change.id}` },
        ),
      { inTransaction: false },
    );
  }
  return queued;
}

/**
 * Posibles intentos de adivinar contraseñas (R14), con lo que ya encuentra el cron para ntfy: un solo
 * aviso con la primera cuenta y «y 2 cuentas más». Como mucho uno por cuenta y por hora, aunque el
 * ataque siga en cada pasada (en el celular y en la campana de /admin). `at`: la hora de la pasada.
 */
export async function queueLoginAttackNotice(alerts: { account: string; attempts: number }[], at: string, tally?: PanelTally): Promise<number> {
  const [first] = alerts;
  if (!first) return 0;
  const hour = new Date(at).toISOString().slice(0, 13);
  const text = phoneText("login_attack", { account: first.account, attempts: first.attempts, others: alerts.length - 1 });
  const dedupeKey = `intentos:${first.account}:${hour}`;
  const saved = await addPlatformNotice(pool, { kind: "login_attack", text, dedupeKey }, { inTransaction: false });
  if (tally) tally.panel += saved;
  return guardedPush(
    pool,
    "login_attack",
    () => insertPush(pool, { platform: true }, { kind: "login_attack", ...text, tag: `intentos-${hour}`, urgency: "high", dedupeKey }),
    { inTransaction: false },
  );
}

/** Lo que hizo el cron con los avisos en el celular (va en cron_runs.report: sólo cifras). */
export interface PushReport extends PushQueueReport {
  /** Avisos puestos en cola por el cron en esta pasada (citas por cerrar, resumen, super admin). */
  queued: number;
  /** Avisos guardados en las campanas del panel en esta pasada (spec 014). */
  panel?: number;
}

/** Tiempo del cron para enviar avisos (el job de GitHub tiene 10 minutos). */
const CRON_PUSH_BUDGET_MS = 60_000;

/**
 * Los avisos del cron (R15), después de los de ntfy: citas por cerrar, el resumen de las 8 y los del
 * super admin, en el celular y en las campanas del panel (spec 014); después, el envío de todo lo
 * pendiente (también lo que la API no llegó a enviar) y la limpieza. Nada de esto corre en Vercel. Si
 * algo falla (p. ej. falta la migración 040 o la 041), el cron sigue.
 */
export async function runPushJobs(input: {
  since: string | null;
  until: string;
  accountChanges: AccountSecurityChange[];
  loginAttacks: { account: string; attempts: number }[];
}): Promise<PushReport> {
  const report: PushReport = { queued: 0, ...emptyPushReport() };
  const tally: PanelTally = { panel: 0 };
  const steps: [string, () => Promise<number>][] = [
    ["citas por cerrar", () => queueUnclosedNotices(input.since, input.until, tally)],
    ["resumen de las 8", () => queueEveningSummaries(input.since, input.until, tally)],
    ["cambios de cuenta", () => queueAccountSecurityNotices(input.accountChanges, tally)],
    ["intentos fallidos", () => queueLoginAttackNotice(input.loginAttacks, input.until, tally)],
  ];
  for (const [name, step] of steps) {
    try {
      report.queued += await step();
    } catch (error) {
      console.error(`[avisos] Falló «${name}» (${(error as { code?: string })?.code ?? "error"}).`);
    }
  }
  const sent = await processPushQueue({ deadline: Date.now() + CRON_PUSH_BUDGET_MS });
  Object.assign(report, { ...sent, queued: report.queued, panel: tally.panel });
  await cleanupPush().catch((error: unknown) =>
    console.error(`[avisos] No se pudo limpiar la cola (${(error as { code?: string })?.code ?? "error"}).`),
  );
  return report;
}
