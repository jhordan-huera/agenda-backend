import { one, type Db } from "../db/pool.ts";
import { formatNumericDate } from "../shared/lib/format.ts";
import type { Appointment, AuditChange, AuditEntityType } from "../shared/types/index.ts";
import type { AuditActor } from "./context.ts";

/** Auditoría: quién hizo qué y cuándo. Se escribe en la misma transacción que el cambio. */
export async function logAudit(
  db: Db,
  entry: {
    businessId: string | null;
    /** null: un cliente desde la página pública ("Reserva online") o `actorName`. */
    actor: AuditActor | null;
    /** Autor sin cuenta (p. ej. el email con que alguien intentó entrar). */
    actorName?: string;
    action: string;
    entityType: AuditEntityType;
    entityId: string | null;
    summary: string;
    /** Qué cambió (ver diffChanges). Vacío o null: no se guarda. */
    changes?: AuditChange[] | null;
    /** Sólo en los eventos de sesión. */
    connection?: { ip: string; userAgent: string | null };
  },
): Promise<void> {
  await db.query(
    `insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id, summary, changes, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.businessId,
      entry.actor?.userId ?? null,
      entry.actor?.name ?? entry.actorName ?? "Reserva online",
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.summary,
      entry.changes?.length ? JSON.stringify(entry.changes) : null,
      entry.connection?.ip ?? null,
      entry.connection?.userAgent?.slice(0, 300) ?? null,
    ],
  );
}

/** "María López (10/10/2026 10:00)" */
export async function describeAppointment(
  db: Db,
  appointment: Pick<Appointment, "clientId" | "date" | "startTime">,
): Promise<string> {
  const client = await one<{ name: string }>(db, "select name from clients where id = $1", [appointment.clientId]);
  return `${client?.name ?? "cliente"} (${formatNumericDate(appointment.date)} ${appointment.startTime})`;
}
