import { one, type Db } from "../db/pool.ts";
import { formatNumericDate } from "../shared/lib/format.ts";
import type { Appointment, AuditEntityType } from "../shared/types/index.ts";
import type { AuditActor } from "./context.ts";

/** Auditoría: quién hizo qué y cuándo. Se escribe en la misma transacción que el cambio. */
export async function logAudit(
  db: Db,
  entry: {
    businessId: string | null;
    actor: AuditActor | null;
    action: string;
    entityType: AuditEntityType;
    entityId: string | null;
    summary: string;
  },
): Promise<void> {
  await db.query(
    `insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id, summary)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.businessId,
      entry.actor?.userId ?? null,
      entry.actor?.name ?? "Reserva online",
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.summary,
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
