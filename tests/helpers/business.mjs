// Alta de un negocio por el super admin (POST /admin/businesses): sin propietario, con sus servicios y su horario.
import { execFileSync } from "node:child_process";

/**
 * Spec 054: la contraseña que pone el super admin es temporal (al entrar, la persona crea la suya). Las suites que no
 * prueban eso la dan por creada y entran con ella, como antes; la temporal se prueba en password-recovery.test.ts.
 */
export function acceptSupportPassword(email) {
  execFileSync(
    "psql",
    [process.env.TEST_DATABASE_URL, "-qAtc", `update users set password_change_required = false where email = '${String(email).toLowerCase().replace(/'/g, "''")}'`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}
export const WEEKDAYS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, isActive: true, intervals: [{ start: "09:00", end: "17:00" }] }));

export const businessInput = (fields) => ({
  category: "beauty",
  description: "",
  timezone: "America/Guayaquil",
  phone: "",
  email: "",
  address: "",
  plan: "free",
  services: [{ name: "Consulta", durationMinutes: 60, price: 25 }],
  schedules: WEEKDAYS,
  ...fields,
});

/** Crea el negocio y le agrega su propietario. Devuelve la respuesta del paso que falle, o { business, owner }. */
export async function createBusinessWithOwner(admin, fields, owner) {
  const created = await admin("POST", "/admin/businesses", businessInput(fields));
  if (created.status !== 200) return created;
  const assigned = await admin("POST", `/admin/businesses/${created.body.business.id}/owner`, owner);
  if (assigned.status !== 200) return assigned;
  if (owner?.email) acceptSupportPassword(owner.email);
  return { status: 200, body: { business: created.body.business, owner: assigned.body } };
}
