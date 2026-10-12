import { z } from "zod";
import { auditLogColumns, auditLogConnectionColumns, notificationColumns } from "../db/columns.ts";
import { many, one, pool, type Db } from "../db/pool.ts";
import type { AuditLog, AuditLogPage, EmailNotification } from "../shared/types/index.ts";
import { authorize, parseInput, type RequestContext } from "./context.ts";

const AUDIT_ENTITY_TYPES = [
  "appointment",
  "client",
  "service",
  "schedule",
  "blocked_time",
  "professional",
  "business",
  "team",
  "subscription",
  "user",
  "platform",
  "clinical_record",
  "session",
] as const;

/** Filtros de la auditoría (query string). Las fechas, en ISO 8601; `cursor`: id de la última entrada vista. */
export const auditFiltersSchema = z.object({
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.uuid().optional(),
  /** Un usuario, "online" (reservas desde la página pública) o "support" (el super admin). */
  actorId: z.union([z.uuid(), z.enum(["online", "support"])]).optional(),
  action: z.string().trim().max(60).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** Sólo los parámetros con valor (la query string puede traer vacíos o repetidos). */
export function parseAuditFilters(query: Record<string, unknown>): AuditFilters {
  const clean = Object.fromEntries(Object.entries(query).filter(([, value]) => typeof value === "string" && value !== ""));
  return parseInput(auditFiltersSchema, clean);
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Una página de la auditoría, de la más reciente a la más antigua. `select` y `from` dicen qué
 * columnas y tablas (alias `l` para audit_logs); `where`, las condiciones fijas de quien consulta.
 */
export async function queryAuditLogs<T extends AuditLog>(
  db: Db,
  query: { select: string; from: string; where: string[]; values: unknown[] },
  filters: AuditFilters,
): Promise<AuditLogPage<T>> {
  const values = [...query.values];
  const where = [...query.where];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.entityType) where.push(`l.entity_type = ${param(filters.entityType)}`);
  if (filters.entityId) where.push(`l.entity_id = ${param(filters.entityId)}::uuid`);
  if (filters.actorId === "online") where.push("l.actor_id is null and l.entity_type <> 'session'");
  else if (filters.actorId === "support") {
    where.push("exists (select 1 from users u where u.id = l.actor_id and u.platform_role = 'super_admin')");
  } else if (filters.actorId) where.push(`l.actor_id = ${param(filters.actorId)}::uuid`);
  if (filters.action) where.push(`l.action = ${param(filters.action)}`);
  if (filters.from) where.push(`l.created_at >= ${param(filters.from)}::timestamptz`);
  if (filters.to) where.push(`l.created_at < ${param(filters.to)}::timestamptz`);
  if (filters.q) {
    const pattern = param(`%${escapeLike(filters.q)}%`);
    where.push(`(l.summary ilike ${pattern} or l.actor_name ilike ${pattern})`);
  }
  // Por el id de la última entrada vista: compara con su fecha exacta (varias pueden compartir la misma).
  if (filters.cursor) {
    where.push(`(l.created_at, l.id) < (select c.created_at, c.id from audit_logs c where c.id = ${param(filters.cursor)}::uuid)`);
  }
  const rows = await many<T>(
    db,
    `select ${query.select} from ${query.from}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by l.created_at desc, l.id desc
      limit ${filters.limit + 1}`,
    values,
  );
  const entries = rows.slice(0, filters.limit);
  return { entries, nextCursor: rows.length > filters.limit ? entries[entries.length - 1].id : null };
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
};

export const auditLogService = {
  /**
   * Actividad del negocio. Sin los eventos de sesión (inicios de sesión, IP y navegador): ésos
   * sólo los ve el super admin. Los de la historia clínica (quién la consultó, nombres de archivos…)
   * sólo quien tiene acceso clínico: el propietario y los miembros que él autorizó.
   */
  async list(ctx: RequestContext, businessId: string, query: Record<string, unknown>): Promise<AuditLogPage> {
    const actor = await authorize(pool, ctx, businessId, "audit.view");
    const filters = parseAuditFilters(query);
    const clinicalAccess =
      actor.role === "owner" ||
      Boolean(
        await one(pool, "select 1 from business_users where business_id = $1 and user_id = $2 and clinical_access", [
          businessId,
          actor.userId,
        ]),
      );
    return queryAuditLogs<AuditLog>(
      pool,
      {
        select: auditLogColumns("l"),
        from: "audit_logs l",
        where: ["l.business_id = $1", "l.entity_type <> 'session'", ...(clinicalAccess ? [] : ["l.entity_type <> 'clinical_record'"])],
        values: [businessId],
      },
      filters,
    );
  },
};

/** Columnas de la vista del super admin: con el negocio y, en las sesiones, desde dónde. */
export const ADMIN_AUDIT_QUERY = {
  select: `${auditLogColumns("l")}, ${auditLogConnectionColumns("l")}, b.name as "businessName"`,
  from: "audit_logs l left join businesses b on b.id = l.business_id",
};
