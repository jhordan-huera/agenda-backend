import { one, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import type { ProfessionalScope } from "../shared/types/index.ts";
import type { Actor } from "./context.ts";

/**
 * Qué parte del negocio ve quien hace la petición. El rol Profesional sólo trabaja sobre su agenda
 * (sus citas, su horario, sus bloqueos y sus reportes) y, si el negocio lo eligió, sólo sobre sus
 * pacientes. El resto de roles (y el super admin en modo soporte) ve todas las agendas.
 */
export interface AgendaScope {
  /** Su agenda; null: todas. */
  professionalId: string | null;
  /**
   * Sólo los pacientes con citas en su agenda o que registró él; null: todos. Una reserva online de un
   * cliente que ya existía no cuenta hasta que la gestione el negocio (ver ownClientCondition).
   */
  ownClients: { professionalId: string; userId: string } | null;
}

export const FULL_SCOPE: AgendaScope = { professionalId: null, ownClients: null };

export async function agendaScope(db: Db, actor: Actor, businessId: string): Promise<AgendaScope> {
  if (actor.role !== "professional" || actor.support) return FULL_SCOPE;
  const row = await one<{ professionalId: string; scope: ProfessionalScope }>(
    db,
    `select p.id as "professionalId", b.professional_scope as scope
       from professionals p join businesses b on b.id = p.business_id
      where p.business_id = $1 and p.user_id = $2 and p.is_active`,
    [businessId, actor.userId],
  );
  if (!row) {
    throw new AppError(
      "forbidden",
      "Tu usuario no tiene una agenda asignada. Pide al propietario que te la asigne en Profesionales.",
    );
  }
  return {
    professionalId: row.professionalId,
    ownClients: row.scope === "own" ? { professionalId: row.professionalId, userId: actor.userId } : null,
  };
}

/**
 * Condición SQL "el cliente `alias` es de los suyos": lo registró él o tiene citas en su agenda que le
 * dan acceso. No cuenta una reserva online de un cliente que ya existía y que aún no era suyo
 * (appointments.client_access_pending, lo marca la base al reservar; migración 028) mientras no la
 * confirme o la gestione alguien del negocio que no sea él (ver releaseClientAccess): si no, bastaría
 * con reservarse una cita en la página pública con la cédula de cualquier paciente para abrir su
 * historia clínica. `professionalParam` y `userParam` son los números de parámetro ($n) con esos valores.
 */
export function ownClientCondition(alias: string, professionalParam: number, userParam: number): string {
  return `(${alias}.created_by = $${userParam}
           or exists (select 1 from appointments own
                       where own.client_id = ${alias}.id and own.professional_id = $${professionalParam}
                         and not own.client_access_pending))`;
}

/**
 * Condición SQL "el cliente `alias` tiene en su agenda una reserva online que todavía no le da acceso":
 * el profesional ve la cita con el nombre del paciente, pero no su ficha ni su historia.
 */
export function pendingClientCondition(alias: string, professionalParam: number): string {
  return `exists (select 1 from appointments pending
                   where pending.client_id = ${alias}.id and pending.professional_id = $${professionalParam}
                     and pending.client_access_pending)`;
}

/**
 * Una reserva online pendiente (client_access_pending) pasa a dar acceso al paciente cuando la
 * confirma o la gestiona alguien del negocio que no es el profesional de esa agenda: propietario,
 * administrador, recepción o el super admin en modo soporte. Si el propio profesional la confirma, o
 * si la cita queda cancelada, sigue igual. Se llama después de guardar el cambio de la cita.
 */
export async function releaseClientAccess(db: Db, actor: Actor, appointmentId: string): Promise<void> {
  if (actor.role === "professional") return;
  await db.query(
    `update appointments a set client_access_pending = false
      where a.id = $1 and a.client_access_pending and a.status <> 'cancelled'
        and not exists (select 1 from professionals p where p.id = a.professional_id and p.user_id = $2)`,
    [appointmentId, actor.userId],
  );
}

/** Con "sólo sus pacientes", falla si el cliente no es de los suyos (como si no existiera). */
export async function assertClientInScope(db: Db, scope: AgendaScope, clientId: string): Promise<void> {
  if (!scope.ownClients) return;
  const visible = await one(
    db,
    `select 1 from clients c where c.id = $1 and ${ownClientCondition("c", 2, 3)}`,
    [clientId, scope.ownClients.professionalId, scope.ownClients.userId],
  );
  if (!visible) throw new AppError("not_found", "Cliente no encontrado.");
}

/** Una cita de otra agenda no existe para quien sólo ve la suya. */
export function assertAppointmentInScope(scope: AgendaScope, appointment: { professionalId: string }): void {
  if (scope.professionalId && appointment.professionalId !== scope.professionalId) {
    throw new AppError("not_found", "Cita no encontrada.");
  }
}
