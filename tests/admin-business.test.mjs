// Alta de un negocio por el super admin: datos, descripción, servicios y horario, sin propietario; el
// propietario se agrega después.
import { execFileSync } from "node:child_process";
import { businessInput } from "./helpers/business.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else { failures++; console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400)); }
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
  return { a, session: r.body, status: r.status };
};
const sql = (query) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const { a: admin } = await login("admin@demo.com");
const { a: owner } = await login("jhordan@demo.com");

console.log("Validación");
const week = [
  { dayOfWeek: 1, isActive: true, intervals: [{ start: "08:45", end: "13:00" }, { start: "15:00", end: "18:00" }] },
  { dayOfWeek: 3, isActive: true, intervals: [{ start: "09:00", end: "12:00" }] },
  { dayOfWeek: 0, isActive: false, intervals: [] },
];
const input = businessInput({
  name: "Psicóloga Nicole Andrade",
  slug: "psicologa-nicole",
  category: "psychology",
  description: "Terapia individual y de pareja.",
  address: "Cotacachi",
  phone: "0993958155",
  services: [
    { name: "Terapia individual", durationMinutes: 45, price: 30 },
    { name: "Primera entrevista", durationMinutes: 30, price: 0 },
  ],
  schedules: week,
});
let r = await owner("POST", "/admin/businesses", input);
ok(r.status === 403, "un propietario no crea negocios", r.status);
r = await admin("POST", "/admin/businesses", { ...input, services: [] });
ok(r.status === 400 && /al menos un servicio/.test(r.body.error.message), "sin servicios → 400", r.body);
r = await admin("POST", "/admin/businesses", { ...input, services: [{ name: "X", durationMinutes: 45, price: 10 }] });
ok(r.status === 400 && /nombre del servicio/i.test(r.body.error.message), "servicio con nombre muy corto → 400", r.body);
r = await admin("POST", "/admin/businesses", { ...input, schedules: week.map((day) => ({ ...day, isActive: false })) });
ok(r.status === 400 && /al menos un día/.test(r.body.error.message), "sin días de atención → 400", r.body);
r = await admin("POST", "/admin/businesses", { ...input, schedules: [...week, week[0]] });
ok(r.status === 400 && /repetidos/.test(r.body.error.message), "días repetidos → 400", r.body);
r = await admin("POST", "/admin/businesses", { ...input, schedules: [{ dayOfWeek: 1, isActive: true, intervals: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "14:00" }] }] });
ok(r.status === 400 && /solaparse/.test(r.body.error.message), "intervalos que se solapan → 400", r.body);

console.log("Alta sin propietario");
r = await admin("POST", "/admin/businesses", { ...input, ownerEmail: "ignorado@example.com" });
ok(r.status === 200 && r.body.business.ownerId === null && !("ownerEmail" in r.body), "se crea sin propietario", r.body);
const business = r.body.business;
const B = `/businesses/${business.id}`;
ok(business.description === "Terapia individual y de pareja." && business.email === "" && business.phone === "0993958155", "con su descripción, sin email del negocio", business);
ok(Number(sql("select count(*) from users where email = 'ignorado@example.com'")) === 0, "no se crea ninguna cuenta");
ok(Number(sql(`select count(*) from notifications where business_id = '${business.id}'`)) === 0, "ni se envía ningún email");
const services = (await admin("GET", `${B}/services`)).body;
const byName = Object.fromEntries(services.map((s) => [s.name, s]));
ok(services.length === 2, "con los dos servicios", services.map((s) => s.name));
ok(byName["Terapia individual"]?.durationMinutes === 45 && byName["Terapia individual"].price === 30 && byName["Terapia individual"].showPrice, "duración y precio visible", byName["Terapia individual"]);
ok(byName["Primera entrevista"]?.price === 0 && !byName["Primera entrevista"].showPrice, "precio 0: no se muestra (no «Gratis»)", byName["Primera entrevista"]);
const [agenda] = (await admin("GET", `${B}/professionals`)).body;
ok(agenda?.userId === null && agenda.displayName === "Psicóloga Nicole Andrade", "una agenda con el nombre del negocio, sin usuario", agenda);
const schedules = (await admin("GET", `${B}/schedules`)).body.filter((s) => s.professionalId === agenda.id);
const monday = schedules.find((s) => s.dayOfWeek === 1);
ok(
  monday?.isActive && monday.intervals.length === 2 && monday.intervals[0].start === "08:45" && monday.intervals[1].end === "18:00",
  "el horario elegido (mañana y tarde)",
  schedules,
);
ok(!schedules.some((s) => s.dayOfWeek === 2 && s.isActive), "los días no enviados quedan sin atención", schedules);
const list = (await admin("GET", "/admin/businesses")).body.find((row) => row.business.id === business.id);
ok(list && list.owner === null && list.usage.users === 0, "el listado lo muestra sin propietario", list);
const detail = (await admin("GET", `/admin/businesses/${business.id}`)).body;
ok(detail.owner === null && detail.members.length === 0, "el detalle también", detail.owner);
const profile = (await agent()("GET", `/public/businesses/${business.slug}`)).body;
ok(profile?.services?.length === 2 && profile.professionals[0].displayName === "Psicóloga Nicole Andrade", "su página de reservas ya funciona", profile?.services);
r = await admin("POST", "/admin/businesses", { ...input, name: "Otro" });
ok(r.status === 409 && /enlace/.test(r.body.error.message), "enlace repetido → 409", r.body);

