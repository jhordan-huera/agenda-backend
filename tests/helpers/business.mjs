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

/** Token del enlace para definir la contraseña (el que el super admin puede copiar). */
export const tokenOf = (passwordLink) => new URL(passwordLink.url).searchParams.get("token");

/** Define la contraseña con el enlace de un solo uso, como la página /definir-contrasena (sin sesión). */
export const setPasswordWithLink = (call, passwordLink, password) =>
  call("POST", "/auth/password-link", { token: tokenOf(passwordLink), password, confirmPassword: password });

/**
 * Crea el negocio y le agrega su propietario. Si `owner.password` viene, la define con el enlace que
 * recibe por email (nadie más la elige). Devuelve la respuesta del paso que falle, o { business, owner, passwordLink }.
 */
export async function createBusinessWithOwner(admin, fields, owner) {
  const created = await admin("POST", "/admin/businesses", businessInput(fields));
  if (created.status !== 200) return created;
  const { password, ...person } = owner;
  const assigned = await admin("POST", `/admin/businesses/${created.body.business.id}/owner`, person);
  if (assigned.status !== 200) return assigned;
  if (password) {
    const defined = await setPasswordWithLink(admin, assigned.body.passwordLink, password);
    if (defined.status !== 204) return defined;
  }
  return { status: 200, body: { business: created.body.business, owner: assigned.body.member, passwordLink: assigned.body.passwordLink } };
}

/** El super admin agrega un miembro al equipo y, si viene `password`, el miembro la define con su enlace. */
export async function addMemberWithPassword(admin, businessId, { password, ...member }) {
  const added = await admin("POST", `/admin/businesses/${businessId}/members`, member);
  if (added.status !== 200 || !password) return added;
  const defined = await setPasswordWithLink(admin, added.body.passwordLink, password);
  return defined.status === 204 ? added : defined;
}
