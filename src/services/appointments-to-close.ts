import { appointmentColumns } from "../db/columns.ts";
import { many, one, pool, transaction, type Db } from "../db/pool.ts";
import { OPEN_STATUSES, TO_CLOSE_PAGE_SIZE } from "../shared/lib/constants/appointment-status.ts";
import { closeAllSchema, toCloseQuerySchema } from "../shared/lib/validations/appointment.ts";
import type {
  Appointment,
  AppointmentToClose,
  AppointmentsToClose,
  AppointmentsToCloseCount,
  CloseAllResult,
} from "../shared/types/index.ts";
import { agendaScope } from "./agenda-scope.ts";
import { changeAppointmentStatus } from "./business-data-service.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";

/**
 * Citas por cerrar (spec 018): las que ya terminaron, en la hora del negocio, y siguen Pendiente o
 * Confirmada. Las de días anteriores (antes de hoy en la zona del negocio) bloquean el panel de quien
 * puede cerrarlas hasta que las cierre o pulse «Más tarde»; las de hoy salen en la lista, pero no
 * bloquean. Cada uno ve lo suyo (agendaScope): el rol Profesional, su agenda; el propietario, los
 * administradores, Recepción y el super admin en modo soporte, todo el negocio. Nada se cierra solo.
 *
 * Desde la spec 021, las de un mes anterior al de hoy (también en la zona del negocio) se cuentan aparte
 * (`previousMonth`): con alguna, el panel se bloquea sin «Más tarde» hasta cerrarlas, para que los datos de
 * cada mes sean reales. El alcance por rol es el mismo.
 */

/** 'pending', 'confirmed': los estados de una cita sin cerrar, en SQL (constantes, no datos del usuario). */
const OPEN_SQL = [...OPEN_STATUSES].map((status) => `'${status}'`).join(", ");

/**
 * La zona del negocio ($1), el momento de la consulta, su «hoy» y el primer día de su mes. `at`: el momento
 * (por defecto, ahora; las pruebas lo fijan para no depender del día en que corren).
 */
const zoneCte = (at = "now()") =>
  `zone as (
     select b.timezone, ${at} as now, (${at} at time zone b.timezone)::date as today,
            date_trunc('month', ${at} at time zone b.timezone)::date as month_start
       from businesses b where b.id = $1)`;
const ZONE_CTE = zoneCte();

/**
 * La cita `a` del negocio ($1) ya terminó y sigue sin cerrar; $2: la agenda del rol Profesional o null.
 * `a.date <= zone.today` deja usar el índice (business_id, date); el fin se compara como instante en la
 * zona del negocio (una cita que termina a las 24:00 termina a la medianoche).
 */
const TO_CLOSE_SQL = `a.business_id = $1
    and a.status in (${OPEN_SQL})
    and a.date <= zone.today
    and ((a.date + a.end_time) at time zone zone.timezone) <= zone.now
    and ($2::uuid is null or a.professional_id = $2::uuid)`;

/** Los pacientes de la cita `a`: el principal primero y después los demás, en su orden (como extraClientIds). */
const CLIENT_NAMES_SQL = `array(
    select c.name
      from (select a.client_id as id, 0 as position, null::timestamptz as added_at
            union all
            select ac.client_id, 1, ac.created_at from appointment_clients ac where ac.appointment_id = a.id) x
      join clients c on c.id = x.id
     order by x.position, x.added_at, x.id)`;

/** Quién pregunta y qué parte del negocio ve. */
async function scopeOf(db: Db, ctx: RequestContext, businessId: string, lock = false) {
  const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock });
  const { professionalId } = await agendaScope(db, actor, businessId);
  return { actor, professionalId };
}

/**
 * Cuántas hay por cerrar: las de días anteriores y las de hoy que ya terminaron y, de las de días
 * anteriores, las de un mes anterior (spec 021). `at` (ISO): el momento de la consulta, sólo para las
 * pruebas; por defecto, ahora.
 */
export async function countToClose(db: Db, businessId: string, professionalId: string | null, at?: string): Promise<Required<AppointmentsToCloseCount>> {
  const row = await one<Required<AppointmentsToCloseCount>>(
    db,
    `with ${at ? zoneCte("$3::timestamptz") : ZONE_CTE}
     select count(*) filter (where a.date < zone.today)::int as overdue,
            count(*) filter (where a.date = zone.today)::int as today,
            count(*) filter (where a.date < zone.month_start)::int as "previousMonth"
       from zone join appointments a on ${TO_CLOSE_SQL}`,
    at ? [businessId, professionalId, at] : [businessId, professionalId],
  );
  return { overdue: row?.overdue ?? 0, today: row?.today ?? 0, previousMonth: row?.previousMonth ?? 0 };
}

