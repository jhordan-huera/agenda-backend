import { z } from "zod";
import { many, one, pool, type Db } from "../db/pool.ts";
import { DEFAULT_TIMEZONE } from "../shared/lib/constants/app.ts";
import { getEffectiveLimits, getPlan } from "../shared/lib/constants/plans.ts";
import { getFullName } from "../shared/lib/format.ts";
import { addDaysISO, getZonedNow } from "../shared/lib/time.ts";
import type {
  AdminBusinessAnalytics,
  AnalyticsPeriodDays,
  AnalyticsRateKey,
  AnalyticsSnapshot,
  BusinessAnalytics,
  BusinessStatus,
  CategoryAnalytics,
  DayOfWeek,
  EmailType,
  FeatureKey,
  HealthGroup,
  PlanId,
  PlatformTotals,
  VersusType,
} from "../shared/types/index.ts";
import { authorizeSuperAdmin, parseInput, type RequestContext } from "./context.ts";
import { countsForPlanSql } from "./plan-limits.ts";

/**
 * Analítica del super admin (spec 016). El cron de GitHub prepara cada mañana una «foto» con las cifras
 * de 30 y de 90 días (refreshAnalytics, R1) y la guarda en analytics_snapshots; la página
 * /admin/analytics sólo la lee (getSnapshot): nada se calcula en Vercel.
 *
 * Todo se mide en el periodo [hoy − N días, hoy) y en el anterior de igual duración, en la zona de cada
 * negocio. Las cuentas van en SQL agregado (una consulta por tema, agrupada por negocio, nunca una por
 * negocio); la salud, las oportunidades de venta y las comparaciones con el tipo se arman aquí, con las
 * reglas fijas de abajo.
 *
 * Privacidad (R9): sólo cifras por negocio y por tipo. Los únicos datos personales son el nombre, el
 * teléfono y el email del propietario, que el super admin ya ve en la ficha. Ninguna consulta lee el
 * nombre ni el contacto de un paciente.
 */

/* ---------------------------------------------------------------- Reglas ---- */

/** Los dos periodos que prepara el cron cada mañana. */
export const ANALYTICS_PERIODS: readonly AnalyticsPeriodDays[] = [30, 90];
/** Citas del periodo por debajo de las cuales las tasas de un negocio llevan «pocos datos» (RF-004). */
export const MIN_APPOINTMENTS = 10;
/** Negocios con datos suficientes que necesita un tipo para dar sus medianas (R3). */
export const MIN_CATEGORY_BUSINESSES = 3;
/** «Muy distinto» de su tipo (R3): el doble o más, o la mitad o menos, con 5 puntos de diferencia o más. */
export const VERY_DIFFERENT = { ratio: 2, minPoints: 0.05 } as const;

/**
 * La puntuación de salud (R4), aprobada por el dueño del producto el 2026-10-15. Se parte de 100 y se
 * resta por cada señal; los pesos se ajustan aquí con la experiencia.
 */
export const HEALTH = {
  start: 100,
  /** Nadie del equipo entra: hace más de 14 días, −30; hace entre 7 y 14 días, −15. */
  noLogin: { longAfterDays: 14, long: 30, shortFromDays: 7, short: 15 },
  /** Sin citas en el periodo. */
  noAppointments: 30,
  /** Citas frente al periodo anterior (con 10 o más antes): −50 % o peor, −25; entre −20 % y −50 %, −15. */
  drop: { minPrevious: 10, severe: -0.5, severePoints: 25, moderate: -0.2, moderatePoints: 15 },
  /** Más de 10 citas pasadas sin cerrar (siguen Pendientes o Confirmadas). */
  unclosed: { moreThan: 10, points: 10 },
  /** Ninguna reserva online en el periodo, con la página activa (el negocio no está suspendido). */
  noOnline: 5,
  /** Inasistencias muy por encima de las de su tipo. */
  noShowAboveType: 5,
  /** Grupos: de 70 a 100, sano; de 40 a 69, en riesgo; menos de 40, crítico. */
  groups: { healthy: 70, risk: 40 },
  /** Un negocio de menos de 14 días sólo resta por el último acceso: está empezando. */
  newBusinessDays: 14,
} as const;

/** «Listos para subir de plan» (R5). «Negocios para vender» del Inicio sigue con sus propias reglas. */
export const UPSELL = {
  /** Free: el 80 % del tope de citas del mes o de pacientes (como «Cerca del límite»). */
  nearLimit: 0.8,
  /** Free y Pro: +30 % o más frente al periodo anterior, con 20 citas o más. */
  growth: { min: 0.3, minAppointments: 20 },
  /** Pro: 120 citas o más cada 30 días con una sola agenda. */
  proDemandPer30Days: 120,
} as const;

/** Inasistencias antes y después (R7): 60 días a cada lado, con 20 citas cerradas o más en cada uno. */
export const BEFORE_AFTER = { days: 60, minClosed: 20 } as const;

/** Desde qué hora de Ecuador prepara el cron la foto del día, y cuántos días se guardan las fotos. */
export const SNAPSHOT_HOUR = 6;
export const SNAPSHOT_KEEP_DAYS = 30;