console.log("Agregar el propietario después");
const ownerInput = { firstName: "Nicole", lastName: "Andrade", email: "nicole@example.com", password: "NicoleClave2026" };
r = await owner("POST", `/admin/businesses/${business.id}/owner`, ownerInput);
ok(r.status === 403, "sólo el super admin", r.status);
r = await admin("POST", `/admin/businesses/${business.id}/owner`, { ...ownerInput, password: "corta" });
ok(r.status === 400 && /8 caracteres/.test(r.body.error.message), "contraseña corta → 400", r.body);
r = await admin("POST", `/admin/businesses/${business.id}/owner`, { ...ownerInput, email: "jhordan@demo.com" });
ok(r.status === 409 && /otro negocio/.test(r.body.error.message), "un email de otro negocio → 409", r.body);
r = await admin("POST", `/admin/businesses/${business.id}/owner`, ownerInput);
ok(r.status === 200 && r.body.role === "owner" && r.body.email === "nicole@example.com", "se agrega como propietario", r.body);
const nicole = await login("nicole@example.com", "NicoleClave2026");
ok(nicole.status === 200 && nicole.session.businessId === business.id && nicole.session.role === "owner", "entra a su negocio con la contraseña elegida", nicole.session);
const [linked] = (await nicole.a("GET", `${B}/professionals`)).body;
ok(linked.id === agenda.id && linked.userId === r.body.userId && linked.displayName === "Nicole Andrade", "la agenda del alta pasa a ser la suya, con su nombre", linked);
const after = (await admin("GET", `/admin/businesses/${business.id}`)).body;
ok(after.owner?.email === "nicole@example.com" && after.business.email === "nicole@example.com", "el negocio tiene propietario y su email para los avisos", after.business.email);
const welcome = sql(`select type || '|' || to_email || '|' || subject from notifications where business_id = '${business.id}' order by created_at desc limit 1`);
ok(/^business_created\|nicole@example.com\|/.test(welcome), "le llega el email de bienvenida con su acceso", welcome);
ok(/Agregó a Nicole Andrade como propietario/.test(sql(`select summary from audit_logs where action = 'platform.owner_assigned' and business_id = '${business.id}'`)), "queda en la auditoría");
r = await admin("POST", `/admin/businesses/${business.id}/owner`, { ...ownerInput, email: "otra@example.com" });
ok(r.status === 409 && /ya tiene propietario/.test(r.body.error.message), "un segundo propietario → 409", r.body);

console.log("Con varias agendas, ninguna se asigna sola");
r = await admin("POST", "/admin/businesses", businessInput({ name: "Centro Varias", slug: "centro-varias", plan: "business" }));
const multi = r.body.business;
const [firstAgenda] = (await admin("GET", `/businesses/${multi.id}/professionals`)).body;
r = await admin("POST", `/businesses/${multi.id}/professionals`, {
  displayName: "Dr. Pérez", title: "", avatarUrl: null, color: "#2f9e8f", email: "", userId: null,
  allServices: true, serviceIds: [], notifyNewAppointments: true, dailyAgenda: true, isActive: true,
});
ok(r.status === 200, "el super admin agrega otra agenda antes del propietario", r.body);
r = await admin("POST", `/admin/businesses/${multi.id}/owner`, { firstName: "Laura", lastName: "Centro", email: "laura.centro@example.com", password: "LauraClave2026" });
ok(r.status === 200, "propietario agregado", r.body);
const agendas = (await admin("GET", `/businesses/${multi.id}/professionals`)).body;
ok(agendas.every((p) => p.userId === null) && agendas.some((p) => p.id === firstAgenda.id && p.displayName === "Centro Varias"), "las agendas siguen sin usuario (se vinculan en Profesionales)", agendas);

if (failures) {
  console.log(`\n${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log("\nTodo bien");