/** "2026-10-14|09:30|<id>" → sus tres partes; sin cursor, la primera tanda. */
function parseCursor(cursor: string | undefined): [string | null, string | null, string | null] {
  if (!cursor) return [null, null, null];
  const [date, time, id] = cursor.split("|");
  return [date, time, id];
}

export const appointmentsToCloseService = {
  /**
   * El contador del panel (GET …/appointments/to-close/count): una consulta con el índice, sin nombres.
   * Lo pide el panel al entrar, al volver a la pestaña y cada 3 minutos con la pestaña visible, junto con
   * la campana. Consultar no va a la actividad. Desde la spec 021 trae también `previousMonth`.
   */
  async count(ctx: RequestContext, businessId: string): Promise<AppointmentsToCloseCount> {
    const { professionalId } = await scopeOf(pool, ctx, businessId);
    return countToClose(pool, businessId, professionalId);
  },

  /**
   * La lista «Por cerrar» (GET …/appointments/to-close?cursor=): de la más vieja a la más nueva (las de
   * meses anteriores primero, después las de días anteriores y las de hoy), en tandas de
   * TO_CLOSE_PAGE_SIZE, con las cifras de toda la lista y lo que se ve en la agenda (pacientes, servicio y
   * profesional). Cada fila dice si es de un día anterior (`overdue`) y de un mes anterior (`previousMonth`).
   */
  async list(ctx: RequestContext, businessId: string, query: Record<string, unknown>): Promise<AppointmentsToClose> {
    const clean = Object.fromEntries(Object.entries(query).filter(([, value]) => typeof value === "string" && value !== ""));
    const filters = parseInput(toCloseQuerySchema, clean);
    const { professionalId } = await scopeOf(pool, ctx, businessId);
    const [cursorDate, cursorTime, cursorId] = parseCursor(filters.cursor);
    const rows = await many<AppointmentToClose>(
      pool,
      `with ${ZONE_CTE}
       select a.id, a.date, a.start_time as "startTime", a.end_time as "endTime", a.status,
              a.professional_id as "professionalId", ${CLIENT_NAMES_SQL} as "clientNames",
              s.name as "serviceName", p.display_name as "professionalName", a.date < zone.today as overdue,
              a.date < zone.month_start as "previousMonth"
         from zone
         join appointments a on ${TO_CLOSE_SQL}
         join services s on s.id = a.service_id
         join professionals p on p.id = a.professional_id
        where ($3::date is null or (a.date, a.start_time, a.id) > ($3::date, $4::time, $5::uuid))
        order by a.date, a.start_time, a.id
        limit $6`,
      [businessId, professionalId, cursorDate, cursorTime, cursorId, TO_CLOSE_PAGE_SIZE + 1],
    );
    const page = rows.slice(0, TO_CLOSE_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      appointments: page,
      ...(await countToClose(pool, businessId, professionalId)),
      nextCursor: rows.length > TO_CLOSE_PAGE_SIZE && last ? `${last.date}|${last.startTime}|${last.id}` : null,
    };
  },

  /**
   * «Marcar todas como completadas» (POST …/appointments/close-all): las citas que se ven en la lista, en
   * una transacción. Sólo cierra las de quien llama que siguen por cerrar: las que otra persona ya cerró
   * (o que no son de su agenda) no se tocan y vuelven en `skipped`. Cada una queda en la actividad como un
   * cambio de estado normal; al paciente sólo se le escribe con `notify` (por defecto, no).
   */
  async closeAll(ctx: RequestContext, businessId: string, input: unknown): Promise<CloseAllResult> {
    const data = parseInput(closeAllSchema, input);
    return transaction(async (db) => {
      // Con la fila del negocio bloqueada, como cada cambio de estado: dos cierres a la vez van uno detrás de otro.
      const { actor, professionalId } = await scopeOf(db, ctx, businessId, true);
      const open = await many<Appointment>(
        db,
        `with ${ZONE_CTE}
         select ${appointmentColumns("a")}
           from zone join appointments a on ${TO_CLOSE_SQL}
          where a.id = any($3::uuid[])
          order by a.date, a.start_time, a.id
          for update of a`,
        [businessId, professionalId, data.ids],
      );
      for (const before of open) await changeAppointmentStatus(db, actor, before, data.status, data.notify);
      return { closed: open.length, skipped: data.ids.length - open.length };
    });
  },
};
