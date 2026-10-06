// Copia de agenda-front/src/lib/constants/plans.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { PlanId, PlanLimits } from "../../types/index.ts";

/**
 * Planes de la plataforma. Los precios no están aquí: se acuerdan con cada negocio (según el plan y
 * las agendas contratadas) y no se muestran en la aplicación. Sólo el super admin ve los planes.
 */
export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Qué incluye (sólo lo ve el super admin, en /admin/plans). */
  features: string[];
  /** Los aplica el backend en cada operación, no sólo la interfaz. */
  limits: PlanLimits;
  /** Crear y adaptar formatos de historia clínica propios (los de la plataforma se usan en todos). */
  customClinicalTemplates: boolean;
  /** Subir archivos (radiografías, exámenes, fotos) a la historia clínica. */
  clinicalAttachments: boolean;
  /**
   * Varios profesionales, cada uno con su agenda (sección Profesionales y rol Profesional). Sin esto la
   * cuenta es individual: una sola agenda, que se edita en Configuración → Perfil.
   */
  multipleAgendas: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    description: "Para empezar a organizar la agenda.",
    features: [
      "Hasta 20 citas al mes y 50 clientes",
      "1 usuario y 1 agenda",
      "Página de reservas, recordatorios y reportes",
      "Historia clínica con los formatos de la plataforma",
    ],
    limits: { appointmentsPerMonth: 20, clients: 50, users: 1, professionals: 1 },
    customClinicalTemplates: false,
    clinicalAttachments: false,
    multipleAgendas: false,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Para el profesional independiente, solo o con asistente.",
    features: [
      "Citas y clientes ilimitados",
      "Hasta 3 usuarios y 1 agenda",
      "Historia clínica con formatos propios y archivos",
    ],
    limits: { appointmentsPerMonth: null, clients: null, users: 3, professionals: 1 },
    customClinicalTemplates: true,
    clinicalAttachments: true,
    multipleAgendas: false,
  },
  {
    id: "business",
    name: "Business",
    description: "Para centros y clínicas con varios profesionales.",
    features: [
      "Citas, clientes y usuarios ilimitados",
      "Varias agendas: las contratadas por el negocio",
      "Roles de recepción y de profesional",
      "Reportes por profesional y control de llegadas",
      "Historia clínica con formatos propios y archivos",
    ],
    limits: { appointmentsPerMonth: null, clients: null, users: null, professionals: null },
    customClinicalTemplates: true,
    clinicalAttachments: true,
    multipleAgendas: true,
  },
];

export function getPlan(id: PlanId): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

/**
 * Límites efectivos de un negocio: los del plan y, en Business, las agendas que contrató (las fija
 * el super admin). En Free y Pro siempre es una agenda.
 */
export function getEffectiveLimits(plan: Plan, maxProfessionals: number | null): PlanLimits {
  return plan.id === "business" && maxProfessionals !== null
    ? { ...plan.limits, professionals: maxProfessionals }
    : plan.limits;
}