/** Los emails al paciente que llevan el enlace «Tu cita» (y con él «Confirmo que voy»), además del recordatorio. */
const LINK_EMAIL_TYPES: EmailType[] = [
  "appointment_reminder",
  "booking_created",
  "appointment_confirmed",
  "appointment_updated",
  "appointment_pending",
];

const RATE_KEYS: AnalyticsRateKey[] = ["onlineRate", "noShowRate", "cancelRate", "confirmRate"];
const FEATURE_KEYS: FeatureKey[] = [
  "bookingPage",
  "reminders",
  "patientConfirm",
  "series",
  "clientImport",
  "push",
  "bell",
  "clinical",
  "payments",
  "multiAgenda",
];
const NO_CATEGORY = "Sin tipo";
/** Días que la auditoría guarda los inicios de sesión (purge_audit_logs): más allá, «nadie entra hace más de 90 días». */
const SESSION_AUDIT_DAYS = 90;
const DAY_MS = 86_400_000;

/* ---------------------------------------------------------- Consultas SQL ---- */

/**
 * Los periodos de cada negocio, en su zona: $1 es «ahora» (timestamptz) y $2, los días. `cur_*` es el
 * periodo [hoy − N, hoy), `prev_from` el inicio del anterior y `month_*` el mes en curso (el tope del plan).
 * Una zona que no existe (guardada antes de validarlas) cuenta como la de Ecuador: un negocio así no
 * deja sin foto a todos los demás.
 */
const WINDOWS = `zones as materialized (select name from pg_timezone_names),
  win as (
    select x.id, x.timezone, x.today,
           x.today - $2::int as cur_from,
           x.today - 2 * $2::int as prev_from,
           date_trunc('month', x.today)::date as month_from,
           (date_trunc('month', x.today) + interval '1 month')::date as month_to,
           (x.today - $2::int)::timestamp at time zone x.timezone as cur_from_at,
           x.today::timestamp at time zone x.timezone as cur_to_at
      from (select b.id, z.timezone, ($1::timestamptz at time zone z.timezone)::date as today
              from businesses b
             cross join lateral (select coalesce((select zones.name from zones where zones.name = b.timezone), '${DEFAULT_TIMEZONE}') as timezone) z) x
  )`;

interface BaseRow {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryOrder: number | null;
  status: BusinessStatus;
  createdAt: string;
  timezone: string;
  currency: string;
  plan: PlanId;
  maxProfessionals: number | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  teamMembers: number;
  lastTeamLoginAt: string | null;
  agendas: number;
  planClients: number;
}

/** Cada negocio con su propietario, su plan, su equipo (y su último acceso), sus agendas y sus pacientes del tope. */
const baseRows = (db: Db, params: unknown[]) =>
  many<BaseRow>(
    db,
    `with ${WINDOWS},
     team as (
       select bu.business_id, count(*)::int as members, max(l.last_at) as last_at
         from business_users bu
         left join (select actor_id, max(created_at) as last_at from audit_logs
                     where entity_type = 'session' and action = 'session.login' and created_at <= $1::timestamptz
                     group by actor_id) l on l.actor_id = bu.user_id
        group by bu.business_id
     ),
     agendas as (select business_id, count(*)::int as active from professionals where is_active group by business_id),
     plan_clients as (select c.business_id, count(*)::int as clients from clients c where ${countsForPlanSql("c")} group by c.business_id)
     select b.id, b.name, b.category as "categoryId", c.name as "categoryName", c.sort_order as "categoryOrder",
            b.status, b.created_at as "createdAt", w.timezone, b.currency,
            coalesce(s.plan, 'free') as plan, s.max_professionals as "maxProfessionals",
            o.first_name as "ownerFirstName", o.last_name as "ownerLastName", o.phone as "ownerPhone", o.email as "ownerEmail",
            coalesce(t.members, 0) as "teamMembers", t.last_at as "lastTeamLoginAt",
            coalesce(ag.active, 0) as agendas, coalesce(pc.clients, 0) as "planClients"
       from businesses b
       join win w on w.id = b.id
       left join subscriptions s on s.business_id = b.id
       left join users o on o.id = b.owner_id
       left join business_categories c on c.id = b.category
       left join team t on t.business_id = b.id
       left join agendas ag on ag.business_id = b.id
       left join plan_clients pc on pc.business_id = b.id
      order by b.name, b.id`,
    params,
  );

interface AppointmentRow {
  businessId: string;
  appointments: number;
  previous: number;
  total: number;
  online: number;
  onlineAny: number;
  cancelled: number;
  completed: number;
  noShow: number;
  unclosed: number;
  reached: number;
  confirmedReached: number;
  confirmations: number;
  revenue: number;
  pricedCompleted: number;
  collected: number;
  payments: boolean;
  monthAppointments: number;
}

