import type { z } from "zod";
import { config } from "../config.ts";
import { isUuid, one, type Db } from "../db/pool.ts";
import { AppError } from "../http/errors.ts";
import { getFullName } from "../shared/lib/format.ts";
import { hasPermission, type Permission } from "../shared/lib/permissions.ts";
import type { BusinessRole, BusinessStatus, User } from "../shared/types/index.ts";

/** Quién hace la petición. Lo rellena el middleware de sesión a partir de la cookie. */
export interface RequestContext {
  user: User | null;
  /** Sesión actual (para cerrarla o conservarla al cambiar la contraseña). */
  sessionId: string | null;
  /** La cuenta tiene activada la verificación en dos pasos (obligatoria para el super admin). */
  twoFactorEnabled?: boolean;
}

/** Código del error que reciben las peticiones del super admin mientras no active la verificación en dos pasos. */
export const TWO_FACTOR_REQUIRED_CODE = "two_factor_required";
export const TWO_FACTOR_REQUIRED_MESSAGE =
  "Activa la verificación en dos pasos para usar el panel de plataforma y gestionar negocios.";

/**
 * Super admin sin la verificación en dos pasos (y obligatoria, ver config): puede iniciar sesión y
 * activarla, pero no entrar al panel /admin ni al modo soporte ("Gestionar negocio").
 */
export function superAdminNeedsTwoFactor(ctx: RequestContext): boolean {
  return ctx.user?.platformRole === "super_admin" && config.superAdminTwoFactorRequired && !ctx.twoFactorEnabled;
}

/** Quién aparece como autor en la auditoría. */
export interface AuditActor {
  userId: string;
  name: string;
}

export interface Actor extends AuditActor {
  role: BusinessRole;
  /** Super admin en modo soporte: se registran sus cambios y sus lecturas de historias clínicas (no el resto de consultas). */
  support?: true;
}

/** Usuario de la sesión. Las cuentas desactivadas no pasan. */
export function requireUser(ctx: RequestContext): User {
  if (!ctx.user?.isActive) throw new AppError("unauthorized", "Tu sesión expiró. Vuelve a iniciar sesión.");
  return ctx.user;
}

/**
 * Autorización de cada operación de un negocio: exige sesión, pertenencia al negocio
 * (aislamiento multi-tenant), que el negocio no esté suspendido y, opcionalmente, un
 * permiso del rol. El super admin ("Gestionar negocio" en el panel /admin) actúa en
 * cualquier negocio, aunque esté suspendido, con los permisos del propietario y queda
 * identificado en la auditoría (lo que crea o cambia y las historias clínicas que abre). Necesita la
 * verificación en dos pasos activada (ver superAdminNeedsTwoFactor). Con `lock` bloquea la fila del
 * negocio hasta el fin de la transacción: así dos escrituras simultáneas del mismo negocio (p. ej. dos
 * reservas a la misma hora, o el último cupo del plan) se ejecutan una detrás de otra.
 */
export async function authorize(
  db: Db,
  ctx: RequestContext,
  businessId: string,
  permission?: Permission,
  options: { lock?: boolean } = {},
): Promise<Actor> {
  const user = requireUser(ctx);
  if (user.platformRole === "super_admin") {
    // Las rutas ya responden con TWO_FACTOR_REQUIRED_CODE (ver requireSuperAdminTwoFactor); esto es la segunda barrera.
    if (superAdminNeedsTwoFactor(ctx)) throw new AppError("forbidden", TWO_FACTOR_REQUIRED_MESSAGE);
    const business = isUuid(businessId)
      ? await one(db, `select 1 from businesses where id = $1 ${options.lock ? "for no key update" : ""}`, [businessId])
      : null;
    if (!business) throw new AppError("not_found", "Negocio no encontrado.");
    return { userId: user.id, name: `${getFullName(user)} (Super admin)`, role: "owner", support: true };
  }
  const membership = isUuid(businessId)
    ? await one<{ role: BusinessRole; status: BusinessStatus }>(
        db,
        `select bu.role, b.status
           from business_users bu
           join businesses b on b.id = bu.business_id
          where bu.business_id = $1 and bu.user_id = $2
          ${options.lock ? "for no key update of b" : ""}`,
        [businessId, user.id],
      )
    : null;
  if (!membership) throw new AppError("forbidden", "No tienes acceso a este negocio.");
  if (membership.status === "suspended") {
    throw new AppError("forbidden", "Este negocio está suspendido. Contacta a soporte.");
  }
  if (permission && !hasPermission(membership.role, permission)) {
    throw new AppError("forbidden", "Tu rol no tiene permisos para realizar esta acción.");
  }
  return { userId: user.id, name: getFullName(user), role: membership.role };
}

/** Operaciones de plataforma (panel /admin): sólo el super admin. */
export function authorizeSuperAdmin(ctx: RequestContext): AuditActor {
  const user = requireUser(ctx);
  if (user.platformRole !== "super_admin") {
    throw new AppError("forbidden", "Sólo el super admin puede realizar esta acción.");
  }
  if (superAdminNeedsTwoFactor(ctx)) throw new AppError("forbidden", TWO_FACTOR_REQUIRED_MESSAGE);
  return { userId: user.id, name: `${getFullName(user)} (Super admin)` };
}

/** Validación del lado servidor: nunca se confía en que el formulario ya validó. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError("validation", result.error.issues[0]?.message ?? "Datos inválidos.");
  return result.data;
}

/** Bloquea la fila del negocio hasta el fin de la transacción (ver `authorize`). */
export async function lockBusiness(db: Db, businessId: string): Promise<void> {
  await db.query("select 1 from businesses where id = $1 for no key update", [businessId]);
}
