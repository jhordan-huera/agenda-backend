// Copia de agenda-front/src/lib/permissions.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { BusinessRole } from "../types/index.ts";

/**
 * Permisos por rol. Los usan la interfaz (ocultar acciones) y el backend
 * (rechazar operaciones): nunca se confía sólo en el frontend.
 * La API (agenda-backend) usa una copia de este archivo para autorizar cada operación.
 */
export type Permission =
  | "appointments.manage"
  | "clients.manage"
  | "clients.delete"
  | "services.manage"
  | "schedule.manage"
  | "reports.view"
  | "business.manage"
  | "team.manage"
  | "billing.manage"
  | "audit.view";

const ALL_PERMISSIONS: Permission[] = [
  "appointments.manage",
  "clients.manage",
  "clients.delete",
  "services.manage",
  "schedule.manage",
  "reports.view",
  "business.manage",
  "team.manage",
  "billing.manage",
  "audit.view",
];

const ROLE_PERMISSIONS: Record<BusinessRole, ReadonlySet<Permission>> = {
  owner: new Set(ALL_PERMISSIONS),
  admin: new Set([
    "appointments.manage",
    "clients.manage",
    "clients.delete",
    "services.manage",
    "schedule.manage",
    "reports.view",
    "audit.view",
  ]),
  staff: new Set(["appointments.manage", "clients.manage"]),
};

export function hasPermission(role: BusinessRole | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].has(permission) : false;
}

export const ROLE_LABELS: Record<BusinessRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  staff: "Staff",
};

export const ROLE_DESCRIPTIONS: Record<BusinessRole, string> = {
  owner: "Administra todo: equipo, configuración y suscripción.",
  admin: "Gestiona clientes, citas, servicios y horarios, y ve reportes.",
  staff: "Ve la agenda, crea citas y gestiona clientes.",
};

/** Roles que se pueden asignar al invitar (el propietario es único). */
export const ASSIGNABLE_ROLES: BusinessRole[] = ["admin", "staff"];
