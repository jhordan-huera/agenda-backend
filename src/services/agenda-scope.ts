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
  /** Sólo los pacientes con citas en su agenda o que registró él; null: todos. */
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
 * Condición SQL "el cliente `alias` es de los suyos": lo registró él o tiene citas en su agenda.
 * `professionalParam` y `userParam` son los números de parámetro ($n) con esos valores.
 */
export function ownClientCondition(alias: string, professionalParam: number, userParam: number): string {
  return `(${alias}.created_by = $${userParam}
           or exists (select 1 from appointments own where own.client_id = ${alias}.id and own.professional_id = $${professionalParam}))`;
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
