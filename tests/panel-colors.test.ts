// Colores del panel de plataforma (spec 007): cada super admin elige los suyos, se guardan en su cuenta y
// llegan con la sesión. Nadie cambia los de otro y las cuentas de los negocios no los tienen.
import { execFileSync } from "node:child_process";
import type { BrandColors } from "../src/shared/types/index.ts";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const DEMO = "demo1234";
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 500));
  }
};
function agent() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
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
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const login = async (email: string, secret = DEMO) => {
  const a = agent();
  const session = (await a("POST", "/auth/login", { email, password: secret, remember: true })).body;
  return { a, session };
};
const panelColorsOf = async (a: ReturnType<typeof agent>) => (await a("GET", "/auth/session")).body?.panelColors as BrandColors | null;

const eucalipto: BrandColors = { primary: "#2f6b5e", highlight: "#ddd4f8" };
const { a: admin, session: adminSession } = await login("admin@demo.com");

console.log("Sin colores elegidos");
ok(adminSession.panelColors === null, "la sesión del super admin trae null (colores de Agenda360)", adminSession.panelColors);

console.log("Guardar");
const auditBefore = sql("select count(*) from audit_logs");
let r = await admin("PUT", "/admin/panel-colors", { colors: eucalipto });
ok(sql("select count(*) from audit_logs") === auditBefore, "no queda en la auditoría (preferencia personal)");
ok(r.status === 200 && r.body.colors?.primary === eucalipto.primary && r.body.colors?.highlight === eucalipto.highlight, "guarda una paleta", r.body);
ok((await panelColorsOf(admin))?.primary === eucalipto.primary, "la sesión los trae");
const { session: again } = await login("admin@demo.com");
ok(again.panelColors?.primary === eucalipto.primary && again.panelColors?.highlight === eucalipto.highlight, "y siguen al entrar de nuevo (otro navegador)", again.panelColors);

console.log("Validación");
r = await admin("PUT", "/admin/panel-colors", { colors: { primary: "verde", highlight: "#ddd4f8" } });
ok(r.status === 400, "un color sin el formato #rrggbb → 400", r.body);
r = await admin("PUT", "/admin/panel-colors", { colors: { primary: "#2f6b5e" } });
ok(r.status === 400, "falta uno de los dos colores → 400", r.body);
ok((await panelColorsOf(admin))?.primary === eucalipto.primary, "y no cambia lo guardado");

console.log("Sólo la cuenta propia");
const helper = { firstName: "Pía", lastName: "Panel", email: "pia.panel@example.com", password: `Panel-${Date.now()}` };
r = await admin("POST", "/admin/platform-admins", helper);
ok(r.status === 200, "el principal agrega otro super admin", r.body);
const { a: pia, session: piaSession } = await login(helper.email, helper.password);
ok(piaSession.panelColors === null, "el otro super admin no recibe los colores del principal", piaSession.panelColors);
r = await pia("PUT", "/admin/panel-colors", { colors: { primary: "#6650a8", highlight: "#f7d6e6" } });
ok(r.status === 200, "y guarda los suyos", r.body);
ok((await panelColorsOf(admin))?.primary === eucalipto.primary, "sin cambiar los del principal");
ok((await panelColorsOf(pia))?.primary === "#6650a8", "cada uno ve los suyos");
r = await admin("PUT", "/admin/panel-colors", { colors: eucalipto, userId: piaSession.userId });
ok(r.status === 200 && (await panelColorsOf(pia))?.primary === "#6650a8", "un id de otra cuenta en el pedido no cambia nada");

console.log("Las cuentas de los negocios");
const { a: owner, session: ownerSession } = await login("ricardo@demo.com");
ok(ownerSession.panelColors === null, "la sesión de un propietario trae null", ownerSession.panelColors);
r = await owner("PUT", "/admin/panel-colors", { colors: eucalipto });
ok(r.status === 403, "un propietario no puede guardarlos → 403", r.body);
ok(sql(`select panel_colors is null from users where id = '${ownerSession.userId}'`) === "t", "y su cuenta queda sin colores");

console.log("Volver a Agenda360");
r = await admin("PUT", "/admin/panel-colors", { colors: null });
ok(r.status === 200 && r.body.colors === null, "con null", r.body);
ok((await panelColorsOf(admin)) === null, "la sesión vuelve a null");

console.log("La base");
let rejected = false;
try {
  sql(`update users set panel_colors = '{"primary": "rojo", "highlight": "#ffffff"}' where id = '${adminSession.userId}'`);
} catch {
  rejected = true;
}
ok(rejected, "la comprobación de la columna rechaza un valor mal formado");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de los colores del panel pasaron");
process.exitCode = failures ? 1 : 0;
