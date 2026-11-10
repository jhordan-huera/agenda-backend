import { businessColumns } from "../db/columns.ts";
import { one, type Db } from "../db/pool.ts";
import { emailTemplates, type MonthlyReportEmailData } from "../shared/lib/email/templates.ts";
import { addDaysISO, getZonedNow } from "../shared/lib/time.ts";
import type { Business, ISODate } from "../shared/types/index.ts";
import { appOrigin, queueEmail } from "./notifications.ts";
import { countsForPlanSql } from "./plan-limits.ts";
import { referralLink } from "./referral-service.ts";

/**
 * El informe mensual al propietario (spec 040): el día 1, el resumen del mes calendario anterior de su negocio por
 * email, con cifras reales contadas como la analítica del super admin (spec 016). Lo prepara y lo envía el cron de
 * GitHub (queueMonthlyReports), nunca la API.
 */

/** Desde qué hora del negocio sale (el día 1). */
export const MONTHLY_REPORT_HOUR = 8;
/** Hasta qué día del mes sale si el día 1 el cron no pudo pasar. */
export const MONTHLY_REPORT_LAST_DAY = 7;

/** El mes del informe: del primer día (incluido) al primero del mes siguiente, y el mes anterior para comparar. */
export interface ReportMonth {
  /** «2026-10» (va en la clave que no deja repetir el informe). */
  key: string;
  from: ISODate;
  to: ISODate;
  previousFrom: ISODate;
}

/** El mes anterior al de `today` (la fecha del negocio). */
export function previousMonthOf(today: ISODate): ReportMonth {
  const to = `${today.slice(0, 7)}-01`;
  const from = `${addDaysISO(to, -1).slice(0, 7)}-01`;
  const previousFrom = `${addDaysISO(from, -1).slice(0, 7)}-01`;
  return { key: from.slice(0, 7), from, to, previousFrom };
}

/** Las cifras del mes de un negocio (las que van en el email). */
export type MonthStats = Pick<
  MonthlyReportEmailData,
  "appointments" | "online" | "reminders" | "confirmations" | "timelyCancellations" | "newClients" | "receipts" | "revenue" | "previousAppointments"
>;

/**
 * Las cifras del mes en la hora del negocio, como la analítica (analytics-service.ts):
 * - las citas, sin las canceladas; de ésas, las online (por la página de reservas) y las confirmadas por el paciente;
 * - los recordatorios de cita enviados;
 * - las canceladas con 24 h o más de anticipación (desde el panel o desde «Tu cita»): la hora quedó libre;
 * - los pacientes nuevos, sin los importados y como cuenta el plan (sin las reservas online sin cita);
 * - los comprobantes que subieron los pacientes por el enlace de pago;
 * - la suma del precio de las completadas, y las citas del mes anterior para comparar.
 */
export async function monthStats(db: Db, businessId: string, timezone: string, month: ReportMonth): Promise<MonthStats> {
  return (await one<MonthStats>(
    db,
    `with w as (
       select $2::date as m_from, $3::date as m_to, $4::date as p_from,
              ($2::date)::timestamp at time zone $5 as m_from_at, ($3::date)::timestamp at time zone $5 as m_to_at
     ),
     a as (
       select a.id, a.status, a.source, a.price, a.client_confirmed_at, a.date, a.start_time,
              a.date >= w.m_from and a.date < w.m_to as cur
         from appointments a, w
        where a.business_id = $1 and a.date >= w.p_from and a.date < w.m_to
     ),
     cancellations as (
       select l.entity_id, max(l.created_at) as at from audit_logs l
        where l.business_id = $1 and l.entity_type = 'appointment' and l.action in ('appointment.cancelled', 'appointment.client_cancelled')
        group by l.entity_id
     )
     select (select count(*) from a where cur and status <> 'cancelled')::int as appointments,
            (select count(*) from a where cur and status <> 'cancelled' and source = 'booking_page')::int as online,
            (select count(*) from a where cur and status <> 'cancelled' and client_confirmed_at is not null)::int as confirmations,
            (select coalesce(sum(price), 0) from a where cur and status = 'completed')::float8 as revenue,
            (select count(*) from a where not cur and status <> 'cancelled')::int as "previousAppointments",
            (select count(*) from a join cancellations k on k.entity_id = a.id
              where cur and a.status = 'cancelled' and k.at <= ((a.date + a.start_time) at time zone $5) - interval '24 hours')::int
              as "timelyCancellations",
            (select count(*) from notifications n, w
              where n.business_id = $1 and n.type = 'appointment_reminder' and n.status = 'sent'
                and n.sent_at >= w.m_from_at and n.sent_at < w.m_to_at)::int as reminders,
            (select count(*) from clients c, w
              where c.business_id = $1 and c.created_at >= w.m_from_at and c.created_at < w.m_to_at
                and c.source <> 'import' and ${countsForPlanSql("c")})::int as "newClients",
            (select count(*) from payment_receipts r, w
              where r.business_id = $1 and r.status = 'ready' and r.created_at >= w.m_from_at and r.created_at < w.m_to_at)::int as receipts`,
    [businessId, month.from, month.to, month.previousFrom, timezone],
  ))!;
}

/**
 * El informe de un negocio en esta pasada del cron. Sale si el negocio está activo, tiene propietario y el informe
 * encendido, es del día 1 al MONTHLY_REPORT_LAST_DAY desde las MONTHLY_REPORT_HOUR de su hora, no salió ya este mes
 * (la clave `monthly-report:<negocio>:<AAAA-MM>`) y el mes tuvo citas. Devuelve 1 si lo puso en la cola.
 */
export async function runMonthlyReportJob(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const business = await one<Business>(db, `select ${businessColumns()} from businesses where id = $1`, [businessId]);
  if (!business || business.status !== "active" || !business.ownerId || business.notificationSettings.monthlyReport === false) return 0;
  const now = getZonedNow(business.timezone, at);
  if (Number(now.date.slice(8, 10)) > MONTHLY_REPORT_LAST_DAY || now.minutes < MONTHLY_REPORT_HOUR * 60) return 0;

  const month = previousMonthOf(now.date);
  const dedupeKey = `monthly-report:${businessId}:${month.key}`;
  // Antes de contar nada: el cron pasa cada 10 minutos toda la semana.
  if (await one(db, "select 1 from notifications where dedupe_key = $1", [dedupeKey])) return 0;
  const stats = await monthStats(db, businessId, business.timezone, month);
  if (stats.appointments === 0) return 0;

  const owner = await one<{ firstName: string; email: string; referralCode: string | null }>(
    db,
    `select u.first_name as "firstName", u.email, b.referral_code as "referralCode"
       from businesses b join users u on u.id = b.owner_id where b.id = $1`,
    [businessId],
  );
  if (!owner?.email) return 0;
  const content = emailTemplates.monthlyReport({
    ...stats,
    firstName: owner.firstName,
    businessName: business.name,
    month: month.from,
    currency: business.currency,
    reportsUrl: `${appOrigin()}/dashboard/reports`,
    referralUrl: owner.referralCode ? referralLink(owner.referralCode) : null,
  });
  const queued = await queueEmail(db, { businessId, type: "monthly_report", to: owner.email, dedupeKey, ...content });
  return queued ? 1 : 0;
}