/** Las citas del periodo, del anterior y del mes en curso, contadas por negocio en una sola pasada. */
const appointmentRows = (db: Db, params: unknown[]) =>
  many<AppointmentRow>(
    db,
    `with ${WINDOWS},
     reached as (
       select distinct n.appointment_id from notifications n
        where n.status = 'sent' and n.type = any($3::text[]) and n.appointment_id is not null
     ),
     a as (
       select a.business_id, a.status, a.source, a.price, a.paid_at, a.receipt_at, a.client_confirmed_at,
              a.date >= w.cur_from and a.date < w.today as cur,
              a.date >= w.prev_from and a.date < w.cur_from as prev,
              a.date >= w.month_from and a.date < w.month_to as month,
              r.appointment_id is not null as reached
         from appointments a
         join win w on w.id = a.business_id
         left join reached r on r.appointment_id = a.id
        where a.date >= least(w.prev_from, w.month_from) and a.date < greatest(w.today, w.month_to)
     )
     select business_id as "businessId",
            count(*) filter (where cur and status <> 'cancelled')::int as appointments,
            count(*) filter (where prev and status <> 'cancelled')::int as previous,
            count(*) filter (where cur)::int as total,
            count(*) filter (where cur and status <> 'cancelled' and source = 'booking_page')::int as online,
            count(*) filter (where cur and source = 'booking_page')::int as "onlineAny",
            count(*) filter (where cur and status = 'cancelled')::int as cancelled,
            count(*) filter (where cur and status = 'completed')::int as completed,
            count(*) filter (where cur and status = 'no_show')::int as "noShow",
            count(*) filter (where cur and status in ('pending', 'confirmed'))::int as unclosed,
            count(*) filter (where cur and status <> 'cancelled' and reached)::int as reached,
            count(*) filter (where cur and status <> 'cancelled' and reached and client_confirmed_at is not null)::int as "confirmedReached",
            count(*) filter (where cur and status <> 'cancelled' and client_confirmed_at is not null)::int as confirmations,
            coalesce(sum(price) filter (where cur and status = 'completed'), 0)::float8 as revenue,
            count(*) filter (where cur and status = 'completed' and price > 0)::int as "pricedCompleted",
            coalesce(sum(price) filter (where cur and status <> 'cancelled' and paid_at is not null), 0)::float8 as collected,
            coalesce(bool_or(cur and (paid_at is not null or receipt_at is not null)), false) as payments,
            count(*) filter (where month and status <> 'cancelled')::int as "monthAppointments"
       from a
      group by business_id`,
    [...params, LINK_EMAIL_TYPES],
  );

interface ActivityRow {
  businessId: string;
  activeClients: number;
  newClients: number;
  reminders: number;
  series: number;
  imports: number;
  devices: number;
  noticesRead: number;
  clinicalNotes: number;
  timelyCancellations: number;
}

/**
 * Lo demás de cada negocio en el periodo: pacientes activos y nuevos, recordatorios, series, notas de la
 * historia clínica, avisos leídos y cancelaciones con tiempo; y, en cualquier momento, si importó
 * pacientes y si el propietario tiene un aparato con avisos. Cada parte agrupada por negocio.
 */
const activityRows = (db: Db, params: unknown[]) =>
  many<ActivityRow>(
    db,
    `with ${WINDOWS},
     active_clients as (
       select x.business_id, count(distinct x.client_id)::int as n
         from (select a.business_id, a.client_id from appointments a join win w on w.id = a.business_id
                where a.status <> 'cancelled' and a.date >= w.cur_from and a.date < w.today
               union all
               select a.business_id, ac.client_id from appointment_clients ac
                 join appointments a on a.id = ac.appointment_id join win w on w.id = a.business_id
                where a.status <> 'cancelled' and a.date >= w.cur_from and a.date < w.today) x
        group by x.business_id
     ),
     new_clients as (
       select c.business_id, count(*)::int as n from clients c join win w on w.id = c.business_id
        where c.created_at >= w.cur_from_at and c.created_at < w.cur_to_at and c.source <> 'import' and ${countsForPlanSql("c")}
        group by c.business_id
     ),
     reminders as (
       select n.business_id, count(*)::int as n from notifications n join win w on w.id = n.business_id
        where n.type = 'appointment_reminder' and n.status = 'sent' and n.sent_at >= w.cur_from_at and n.sent_at < w.cur_to_at
        group by n.business_id
     ),
     series as (
       select s.business_id, count(*)::int as n from appointment_series s join win w on w.id = s.business_id
        where s.created_at >= w.cur_from_at and s.created_at < w.cur_to_at
        group by s.business_id
     ),
     imports as (
       select business_id, count(*)::int as n from audit_logs
        where entity_type = 'client' and action = 'client.imported' and business_id is not null
        group by business_id
     ),
     devices as (
       select b.id as business_id, count(*)::int as n from businesses b join push_subscriptions ps on ps.user_id = b.owner_id
        where ps.signed_out_at is null
        group by b.id
     ),
     notices_read as (
       select x.business_id, count(*)::int as n
         from (select pn.business_id from panel_notice_reads r
                 join panel_notices pn on pn.id = r.notice_id join win w on w.id = pn.business_id
                where r.read_at >= w.cur_from_at and r.read_at < w.cur_to_at
               union all
               select bu.business_id from panel_notice_state st
                 join business_users bu on bu.user_id = st.user_id join win w on w.id = bu.business_id
                where st.read_all_at >= w.cur_from_at and st.read_all_at < w.cur_to_at) x
        group by x.business_id
     ),
     clinical as (
       select cn.business_id, count(*)::int as n from clinical_notes cn join win w on w.id = cn.business_id
        where cn.created_at >= w.cur_from_at and cn.created_at < w.cur_to_at
        group by cn.business_id
     ),
     cancellations as (
       select l.entity_id, max(l.created_at) as at from audit_logs l
        where l.entity_type = 'appointment' and l.action in ('appointment.cancelled', 'appointment.client_cancelled')
        group by l.entity_id
     ),
     timely as (
       select a.business_id, count(*)::int as n
         from appointments a join win w on w.id = a.business_id join cancellations k on k.entity_id = a.id
        where a.status = 'cancelled' and a.date >= w.cur_from and a.date < w.today
          and k.at <= ((a.date + a.start_time) at time zone w.timezone) - interval '24 hours'
        group by a.business_id
     )
     select w.id as "businessId",
            coalesce(ac.n, 0) as "activeClients", coalesce(nc.n, 0) as "newClients", coalesce(re.n, 0) as reminders,
            coalesce(se.n, 0) as series, coalesce(im.n, 0) as imports, coalesce(de.n, 0) as devices,
            coalesce(nr.n, 0) as "noticesRead", coalesce(cl.n, 0) as "clinicalNotes", coalesce(ti.n, 0) as "timelyCancellations"
       from win w
       left join active_clients ac on ac.business_id = w.id
       left join new_clients nc on nc.business_id = w.id
       left join reminders re on re.business_id = w.id
       left join series se on se.business_id = w.id
       left join imports im on im.business_id = w.id
       left join devices de on de.business_id = w.id
       left join notices_read nr on nr.business_id = w.id
       left join clinical cl on cl.business_id = w.id
       left join timely ti on ti.business_id = w.id`,
    params,
  );

