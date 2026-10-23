import { z } from "zod";
import { many, pool } from "../db/pool.ts";
import { daysBetween } from "../shared/lib/time.ts";
import type { AdminCalendar, AdminCalendarBusiness, AdminCalendarDay, AdminCalendarDayTotals, AdminCalendarHourTotals } from "../shared/types/index.ts";
import { authorizeSuperAdmin, parseInput, type RequestContext } from "./context.ts";

/**
 * El calendario de la plataforma (spec 035): cuántas citas hay cada día y cada hora, en qué negocios, en
 * qué estado y de qué agenda. Sólo los negocios activos, como la Analítica.
 *
 * Privacidad (constitución, principio II): el super admin no tiene un calendario con las citas de los
 * negocios. Estas consultas sólo devuelven cuentas: nunca leen `clients`, `services` ni las notas, ni
 * devuelven el identificador o la hora exacta de una cita. Las citas de un negocio se ven en modo soporte.
 *
 * Se calcula al abrir la página: un rango corto (MAX_DAYS) sobre el índice (business_id, date).
 */

/** Lo más largo que se pide de una vez: las 6 semanas de la vista Mes. */
export const MAX_DAYS = 42;

const filters = {
  category: z.string().trim().min(1).max(64).optional(),
  businessId: z.uuid({ error: "El negocio no es válido." }).optional(),
};

const rangeSchema = z
  .object({ from: z.iso.date({ error: "La fecha de inicio no es válida." }), to: z.iso.date({ error: "La fecha final no es válida." }), ...filters })
  .refine(({ from, to }) => daysBetween(from, to) >= 0 && daysBetween(from, to) < MAX_DAYS, `El calendario muestra como mucho ${MAX_DAYS} días.`);

const daySchema = z.object({
  date: z.iso.date({ error: "La fecha no es válida." }),
  hour: z.coerce.number().int().min(0).max(23, { error: "La hora va de 0 a 23." }).optional(),
  ...filters,
});

/**
 * Las citas del rango en los negocios activos: sólo las columnas que se cuentan. `past`: de un día ya
 * pasado en la zona del negocio (las que siguen abiertas, «sin cerrar»).
 */
const APPOINTMENTS = `
  select a.date, a.business_id, a.professional_id, a.status, a.source, a.paid_at,
         extract(hour from a.start_time)::int as hour,
         a.date < (now() at time zone b.timezone)::date as past
    from appointments a
    join businesses b on b.id = a.business_id
   where b.status = 'active'
     and ($3::text is null or b.category = $3)
     and ($4::uuid is null or b.id = $4)`;

const OPEN = `status in ('pending', 'confirmed')`;

export const adminCalendarService = {
  /** GET /api/admin/calendar?from&to&category&businessId: los días con citas del rango y sus horas. */
  async getRange(ctx: RequestContext, query: unknown): Promise<AdminCalendar> {
    authorizeSuperAdmin(ctx);
    const { from, to, category, businessId } = parseInput(rangeSchema, query);
    const params = [from, to, category ?? null, businessId ?? null];
    const [days, hours] = await Promise.all([
      many<AdminCalendarDayTotals>(
        pool,
        `with a as (${APPOINTMENTS} and a.date between $1 and $2)
         select date,
                count(*) filter (where status <> 'cancelled')::int as appointments,
                count(*) filter (where status = 'cancelled')::int as cancelled,
                count(*) filter (where past and ${OPEN})::int as unclosed,
                count(distinct business_id) filter (where status <> 'cancelled')::int as businesses
           from a
          group by date
          order by date`,
        params,
      ),
      many<AdminCalendarHourTotals>(
        pool,
        `with a as (${APPOINTMENTS} and a.date between $1 and $2)
         select date, hour, count(*)::int as appointments
           from a
          where status <> 'cancelled'
          group by date, hour
          order by date, hour`,
        params,
      ),
    ]);
    return { from, to, days, hours };
  },

  /**
   * GET /api/admin/calendar/day?date&hour&category&businessId: cada negocio con citas ese día (o a esa
   * hora), sus citas por estado y las de cada agenda.
   */
  async getDay(ctx: RequestContext, query: unknown): Promise<AdminCalendarDay> {
    authorizeSuperAdmin(ctx);
    const { date, hour, category, businessId } = parseInput(daySchema, query);
    const businesses = await many<AdminCalendarBusiness>(
      pool,
      `with a as (${APPOINTMENTS} and a.date = $1 and ($2::int is null or extract(hour from a.start_time) = $2)),
       per_business as (
         select business_id,
                count(*) filter (where status <> 'cancelled')::int as appointments,
                json_build_object(
                  'pending', count(*) filter (where status = 'pending'),
                  'confirmed', count(*) filter (where status = 'confirmed'),
                  'completed', count(*) filter (where status = 'completed' and paid_at is null),
                  'paid', count(*) filter (where status = 'completed' and paid_at is not null),
                  'noShow', count(*) filter (where status = 'no_show'),
                  'cancelled', count(*) filter (where status = 'cancelled')
                ) as counts,
                count(*) filter (where status <> 'cancelled' and source = 'booking_page')::int as online,
                count(*) filter (where past and ${OPEN})::int as unclosed
           from a
          group by business_id
       ),
       per_professional as (
         select x.business_id,
                json_agg(json_build_object('id', p.id, 'name', p.display_name, 'appointments', x.appointments)
                         order by x.appointments desc, p.display_name) as professionals
           from (select business_id, professional_id, count(*)::int as appointments
                   from a
                  where status <> 'cancelled'
                  group by business_id, professional_id) x
           join professionals p on p.id = x.professional_id
          group by x.business_id
       )
       select b.id, b.name, coalesce(c.name, b.category, '') as "categoryName",
              pb.appointments, pb.counts, pb.online, pb.unclosed,
              coalesce(pp.professionals, '[]'::json) as professionals
         from per_business pb
         join businesses b on b.id = pb.business_id
         left join business_categories c on c.id = b.category
         left join per_professional pp on pp.business_id = pb.business_id
        order by pb.appointments desc, b.name`,
      [date, hour ?? null, category ?? null, businessId ?? null],
    );
    return { date, hour: hour ?? null, businesses };
  },
};

