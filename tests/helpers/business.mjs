// Alta de un negocio por el super admin (POST /admin/businesses): sin propietario, con sus servicios y su horario.
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
  return { status: 200, body: { business: created.body.business, owner: assigned.body } };
}