interface BeforeAfterRow {
  businessId: string;
  since: string;
  beforeClosed: number;
  beforeNoShow: number;
  afterClosed: number;
  afterNoShow: number;
}

/**
 * Inasistencias antes y después de empezar con los recordatorios o «Confirmo que voy» (R7): la fecha de
 * partida es lo primero que llegó, y se cuentan las citas cerradas (atendidas o no asistió) de los 60
 * días anteriores y de los 60 posteriores (sólo las ya pasadas).
 */
const beforeAfterRows = (db: Db, params: unknown[]) =>
  many<BeforeAfterRow>(
    db,
    `with ${WINDOWS},
     first_reminder as (
       select business_id, min(sent_at) as at from notifications
        where type = 'appointment_reminder' and status = 'sent' and business_id is not null
        group by business_id
     ),
     first_confirm as (
       select business_id, min(client_confirmed_at) as at from appointments where client_confirmed_at is not null group by business_id
     ),
     starts as (
       select w.id, w.today, (least(fr.at, fc.at) at time zone w.timezone)::date as since
         from win w
         left join first_reminder fr on fr.business_id = w.id
         left join first_confirm fc on fc.business_id = w.id
        where coalesce(fr.at, fc.at) is not null
     )
     select s.id as "businessId", to_char(s.since, 'YYYY-MM-DD') as since,
            count(a.id) filter (where a.date < s.since and a.status in ('completed', 'no_show'))::int as "beforeClosed",
            count(a.id) filter (where a.date < s.since and a.status = 'no_show')::int as "beforeNoShow",
            count(a.id) filter (where a.date >= s.since and a.status in ('completed', 'no_show'))::int as "afterClosed",
            count(a.id) filter (where a.date >= s.since and a.status = 'no_show')::int as "afterNoShow"
       from starts s
       left join appointments a
         on a.business_id = s.id and a.date >= s.since - $3::int and a.date < least(s.since + $3::int, s.today)
      group by s.id, s.since`,
    [...params, BEFORE_AFTER.days],
  );

export interface DemandRow {
  categoryId: string | null;
  day: number | null;
  hour: number | null;
  appointments: number;
}

/** La demanda de cada tipo (sólo negocios activos): citas del periodo por día de la semana y por hora de inicio. */
const demandRows = (db: Db, params: unknown[]) =>
  many<DemandRow>(
    db,
    `with ${WINDOWS},
     a as (
       select b.category, extract(dow from a.date)::int as day, extract(hour from a.start_time)::int as hour
         from appointments a join win w on w.id = a.business_id join businesses b on b.id = a.business_id
        where b.status = 'active' and a.status <> 'cancelled' and a.date >= w.cur_from and a.date < w.today
     )
     select category as "categoryId", case when grouping(day) = 0 then day end as day,
            case when grouping(hour) = 0 then hour end as hour, count(*)::int as appointments
       from a
      group by grouping sets ((category, day), (category, hour))`,
    params,
  );

/* ------------------------------------------------------------ Cálculos ---- */

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const ratio = (part: number, whole: number) => (whole > 0 ? round(part / whole) : null);
const percent = (value: number) => Math.round(Math.abs(value) * 100);
/** «+45 %», «−40 %» (con el signo menos de verdad). */
const signedPercent = (value: number) => `${value < 0 ? "−" : "+"}${percent(value)} %`;

/** La mediana (null sin valores). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

/** Una tasa frente a la de su tipo (R3): el doble o la mitad, con al menos 5 puntos de diferencia. */
export function compareWithType(value: number | null, typical: number | null): VersusType {
  if (value === null || typical === null) return null;
  // Redondeado como las tasas: 0,08 − 0,03 da 0,0499999… en coma flotante y son 5 puntos.
  const gap = round(value - typical);
  if (round(value - typical * VERY_DIFFERENT.ratio) >= 0 && gap >= VERY_DIFFERENT.minPoints) return "above";
  if (round(typical / VERY_DIFFERENT.ratio - value) >= 0 && -gap >= VERY_DIFFERENT.minPoints) return "below";
  return "similar";
}

