import { businessColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import {
  CONTROL_EMAIL_DAYS_LATE,
  CONTROL_LIST_DAYS_AHEAD,
  CONTROL_LIST_DAYS_BEHIND,
  CONTROL_SEND_HOUR,
  describeReturnAfter,
} from "../shared/lib/constants/business.ts";
import { emailTemplates } from "../shared/lib/email/templates.ts";
import { addDaysISO, getZonedNow } from "../shared/lib/time.ts";
import type { Business, ControlReminder, ISODate, ISODateTime, PublicControlReminder } from "../shared/types/index.ts";
import { agendaScope } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { PATIENT_LINK_ACTOR } from "./business-data-service.ts";
import { authorize, type RequestContext } from "./context.ts";
import { controlBookUrl, controlReminderUrl, queueEmail } from "./notifications.ts";

/**
 * Recordatorio de control (spec 051). El control no se guarda: sale de la última cita Atendida del paciente (el
 * principal) en cada servicio con «Volver en», más esos días. No sale si el paciente tiene una cita por delante
 * (Pendiente o Confirmada, de cualquier servicio, también como otra persona de la cita), si el equipo lo quitó o si
 * el paciente o el servicio están desactivados. En `control_reminders` queda sólo lo que pasó con él: si se le
 * escribió (con el enlace para no recibir más) o si se quitó.
 *
 * El email: con el interruptor del negocio encendido, desde las 10:00 de su hora del día que vence y hasta 30 días
 * después, una sola vez, nunca por lo que ya había vencido al encender el interruptor o al poner «Volver en», y un solo
 * email si a un paciente le tocan varios el mismo día. Sin copia al profesional: no es un aviso de una cita.
 */

const TOKEN_FORMAT = /^[0-9a-f]{32}$/;
const LINK_NOT_FOUND = "Este enlace no es válido o ya no está disponible.";
const NOT_FOUND = "Ese control ya no está en la lista.";

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

interface ControlRow extends ControlReminder {
  clientEmail: string;
  optedOut: boolean;
  returnAfterDays: number;
  /** Desde cuándo vale el «Volver en» del servicio, en la fecha del negocio (null: sin fecha). */
  serviceSince: ISODate | null;
}

/**
 * Los controles de un negocio en `today` (la fecha del negocio). `dueFrom` y `dueUntil`: sólo los que vencen desde y
 * hasta esos días (null: sin límite). `professionalId`: los de esa agenda (el rol Profesional). `clientId`: los de ese
 * paciente.
 */
async function findControls(
  db: Db,
  businessId: string,
  timezone: string,
  today: ISODate,
  filters: { dueFrom?: ISODate | null; dueUntil?: ISODate | null; professionalId?: string | null; clientId?: string | null },
): Promise<ControlRow[]> {
  return many<ControlRow>(
    db,
    `with latest as (
       select distinct on (a.client_id, a.service_id) a.id, a.client_id, a.service_id, a.professional_id, a.date
         from appointments a
        where a.business_id = $1 and a.status = 'completed'
        order by a.client_id, a.service_id, a.date desc, a.start_time desc
     )
     select l.id as "appointmentId", l.client_id as "clientId", c.name as "clientName", c.phone as "clientPhone",
            c.email as "clientEmail", c.control_reminders_opted_out_at is not null as "optedOut",
            l.service_id as "serviceId", s.name as "serviceName", s.return_after_days as "returnAfterDays",
            to_char((s.return_after_since at time zone $2)::date, 'YYYY-MM-DD') as "serviceSince",
            l.professional_id as "professionalId", p.display_name as "professionalName",
            to_char(l.date, 'YYYY-MM-DD') as "lastDate", to_char(l.date + s.return_after_days, 'YYYY-MM-DD') as "dueOn",
            r.emailed_at as "emailedAt"
       from latest l
       join services s on s.id = l.service_id and s.is_active and s.return_after_days is not null
       join clients c on c.id = l.client_id and c.is_active
       join professionals p on p.id = l.professional_id
       left join control_reminders r on r.appointment_id = l.id
      where r.removed_at is null
        and ($4::date is null or l.date + s.return_after_days <= $4::date)
        and ($7::date is null or l.date + s.return_after_days >= $7::date)
        and ($5::uuid is null or l.professional_id = $5::uuid)
        and ($6::uuid is null or l.client_id = $6::uuid)
        and not exists (
          select 1 from appointments f
           where f.business_id = $1 and f.status in ('pending', 'confirmed') and f.date >= $3::date
             and (f.client_id = l.client_id
                  or exists (select 1 from appointment_clients ac where ac.appointment_id = f.id and ac.client_id = l.client_id)))
      order by l.date + s.return_after_days, c.name, s.name`,
    [businessId, timezone, today, filters.dueUntil ?? null, filters.professionalId ?? null, filters.clientId ?? null, filters.dueFrom ?? null],
  );
}

const toControl = ({ clientEmail: _email, optedOut: _optedOut, returnAfterDays: _days, serviceSince: _since, ...control }: ControlRow) =>
  control as ControlReminder;

/**
 * El envío de un negocio, desde el cron (`queueControlReminders`). `at`: el momento (las pruebas lo mueven). Devuelve
 * cuántos emails quedaron en cola.
 */
export async function runControlReminderJob(db: Db, businessId: string, at: Date = new Date()): Promise<number> {
  const business = await one<Business & { controlRemindersSince: ISODate | null }>(
    db,
    `select ${businessColumns()},
            to_char((control_reminders_since at time zone timezone)::date, 'YYYY-MM-DD') as "controlRemindersSince"
       from businesses where id = $1 and status = 'active'`,
    [businessId],
  );
  if (!business || business.notificationSettings.controlReminders !== true || !business.controlRemindersSince) return 0;
  const now = getZonedNow(business.timezone, at);
  if (now.minutes < CONTROL_SEND_HOUR * 60) return 0;
  const today = now.date;
  const oldest = addDaysISO(today, -CONTROL_EMAIL_DAYS_LATE);
  const since = business.controlRemindersSince;
  const due = (await findControls(db, businessId, business.timezone, today, { dueFrom: oldest, dueUntil: today })).filter(
    (control) =>
      control.emailedAt === null &&
      !control.optedOut &&
      control.clientEmail.trim() !== "" &&
      control.dueOn >= since &&
      control.serviceSince !== null &&
      control.dueOn >= control.serviceSince,
  );
  const byClient = new Map<string, ControlRow[]>();
  for (const control of due) byClient.set(control.clientId, [...(byClient.get(control.clientId) ?? []), control]);

  let queued = 0;
  for (const [clientId, controls] of byClient) {
    const sent: { control: ControlRow; token: string }[] = [];
    for (const control of controls) {
      // Una sola vez: si otra pasada ya lo escribió (o el equipo lo quitó entretanto), no se repite.
      const row = await one<{ token: string }>(
        db,
        `insert into control_reminders (business_id, appointment_id, client_id, service_id, emailed_at)
         values ($1, $2, $3, $4, $5::timestamptz)
         on conflict (appointment_id) do update set emailed_at = excluded.emailed_at
           where control_reminders.emailed_at is null and control_reminders.removed_at is null
         returning token`,
        [businessId, control.appointmentId, clientId, control.serviceId, at.toISOString()],
      );
      if (row) sent.push({ control, token: row.token });
    }
    if (sent.length === 0) continue;
    const [first] = sent;
    const ok = await queueEmail(db, {
      businessId,
      type: "control_reminder",
      to: first.control.clientEmail,
      appointmentId: first.control.appointmentId,
      // La cita del primer control: cada control se escribe una sola vez (control_reminders), así que la clave no se
      // repite. Con «paciente y día», un segundo control del mismo día en otra pasada quedaba marcado sin email
      // (revisión del EGM, 2026-11-16).
      dedupeKey: `control:${first.control.appointmentId}`,
      ...emailTemplates.controlReminder({
        clientName: firstNameOf(first.control.clientName),
        businessName: business.name,
        businessAddress: business.address,
        businessPhone: business.phone,
        items: sent.map(({ control }) => ({
          serviceName: control.serviceName,
          professionalName: control.professionalName,
          lastDate: control.lastDate,
          returnAfter: describeReturnAfter(control.returnAfterDays) ?? `${control.returnAfterDays} días`,
          bookUrl: controlBookUrl(business.slug, { serviceId: control.serviceId, professionalId: control.professionalId }),
        })),
        optOutUrl: controlReminderUrl(first.token),
      }),
    });
    if (ok) queued++;
  }
  return queued;
}

/** El control de un enlace, con su negocio activo; null si no existe. */
async function findByToken(db: Db, token: string, lock = false) {
  if (!TOKEN_FORMAT.test(token)) return null;
  return one<{ businessId: string; businessName: string; clientId: string; clientName: string; optedOut: boolean }>(
    db,
    `select r.business_id as "businessId", b.name as "businessName", r.client_id as "clientId", c.name as "clientName",
            c.control_reminders_opted_out_at is not null as "optedOut"
       from control_reminders r
       join businesses b on b.id = r.business_id and b.status = 'active'
       join clients c on c.id = r.client_id
      where r.token = $1
      ${lock ? "for update of r" : ""}`,
    [token],
  );
}

export const controlReminderService = {
  /* ------------------------------------------------------------ Público (sin sesión) -- */

  /** La página del enlace del email: el negocio y si ya pidió no recibirlos. Sin datos del paciente. */
  async get(token: string): Promise<PublicControlReminder> {
    const found = await findByToken(pool, token);
    if (!found) throw new AppError("not_found", LINK_NOT_FOUND);
    return { businessName: found.businessName, optedOut: found.optedOut };
  },

  /** «No quiero recibir estos recordatorios»: la marca del paciente en ese negocio. Repetirlo no hace nada. */
  async optOut(token: string): Promise<{ optedOut: true }> {
    return transaction(async (db) => {
      const found = await findByToken(db, token, true);
      if (!found) throw new AppError("not_found", LINK_NOT_FOUND);
      const changed = await one(
        db,
        "update clients set control_reminders_opted_out_at = now() where id = $1 and control_reminders_opted_out_at is null returning id",
        [found.clientId],
      );
      if (changed) {
        await logAudit(db, {
          businessId: found.businessId,
          actor: null,
          actorName: PATIENT_LINK_ACTOR,
          action: "client.control_reminders_opted_out",
          entityType: "client",
          entityId: found.clientId,
          summary: `${found.clientName} pidió no recibir más recordatorios de control`,
        });
      }
      return { optedOut: true };
    });
  },

  /* --------------------------------------------------------------------- El panel -- */

  /**
   * La hoja «Controles» de la Agenda (los vencidos y los de los próximos 30 días) o, con `clientId`, los de ese
   * paciente (su ficha). El rol Profesional, sólo los de su agenda.
   */
  async list(ctx: RequestContext, businessId: string, query: { clientId?: string }): Promise<ControlReminder[]> {
    const actor = await authorize(pool, ctx, businessId, "appointments.manage");
    const { professionalId } = await agendaScope(pool, actor, businessId);
    const clientId = query.clientId && isUuid(query.clientId) ? query.clientId : null;
    if (query.clientId && !clientId) return [];
    const { timezone } = (await one<{ timezone: string }>(pool, "select timezone from businesses where id = $1", [businessId]))!;
    const today = getZonedNow(timezone).date;
    // La hoja: los vencidos de los últimos 90 días (los más antiguos están en Reportes → «Pacientes que no volvieron»)
    // y los de los próximos 30. La ficha: todos los del paciente.
    const controls = await findControls(pool, businessId, timezone, today, {
      dueFrom: clientId ? null : addDaysISO(today, -CONTROL_LIST_DAYS_BEHIND),
      dueUntil: clientId ? null : addDaysISO(today, CONTROL_LIST_DAYS_AHEAD),
      professionalId,
      clientId,
    });
    return controls.map(toControl);
  },

  /** «Quitar»: ese control sale de la lista y no se le escribe. Un control nuevo (otra cita Atendida) vuelve a salir. */
  async remove(ctx: RequestContext, businessId: string, appointmentId: string): Promise<{ removed: true }> {
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const { professionalId } = await agendaScope(db, actor, businessId);
      const control = isUuid(appointmentId)
        ? await one<{ clientId: string; clientName: string; serviceId: string; serviceName: string; removedAt: ISODateTime | null }>(
            db,
            `select a.client_id as "clientId", c.name as "clientName", a.service_id as "serviceId", s.name as "serviceName",
                    r.removed_at as "removedAt"
               from appointments a
               join clients c on c.id = a.client_id
               join services s on s.id = a.service_id and s.return_after_days is not null
               left join control_reminders r on r.appointment_id = a.id
              where a.id = $1 and a.business_id = $2 and a.status = 'completed'
                and ($3::uuid is null or a.professional_id = $3::uuid)
              for update of a`,
            [appointmentId, businessId, professionalId],
          )
        : null;
      if (!control) throw new AppError("not_found", NOT_FOUND);
      if (control.removedAt === null) {
        await db.query(
          `insert into control_reminders (business_id, appointment_id, client_id, service_id, removed_at, removed_by)
           values ($1, $2, $3, $4, now(), $5)
           on conflict (appointment_id) do update set removed_at = now(), removed_by = excluded.removed_by`,
          [businessId, appointmentId, control.clientId, control.serviceId, actor.userId],
        );
        await logAudit(db, {
          businessId,
          actor,
          action: "control.removed",
          entityType: "client",
          entityId: control.clientId,
          summary: `Quitó el control de ${control.serviceName} de ${control.clientName}`,
        });
      }
      return { removed: true };
    });
  },
};
