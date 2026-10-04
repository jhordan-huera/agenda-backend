// Categorías de negocio en la base de datos.
const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else { failures++; console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
};
function agent() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}
const login = async (email, password = "demo1234") => {
  const a = agent();
  const r = await a("POST", "/auth/login", { email, password, remember: true });
  return { a, session: r.body };
};
const anon = agent();
const { a: admin } = await login("admin@demo.com");
const { a: owner, session: os } = await login("jhordan@demo.com");
const B = `/businesses/${os.businessId}`;

console.log("Lista y alta");
let r = await anon("GET", "/public/categories");
ok(r.status === 200 && r.body.length === 10 && r.body[0].id === "psychology" && r.body.at(-1).id === "other", "10 categorías iniciales ordenadas", r.body?.map((c) => c.id));
ok(r.body[0].suggestedService.name === "Sesión de terapia" && r.body[0].suggestedService.price === 30 && r.body[0].isHealth === true, "con servicio sugerido y salud", r.body[0]);
const vet = { name: "Veterinaria", icon: "paw-print", isHealth: true, suggestedServiceName: "Consulta veterinaria", suggestedServiceDuration: 30, suggestedServicePrice: 20, isActive: true, sortOrder: 55 };
r = await owner("POST", "/admin/categories", vet);
ok(r.status === 403, "un propietario no crea categorías", r.status);
r = await admin("POST", "/admin/categories", vet);
ok(r.status === 200 && r.body.id === "veterinaria" && r.body.icon === "paw-print", "el super admin crea Veterinaria", r.body);
r = await admin("POST", "/admin/categories", { ...vet, name: "veterinaria" });
ok(r.status === 409, "nombre repetido → 409", r.body);
r = await admin("POST", "/admin/categories", { ...vet, name: "Peluquería canina" });
ok(r.status === 200 && r.body.id === "peluqueria_canina", "id a partir del nombre (sin tildes)", r.body);
r = await admin("GET", "/admin/categories");
ok(r.body.length === 12 && r.body.find((c) => c.id === "professional_services").businessCount === 1, "lista del admin con uso", r.body?.map((c) => `${c.id}:${c.businessCount}`));

console.log("Editar la categoría de un negocio");
r = await admin("PATCH", B, { category: "inexistente" });
ok(r.status === 400, "categoría inexistente → 400", r.body);
r = await owner("PATCH", B, { category: "veterinaria" });
ok(r.status === 403 && /plataforma/.test(r.body.error.message), "el propietario NO cambia su categoría", r.body);
r = await owner("PATCH", B, { category: "professional_services", name: "Centro Profesional" });
ok(r.status === 200, "pero sí guarda sus datos con la categoría que ya tiene", r.body);
r = await admin("PATCH", B, { category: "veterinaria" });
ok(r.status === 200 && r.body.category === "veterinaria", "el super admin cambia la categoría de un negocio", r.body);

console.log("Desactivar y eliminar");
r = await admin("PUT", "/admin/categories/veterinaria", { ...vet, isActive: false });
ok(r.status === 200 && r.body.isActive === false, "desactivar", r.body);
r = await anon("GET", "/public/categories");
ok(r.body.find((c) => c.id === "veterinaria")?.isActive === false, "sigue en la lista pública marcada como inactiva");
r = await owner("PATCH", B, { category: "veterinaria", name: "Centro Profesional" });
ok(r.status === 200, "el negocio que ya la tiene la conserva al guardar", r.body);
const { session: ls } = await login("laura@demo.com");
r = await admin("PATCH", `/businesses/${ls.businessId}`, { category: "veterinaria" });
ok(r.status === 400, "otro negocio no puede elegir una inactiva", r.body);
r = await admin("DELETE", "/admin/categories/veterinaria");
ok(r.status === 409 && /negocio/.test(r.body.error.message), "no se elimina si está en uso", r.body);
await admin("PATCH", B, { category: "professional_services" });
r = await admin("DELETE", "/admin/categories/veterinaria");
ok(r.status === 204, "se elimina cuando nadie la usa", r.body);

console.log("Altas de negocio");
const base = { timezone: "America/Guayaquil", phone: "", email: "", address: "", plan: "free", ownerFirstName: "Ana", ownerLastName: "Bravo", ownerPassword: "AnaClave2026" };
r = await admin("POST", "/admin/businesses", { ...base, name: "Peludos", slug: "peludos", category: "peluqueria_canina", ownerEmail: "peludos@example.com" });
ok(r.status === 200 && r.body.business.category === "peluqueria_canina" && r.body.business.clinicalRecordsEnabled === true, "alta con una categoría nueva (de salud)", r.body);
const { a: peludos, session: ps } = await login("peludos@example.com", "AnaClave2026");
r = await peludos("GET", `/businesses/${ps.businessId}/services`);
ok(r.body?.[0]?.name === "Consulta veterinaria" && r.body[0].durationMinutes === 30, "primer servicio sugerido por la categoría", r.body);
r = await admin("POST", "/admin/businesses", { ...base, name: "Mal", slug: "mal", category: "nope", ownerEmail: "mal@example.com" });
ok(r.status === 400, "alta con categoría inexistente → 400", r.body);
const newUser = agent();
await newUser("POST", "/auth/register", { firstName: "Luz", lastName: "Nueva", email: "luz@example.com", password: "LuzClave2026", confirmPassword: "LuzClave2026" });
r = await newUser("POST", "/businesses", {
  name: "Dental Luz", category: "dentistry", timezone: "America/Guayaquil", phone: "", email: "", address: "", description: "",
  schedules: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, isActive: true, intervals: [{ start: "09:00", end: "17:00" }] })),
  firstService: { name: "Limpieza", description: "", durationMinutes: 45, price: 30, isActive: true },
});
ok(r.status === 200 && r.body.clinicalRecordsEnabled === true, "onboarding con categoría de salud activa la historia clínica", r.body);

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de categorías pasaron");
process.exitCode = failures ? 1 : 0;