/** Lo que necesita la puntuación de salud de un negocio. */
export interface HealthInput {
  periodDays: number;
  /** Días desde el alta del negocio. */
  ageDays: number;
  status: BusinessStatus;
  teamMembers: number;
  /** Días desde el último acceso del equipo; null: nadie entró en los 90 días que guarda la auditoría. */
  daysSinceLogin: number | null;
  appointments: number;
  previousAppointments: number;
  growth: number | "new";
  unclosed: number;
  online: number;
  noShowRate: number | null;
  noShowVersusType: VersusType;
  typeNoShowRate: number | null;
}

/** El grupo de una puntuación (R4). */
export const healthGroupOf = (score: number): HealthGroup =>
  score >= HEALTH.groups.healthy ? "healthy" : score >= HEALTH.groups.risk ? "risk" : "critical";

/** La puntuación de salud de 0 a 100 (R4), con su grupo y sus motivos en palabras, en el orden de las reglas. */
export function scoreHealth(input: HealthInput): BusinessAnalytics["health"] {
  const penalties: { points: number; reason: string }[] = [];
  const { noLogin, drop, unclosed } = HEALTH;
  if (input.daysSinceLogin === null) {
    penalties.push({
      points: noLogin.long,
      reason:
        input.teamMembers === 0
          ? "Sin equipo: nadie entra al panel"
          : input.ageDays < SESSION_AUDIT_DAYS
            ? "Nadie del equipo ha entrado todavía"
            : `Nadie del equipo entra hace más de ${SESSION_AUDIT_DAYS} días`,
    });
  } else if (input.daysSinceLogin > noLogin.longAfterDays) {
    penalties.push({ points: noLogin.long, reason: `Nadie del equipo entra hace ${input.daysSinceLogin} días` });
  } else if (input.daysSinceLogin >= noLogin.shortFromDays) {
    penalties.push({ points: noLogin.short, reason: `Nadie del equipo entra hace ${input.daysSinceLogin} días` });
  }
  // Un negocio que está empezando sólo resta por el último acceso.
  if (input.ageDays >= HEALTH.newBusinessDays) {
    if (input.appointments === 0) {
      penalties.push({ points: HEALTH.noAppointments, reason: `Sin citas en los últimos ${input.periodDays} días` });
    }
    if (typeof input.growth === "number" && input.previousAppointments >= drop.minPrevious && input.growth <= drop.moderate) {
      penalties.push({
        points: input.growth <= drop.severe ? drop.severePoints : drop.moderatePoints,
        reason: `Citas ${signedPercent(input.growth)} frente al periodo anterior`,
      });
    }
    if (input.unclosed > unclosed.moreThan) {
      penalties.push({ points: unclosed.points, reason: `${input.unclosed} citas sin cerrar` });
    }
    if (input.online === 0 && input.status === "active") {
      penalties.push({ points: HEALTH.noOnline, reason: "Sin reservas online" });
    }
    if (input.noShowVersusType === "above" && input.noShowRate !== null && input.typeNoShowRate !== null) {
      penalties.push({
        points: HEALTH.noShowAboveType,
        reason: `Inasistencias ${percent(input.noShowRate)} %, su tipo ${percent(input.typeNoShowRate)} %`,
      });
    }
  }
  const score = Math.max(0, HEALTH.start - penalties.reduce((total, penalty) => total + penalty.points, 0));
  return { score, group: healthGroupOf(score), reasons: penalties.map((penalty) => penalty.reason) };
}

/** Por qué un negocio está listo para subir de plan (R5); vacío si no lo está. */
export function upsellReasons(
  business: Pick<BusinessAnalytics, "plan" | "planUsage" | "growth" | "appointments" | "agendas">,
  periodDays: number,
): string[] {
  const reasons: string[] = [];
  const { appointments: monthly, clients, users } = business.planUsage;
  if (business.plan === "free") {
    if (monthly.limit !== null && monthly.used >= monthly.limit * UPSELL.nearLimit) {
      reasons.push(`Usó ${monthly.used} de ${monthly.limit} citas del mes`);
    }
    if (clients.limit !== null && clients.used >= clients.limit * UPSELL.nearLimit) {
      reasons.push(`Tiene ${clients.used} de ${clients.limit} pacientes`);
    }
  }
  if (
    (business.plan === "free" || business.plan === "pro") &&
    typeof business.growth === "number" &&
    business.growth >= UPSELL.growth.min &&
    business.appointments >= UPSELL.growth.minAppointments
  ) {
    reasons.push(`Citas ${signedPercent(business.growth)} frente al periodo anterior`);
  }
  if (business.plan === "pro") {
    if (users.limit !== null && users.used >= users.limit) reasons.push(`Equipo completo: ${users.used} de ${users.limit} usuarios`);
    if (business.agendas.active <= 1 && (business.appointments * 30) / periodDays >= UPSELL.proDemandPer30Days) {
      reasons.push(`Mucha demanda para una agenda: ${business.appointments} citas en ${periodDays} días`);
    }
  }
  if (business.plan === "business" && business.agendas.contracted !== null && business.agendas.active >= business.agendas.contracted) {
    reasons.push(
      business.agendas.contracted === 1 ? "Usa su única agenda contratada" : `Usa sus ${business.agendas.contracted} agendas contratadas`,
    );
  }
  return reasons;
}

