import { auditLogColumns, notificationColumns } from "../db/columns.ts";
import { isUuid, many, pool, transaction } from "../db/pool.ts";
import type { AuditEntityType, AuditLog, EmailNotification } from "../shared/types/index.ts";
import { authorize, type RequestContext } from "./context.ts";
import { runReminderJob } from "./notifications.ts";

export interface AuditLogFilters {
  entityType?: AuditEntityType;
  entityId?: string;
}

export const notificationService = {
  /** Emails del negocio y emails de cuenta del propio usuario (bandeja de salida). */
  async list(ctx: RequestContext, businessId: string): Promise<EmailNotification[]> {
    await authorize(pool, ctx, businessId, "business.manage");
    // Los emails de cuenta (sin negocio: bienvenida, contraseñas) sólo los ve su destinatario.
    return many<EmailNotification>(
      pool,
      `select ${notificationColumns()} from notifications
        where business_id = $1 or (business_id is null and to_email = $2)
        order by created_at desc
        limit 100`,
      [businessId, ctx.user!.email],
    );
  },

  /** Envía los recordatorios pendientes del negocio (el servidor también lo hace periódicamente). */
  async runReminderJob(ctx: RequestContext, businessId: string): Promise<number> {
    return transaction(async (db) => {
      await authorize(db, ctx, businessId);
      return runReminderJob(db, businessId);
    });
  },
};

export const auditLogService = {
  async list(ctx: RequestContext, businessId: string, filters: AuditLogFilters = {}): Promise<AuditLog[]> {
    await authorize(pool, ctx, businessId, "audit.view");
    if (filters.entityId && !isUuid(filters.entityId)) return [];
    return many<AuditLog>(
      pool,
      `select ${auditLogColumns()} from audit_logs
        where business_id = $1
          and ($2::text is null or entity_type = $2)
          and ($3::uuid is null or entity_id = $3::uuid)
        order by created_at desc
        limit 200`,
      [businessId, filters.entityType ?? null, filters.entityId ?? null],
    );
  },
};
