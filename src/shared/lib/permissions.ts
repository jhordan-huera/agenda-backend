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
  | "professionals.manage"
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
  "professionals.manage",
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
    "professionals.manage",
    "schedule.manage",
    "reports.view",
    "audit.view",
  ]),
  staff: new Set(["appointments.manage", "clients.manage"]),
  // Sólo sobre su propia agenda: la API filtra citas, pacientes, horario y reportes (ver agenda-scope).
  professional: new Set(["appointments.manage", "clients.manage", "schedule.manage", "reports.view"]),
};

export function hasPermission(role: BusinessRole | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].has(permission) : false;
}

export const ROLE_LABELS: Record<BusinessRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  staff: "Recepción",
  professional: "Profesional",
};

export const ROLE_DESCRIPTIONS: Record<BusinessRole, string> = {
  owner: "Administra todo: equipo, profesionales, configuración y actividad.",
  admin: "Gestiona citas, pacientes, servicios, profesionales y horarios, y ve reportes.",
  staff: "Maneja la agenda de todos los profesionales: crea citas, marca llegadas y gestiona pacientes.",
  professional: "Atiende su propia agenda: ve sus citas, sus pacientes, su horario y sus reportes.",
};

/** Roles que se pueden asignar al invitar (el propietario es único). */
export const ASSIGNABLE_ROLES: BusinessRole[] = ["admin", "staff", "professional"];

/** Quien sólo ve su propia agenda (la API lo aplica en cada consulta). */
export const isAgendaScoped = (role: BusinessRole | null | undefined): boolean => role === "professional";