/** Los 3 con más citas, de mayor a menor (a igualdad, el primero de la semana o del día): [valor, citas]. */
const top3 = (counts: Map<number, number>) => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3);

/**
 * Los tipos de negocio (R3) a partir de las cifras de cada negocio: cuántos activos tiene cada uno, las
 * medianas de los que tienen datos suficientes (con menos de 3, «pocos datos») y su demanda. Los
 * suspendidos no cuentan. Con ellos, buildSnapshot compara cada negocio con su tipo y calcula su salud.
 */
export function buildCategories(
  businesses: BusinessAnalytics[],
  demand: DemandRow[],
  order: Map<string | null, number> = new Map(),
): CategoryAnalytics[] {
  const groups = new Map<string | null, { name: string; members: BusinessAnalytics[] }>();
  for (const business of businesses) {
    if (business.status !== "active") continue;
    const group = groups.get(business.category.id) ?? { name: business.category.name, members: [] };
    group.members.push(business);
    groups.set(business.category.id, group);
  }
  const known = new Set(groups.keys());
  return [...groups.entries()]
    .map(([id, { name, members }]): CategoryAnalytics => {
      const withData = members.filter((business) => !business.fewData);
      const fewData = withData.length < MIN_CATEGORY_BUSINESSES;
      const medianOf = (pick: (business: BusinessAnalytics) => number | null) =>
        fewData ? null : median(withData.map(pick).filter((value): value is number => value !== null));
      const days = new Map<number, number>();
      const hours = new Map<number, number>();
      for (const row of demand) {
        // Un negocio cuyo tipo ya no existe va en «Sin tipo», también en la demanda.
        const rowCategory = row.categoryId !== null && known.has(row.categoryId) ? row.categoryId : null;
        if (rowCategory !== id) continue;
        if (row.day !== null) days.set(row.day, (days.get(row.day) ?? 0) + row.appointments);
        if (row.hour !== null) hours.set(row.hour, (hours.get(row.hour) ?? 0) + row.appointments);
      }
      return {
        id,
        name,
        businesses: members.length,
        withData: withData.length,
        medians: Object.fromEntries(RATE_KEYS.map((key) => [key, medianOf((business) => business[key])])) as CategoryAnalytics["medians"],
        averageTicket: medianOf((business) => business.averageTicket),
        appointmentsPerAgenda: medianOf((business) => round(business.appointments / Math.max(1, business.agendas.active))),
        topDays: top3(days).map(([day, appointments]) => ({ day: day as DayOfWeek, appointments })),
        topHours: top3(hours).map(([hour, appointments]) => ({ hour, appointments })),
        fewData,
      };
    })
    .sort((a, b) =>
      a.id === null ? 1 : b.id === null ? -1 : (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.name.localeCompare(b.name, "es"),
    );
}

/** Los totales de la plataforma (de todos los negocios) y la adopción de cada función (sólo los activos). */
export function buildPlatform(businesses: BusinessAnalytics[]): PlatformTotals {
  const active = businesses.filter((business) => business.status === "active");
  const sum = (pick: (business: BusinessAnalytics) => number) => businesses.reduce((total, business) => total + pick(business), 0);
  return {
    businesses: { active: active.length, total: businesses.length },
    appointments: sum((business) => business.value.appointments),
    online: sum((business) => business.value.online),
    reminders: sum((business) => business.value.reminders),
    confirmations: sum((business) => business.value.confirmations),
    newClients: sum((business) => business.newClients),
    adoption: Object.fromEntries(
      FEATURE_KEYS.map((key) => {
        const using = active.filter((business) => business.features[key]).length;
        return [key, { businesses: using, rate: ratio(using, active.length) ?? 0 }];
      }),
    ) as PlatformTotals["adoption"],
  };
}

/**
 * Prepara la foto de un periodo con los datos de la base: las cifras de cada negocio (R2), los tipos
 * (R3), la salud (R4), las oportunidades de venta (R5), las funciones (R6) y el valor generado (R7).
 * `now` fija el «hoy» de los periodos (las pruebas lo eligen).
 */
export async function buildSnapshot(days: AnalyticsPeriodDays, now: Date = new Date(), db: Db = pool): Promise<AnalyticsSnapshot> {
  const params = [now.toISOString(), days];
  const [base, appointments, activity, beforeAfter, demand] = await Promise.all([
    baseRows(db, params),
    appointmentRows(db, params),
    activityRows(db, params),
    beforeAfterRows(db, params),
    demandRows(db, params),
  ]);
  const byId = <T extends { businessId: string }>(rows: T[]) => new Map(rows.map((row) => [row.businessId, row]));
  const appointmentsOf = byId(appointments);
  const activityOf = byId(activity);
  const beforeAfterOf = byId(beforeAfter);

  const businesses = base.map((row): BusinessAnalytics => {
    const a = appointmentsOf.get(row.id);
    const act = activityOf.get(row.id);
    const ba = beforeAfterOf.get(row.id);
    const count = (value: number | undefined) => value ?? 0;
    const plan = getPlan(row.plan);
    const limits = getEffectiveLimits(plan, row.maxProfessionals);
    const current = count(a?.appointments);
    const previous = count(a?.previous);
    const ageDays = (now.getTime() - Date.parse(row.createdAt)) / DAY_MS;
    const completed = count(a?.completed);
    const noShow = count(a?.noShow);
    const sideRate = (closed: number, missed: number) => (closed >= BEFORE_AFTER.minClosed ? ratio(missed, closed) : null);
    const noShowBefore = ba ? sideRate(ba.beforeClosed, ba.beforeNoShow) : null;
    const noShowAfter = ba ? sideRate(ba.afterClosed, ba.afterNoShow) : null;
    const hasBeforeAfter = noShowBefore !== null && noShowAfter !== null;
    return {
      id: row.id,
      name: row.name,
      category: row.categoryName === null ? { id: null, name: NO_CATEGORY } : { id: row.categoryId, name: row.categoryName },
      plan: plan.id,
      status: row.status,
      createdAt: row.createdAt,
      timezone: row.timezone,
      currency: row.currency,
      owner:
        row.ownerEmail === null
          ? null
          : { name: getFullName({ firstName: row.ownerFirstName ?? "", lastName: row.ownerLastName ?? "" }), phone: row.ownerPhone ?? "", email: row.ownerEmail },
      appointments: current,
      previousAppointments: previous,
      growth: ageDays < days ? "new" : previous === 0 ? (current > 0 ? "new" : 0) : round((current - previous) / previous),
      onlineRate: ratio(count(a?.online), current),
      noShowRate: ratio(noShow, completed + noShow),
      cancelRate: ratio(count(a?.cancelled), count(a?.total)),
      confirmRate: ratio(count(a?.confirmedReached), count(a?.reached)),
      // Se completan con su tipo (abajo).
      versusType: { onlineRate: null, noShowRate: null, cancelRate: null, confirmRate: null },
      activeClients: count(act?.activeClients),
      newClients: count(act?.newClients),
      estimatedRevenue: round(count(a?.revenue)),
      collected: round(count(a?.collected)),
      averageTicket: a && a.pricedCompleted > 0 ? round(a.revenue / a.pricedCompleted) : null,
      planUsage: {
        appointments: { used: count(a?.monthAppointments), limit: limits.appointmentsPerMonth },
        clients: { used: row.planClients, limit: limits.clients },
        users: { used: row.teamMembers, limit: limits.users },
      },
      agendas: { active: row.agendas, contracted: plan.id === "business" ? row.maxProfessionals : null },
      teamMembers: row.teamMembers,
      lastTeamLoginAt: row.lastTeamLoginAt,
      unclosed: count(a?.unclosed),
      health: { score: HEALTH.start, group: "healthy", reasons: [] },
      upsell: [],
      features: {
        bookingPage: count(a?.onlineAny) > 0,
        reminders: count(act?.reminders) > 0,
        patientConfirm: count(a?.confirmations) > 0,
        series: count(act?.series) > 0,
        clientImport: count(act?.imports) > 0,
        push: count(act?.devices) > 0,
        bell: count(act?.noticesRead) > 0,
        clinical: count(act?.clinicalNotes) > 0,
        payments: Boolean(a?.payments),
        multiAgenda: row.agendas > 1,
      },
      value: {
        appointments: count(a?.total),
        online: count(a?.online),
        reminders: count(act?.reminders),
        confirmations: count(a?.confirmations),
        timelyCancellations: count(act?.timelyCancellations),
        noShowBefore: hasBeforeAfter ? noShowBefore : null,
        noShowAfter: hasBeforeAfter ? noShowAfter : null,
        since: hasBeforeAfter ? ba!.since : null,
      },
      fewData: current < MIN_APPOINTMENTS,
    };
  });

  const order = new Map<string | null, number>(base.map((row) => [row.categoryId, row.categoryOrder ?? 0]));
  const categories = buildCategories(businesses, demand, order);
  const categoryOf = new Map(categories.map((category) => [category.id, category]));
  for (const business of businesses) {
    const type = categoryOf.get(business.category.id);
    const comparable = !business.fewData && type && !type.fewData;
    business.versusType = Object.fromEntries(
      RATE_KEYS.map((key) => [key, comparable ? compareWithType(business[key], type.medians[key]) : null]),
    ) as BusinessAnalytics["versusType"];
    const lastLogin = business.lastTeamLoginAt ? Math.floor((now.getTime() - Date.parse(business.lastTeamLoginAt)) / DAY_MS) : null;
    business.health = scoreHealth({
      periodDays: days,
      ageDays: (now.getTime() - Date.parse(business.createdAt)) / DAY_MS,
      status: business.status,
      teamMembers: business.teamMembers,
      daysSinceLogin: lastLogin,
      appointments: business.appointments,
      previousAppointments: business.previousAppointments,
      growth: business.growth,
      unclosed: business.unclosed,
      online: business.value.online,
      noShowRate: business.noShowRate,
      noShowVersusType: business.versusType.noShowRate,
      typeNoShowRate: type?.medians.noShowRate ?? null,
    });
    business.upsell = upsellReasons(business, days);
  }

  const today = getZonedNow(DEFAULT_TIMEZONE, now).date;
  return {
    computedAt: new Date().toISOString(),
    periodDays: days,
    from: addDaysISO(today, -days),
    to: today,
    businesses,
    categories,
    platform: buildPlatform(businesses),
  };
}

/* ---------------------------------------------------- La foto en la base ---- */

/** Guarda la foto del día `day` (en Ecuador). Si ya había una de ese periodo y día, la reemplaza. */
export async function saveSnapshot(snapshot: AnalyticsSnapshot, day: string, db: Db = pool): Promise<void> {
  await db.query(
    `insert into analytics_snapshots (period_days, day, computed_at, data) values ($1, $2, $3, $4)
     on conflict (period_days, day) do update set computed_at = excluded.computed_at, data = excluded.data`,
    [snapshot.periodDays, day, snapshot.computedAt, snapshot],
  );
}

/** La última foto de ese periodo (null si todavía no hay ninguna). Lee una fila y no calcula nada. */
export async function latestSnapshot(days: AnalyticsPeriodDays, db: Db = pool): Promise<AnalyticsSnapshot | null> {
  const row = await one<{ data: AnalyticsSnapshot }>(
    db,
    "select data from analytics_snapshots where period_days = $1 order by day desc, computed_at desc limit 1",
    [days],
  );
  return row?.data ?? null;
}

/** Borra las fotos de más de 30 días (en Ecuador). Devuelve cuántas. */
export async function cleanupSnapshots(now: Date = new Date(), db: Db = pool): Promise<number> {
  const result = await db.query("delete from analytics_snapshots where day < ($1::timestamptz at time zone $2)::date - $3::int", [
    now.toISOString(),
    DEFAULT_TIMEZONE,
    SNAPSHOT_KEEP_DAYS,
  ]);
  return result.rowCount ?? 0;
}

/** Lo que hizo una pasada del cron con la analítica (para su registro: sólo cifras). */
export interface AnalyticsRefresh {
  /** prepared: preparó la foto de hoy · ready: ya estaba · early: antes de las 06:00 de Ecuador · failed: falló. */
  status: "prepared" | "ready" | "early" | "failed";
  /** Negocios de la foto preparada (null si no preparó ninguna). */
  businesses: number | null;
  /** Fotos de más de 30 días borradas en esta pasada. */
  purged: number;
}

/**
 * La foto de cada mañana (R1): después de las 06:00 de Ecuador, si falta la de hoy de algún periodo, la
 * prepara (30 y 90 días) y borra las de más de 30 días. Una sola vez por día: las demás pasadas del cron
 * ven que ya está. `force` la prepara a cualquier hora y aunque ya exista (npm run analytics:refresh).
 */
export async function refreshAnalytics(options: { now?: Date; force?: boolean } = {}): Promise<AnalyticsRefresh> {
  const now = options.now ?? new Date();
  const zoned = getZonedNow(DEFAULT_TIMEZONE, now);
  if (!options.force && zoned.minutes < SNAPSHOT_HOUR * 60) return { status: "early", businesses: null, purged: 0 };
  const existing = options.force
    ? []
    : await many<{ periodDays: number }>(pool, 'select period_days as "periodDays" from analytics_snapshots where day = $1', [zoned.date]);
  const missing = ANALYTICS_PERIODS.filter((days) => !existing.some((row) => row.periodDays === days));
  if (missing.length === 0) return { status: "ready", businesses: null, purged: 0 };
  let businesses = 0;
  for (const days of missing) {
    const snapshot = await buildSnapshot(days, now);
    await saveSnapshot(snapshot, zoned.date);
    businesses = snapshot.businesses.length;
  }
  return { status: "prepared", businesses, purged: await cleanupSnapshots(now) };
}

/* ------------------------------------------------------------- La API ---- */

const periodSchema = z.enum(["30", "90"], { error: "El periodo de la analítica es de 30 o 90 días." });

/** La parte de un negocio en la última foto de 30 días y su tipo (la tarjeta «Frente a su tipo» de la ficha). */
export async function businessAnalytics(businessId: string, db: Db = pool): Promise<AdminBusinessAnalytics | null> {
  return one<AdminBusinessAnalytics>(
    db,
    `select s.data->>'computedAt' as "computedAt", (s.data->>'periodDays')::int as "periodDays", b.value as business,
            (select c.value from jsonb_array_elements(s.data->'categories') c
              where c.value->'id' = b.value->'category'->'id' limit 1) as category
       from (select data from analytics_snapshots where period_days = 30 order by day desc, computed_at desc limit 1) s
      cross join lateral jsonb_array_elements(s.data->'businesses') b
      where b.value->>'id' = $1`,
    [businessId],
  );
}

export const analyticsService = {
  /** GET /api/admin/analytics?days=30|90: la última foto de ese periodo, o `{ snapshot: null }` si aún no hay. */
  async getSnapshot(ctx: RequestContext, query: { days?: unknown }): Promise<{ snapshot: AnalyticsSnapshot | null }> {
    authorizeSuperAdmin(ctx);
    const days = Number(parseInput(periodSchema, query.days ?? "30")) as AnalyticsPeriodDays;
    return { snapshot: await latestSnapshot(days) };
  },
};
