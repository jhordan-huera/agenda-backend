import { appointmentColumns } from "../db/columns.ts";
import { isUuid, many, one, pool, transaction, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { APPOINTMENT_STATUS_CONFIG } from "../shared/lib/constants/appointment-status.ts";
import { getZonedNow } from "../shared/lib/time.ts";
import { scanCompleteSchema, scanLinkSchema, scanSchema } from "../shared/lib/validations/loyalty.ts";
import type { Appointment, ScanAppointment, ScanResult } from "../shared/types/index.ts";
import { agendaScope, assertAppointmentInScope, type AgendaScope } from "./agenda-scope.ts";
import { logAudit } from "./audit.ts";
import { changeAppointmentStatus } from "./business-data-service.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";

/*
 * «Escanear» (spec 052): el QR de la cuenta del paciente, en el panel. La primera vez en un negocio, el usuario elige
 * entre las citas de hoy que puede ver quién es el paciente, y la cuenta queda unida a esa ficha: ese escaneo en
 * persona es la verificación (con sólo registrarse con un teléfono, nadie ve nada de un negocio). Después, el QR
 * marca como Atendida la cita de hoy por el mismo camino que la ficha. Funciona aunque la tarjeta esté apagada.
 */

const QR_GONE = "Este QR ya no sirve: pídele al paciente que abra su tarjeta.";

async function accountByToken(db: Db, token: string): Promise<{ id: string; name: string }> {
  const account = await one<{ id: string; name: string }>(db, "select id, name from patient_accounts where qr_token = $1", [token]);
  if (!account) throw new AppError("not_found", QR_GONE);
  return account;
}

async function todayOf(db: Db, businessId: string): Promise<string> {
  const { timezone } = (await one<{ timezone: string }>(db, "select timezone from businesses where id = $1", [businessId]))!;
  return getZonedNow(timezone).date;
}

/** Las citas de hoy del negocio que el usuario puede ver, una fila por persona de cada cita (`clientId`: sólo esa). */
async function todayAppointments(db: Db, businessId: string, scope: AgendaScope, clientId: string | null): Promise<ScanAppointment[]> {
  return many<ScanAppointment>(
    db,
    `select a.id, p.client_id as "clientId", c.name as "clientName", s.name as "serviceName", pr.display_name as "professionalName",
            left(a.start_time::text, 5) as "startTime", a.status
       from appointments a
       cross join lateral (select a.client_id union all select ac.client_id from appointment_clients ac where ac.appointment_id = a.id) p(client_id)
       join clients c on c.id = p.client_id
       join services s on s.id = a.service_id
       join professionals pr on pr.id = a.professional_id
      where a.business_id = $1 and a.date = $2::date and a.status <> 'cancelled'
        and ($3::uuid is null or a.professional_id = $3::uuid)
        and ($4::uuid is null or p.client_id = $4::uuid)
      order by a.start_time, c.name`,
    [businessId, await todayOf(db, businessId), scope.professionalId, clientId],
  );
}

async function linkedClient(db: Db, businessId: string, accountId: string): Promise<{ clientId: string; clientName: string } | null> {
  return one(
    db,
    `select k.client_id as "clientId", c.name as "clientName" from loyalty_cards k join clients c on c.id = k.client_id
      where k.business_id = $1 and k.patient_account_id = $2`,
    [businessId, accountId],
  );
}

async function result(db: Db, businessId: string, scope: AgendaScope, account: { id: string; name: string }): Promise<ScanResult> {
  const linked = await linkedClient(db, businessId, account.id);
  if (!linked) return { status: "unlinked", accountName: account.name, appointments: await todayAppointments(db, businessId, scope, null) };
  return { status: "linked", ...linked, appointments: await todayAppointments(db, businessId, scope, linked.clientId) };
}

export const loyaltyScanService = {
  async scan(ctx: RequestContext, businessId: string, input: unknown): Promise<ScanResult> {
    const { token } = parseInput(scanSchema, input);
    const actor = await authorize(pool, ctx, businessId, "appointments.manage");
    const scope = await agendaScope(pool, actor, businessId);
    return result(pool, businessId, scope, await accountByToken(pool, token));
  },

  /** Unir la cuenta a la ficha del paciente de una cita de hoy (la primera vez en este negocio). */
  async link(ctx: RequestContext, businessId: string, input: unknown): Promise<ScanResult> {
    const { token, appointmentId, clientId } = parseInput(scanLinkSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const account = await accountByToken(db, token);
      if (!isUuid(appointmentId) || !isUuid(clientId)) throw new AppError("validation", "Elige la cita de hoy de este paciente.");
      const chosen = (await todayAppointments(db, businessId, scope, clientId)).find((item) => item.id === appointmentId);
      if (!chosen) throw new AppError("validation", "Elige la cita de hoy de este paciente.");
      const already = await linkedClient(db, businessId, account.id);
      if (already && already.clientId !== clientId) {
        throw new AppError("conflict", `Esta cuenta ya está unida a la ficha de ${already.clientName}.`);
      }
      const other = await one(
        db,
        "select 1 from loyalty_cards where client_id = $1 and patient_account_id is not null and patient_account_id <> $2",
        [clientId, account.id],
      );
      if (other) throw new AppError("conflict", "Esta ficha ya está unida a otra cuenta.");
      if (!already) {
        await db.query(
          `insert into loyalty_cards (client_id, business_id, patient_account_id, linked_at, linked_by) values ($1, $2, $3, now(), $4)
           on conflict (client_id) do update set patient_account_id = excluded.patient_account_id, linked_at = now(), linked_by = excluded.linked_by`,
          [clientId, businessId, account.id, actor.userId],
        );
        await logAudit(db, {
          businessId,
          actor,
          action: "loyalty.account_linked",
          entityType: "loyalty",
          entityId: clientId,
          summary: `Escaneó el QR de ${account.name} y unió su cuenta a la ficha de ${chosen.clientName}`,
        });
      }
      return result(db, businessId, scope, account);
    });
  },

  /** «Marcar como atendida»: la cita de hoy del paciente unido, por el mismo camino que la ficha. */
  async complete(ctx: RequestContext, businessId: string, input: unknown): Promise<ScanResult> {
    const { token, appointmentId } = parseInput(scanCompleteSchema, input);
    return transaction(async (db) => {
      const actor = await authorize(db, ctx, businessId, "appointments.manage", { lock: true });
      const scope = await agendaScope(db, actor, businessId);
      const account = await accountByToken(db, token);
      const linked = await linkedClient(db, businessId, account.id);
      if (!linked) throw new AppError("conflict", "Primero elige a qué paciente de hoy corresponde este QR.");
      const chosen = isUuid(appointmentId)
        ? (await todayAppointments(db, businessId, scope, linked.clientId)).find((item) => item.id === appointmentId)
        : undefined;
      if (!chosen) throw new AppError("validation", "Esa cita no es de hoy ni de este paciente.");
      const before = (await one<Appointment>(db, `select ${appointmentColumns()} from appointments where id = $1 and business_id = $2`, [
        appointmentId,
        businessId,
      ]))!;
      assertAppointmentInScope(scope, before);
      if (before.status !== "pending" && before.status !== "confirmed") {
        throw new AppError("conflict", `Esta cita ya está «${APPOINTMENT_STATUS_CONFIG[before.status].label}».`);
      }
      await changeAppointmentStatus(db, actor, before, "completed", true);
      await logAudit(db, {
        businessId,
        actor,
        action: "loyalty.qr_completed",
        entityType: "loyalty",
        entityId: appointmentId,
        summary: `Marcó como atendida, con el QR, la cita de hoy de ${linked.clientName}`,
      });
      return result(db, businessId, scope, account);
    });
  },
};
