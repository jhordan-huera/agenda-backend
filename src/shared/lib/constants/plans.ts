// Copia de agenda-front/src/lib/constants/plans.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { PlanId, PlanLimits } from "../../types/index.ts";

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  description: string;
  features: string[];
  /** Los aplica el backend (repositorio / triggers de PostgreSQL), no sólo la interfaz. */
  limits: PlanLimits;
  highlighted?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    description: "Para empezar a organizar tu agenda.",
    features: [
      "Hasta 20 citas mensuales",
      "Hasta 50 clientes",
      "1 usuario",
      "Página pública de reservas",
      "Calendario, servicios y horarios",
    ],
    limits: { appointmentsPerMonth: 20, clients: 50, users: 1 },
  },
  {
    id: "pro",
    name: "Pro",
    price: 7.99,
    description: "Para profesionales con agenda completa.",
    features: [
      "Citas ilimitadas",
      "Clientes ilimitados",
      "Hasta 3 usuarios",
      "Recordatorios por email",
      "Reportes",
      "Personalización",
    ],
    limits: { appointmentsPerMonth: null, clients: null, users: 3 },
    highlighted: true,
  },
  {
    id: "business",
    name: "Business",
    price: 14.99,
    description: "Para pequeños negocios con equipo.",
    features: [
      "Citas ilimitadas",
      "Clientes ilimitados",
      "Usuarios adicionales",
      "Reportes avanzados",
      "Varias agendas",
      "Funciones administrativas",
    ],
    limits: { appointmentsPerMonth: null, clients: null, users: null },
  },
];

export function getPlan(id: PlanId): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

/** Plan sugerido al alcanzar un límite. */
export function getNextPlan(id: PlanId): Plan | null {
  const index = PLANS.findIndex((p) => p.id === id);
  return PLANS[index + 1] ?? null;
}
