// Modo de pantalla (spec 019): cada persona elige «Claro», «Oscuro» o «Automático» en su cuenta y le
// llega con la sesión, también en otro equipo. Todos empiezan en «Automático», también las cuentas que ya
// existían. Nadie cambia el de otro, y cada cambio queda en la actividad: la de su negocio o, el super
// admin (también en modo soporte y sin la verificación en dos pasos), la de la plataforma.
import { readFileSync } from "node:fs";
import { agent, checks, count, login, sql, startApi } from "./helpers/harness.ts";

const { ok, done } = checks();

// Cada navegador con su IP (por el proxy firmado): los límites de una prueba no gastan los de otra.
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;
const as = (email: string, options: { base?: string } = {}) => login(email, { ip: nextIp(), ...options });
type Browser = ReturnType<typeof agent>;
const modeOf = async (browser: Browser) => (await browser("GET", "/auth/session")).body?.themeMode;
const setMode = (browser: Browser, body: unknown) => browser("PUT", "/auth/theme-mode", body);
const tag = Date.now().toString(36);

type ModeAuditRow = {
  businessId: string | null;
  actorName: string;
  entityType: string;
  entityId: string;
  summary: string;
  changes: { label: string; before: string; after: string }[] | null;
};
/** Las entradas de la actividad de los cambios de modo de esta persona, de la más antigua a la más nueva. */
const modeAudit = (userId: string): ModeAuditRow[] =>
  JSON.parse(
    sql(
      `select coalesce(json_agg(json_build_object('businessId', business_id, 'actorName', actor_name, 'entityType', entity_type,
                'entityId', entity_id, 'summary', summary, 'changes', changes) order by created_at), '[]')
         from audit_logs where actor_id = '${userId}' and action = 'user.theme_mode_changed'`,
    ),
  );
const changesOf = (row?: ModeAuditRow) => JSON.stringify(row?.changes?.map(({ label, before, after }) => [label, before, after]) ?? null);
const summaryOf = (from: string, to: string) => `Cambió el modo de pantalla de «${from}» a «${to}»`;

console.log("Todos empiezan en «Automático»");
// Las cuentas de los datos demo se cargan después de las migraciones: para ver qué pasa con las que ya
// existían, se vuelve a aplicar la 044 sobre ellas, como en producción.
const users = count("select count(*) from users");
sql("alter table users drop column theme_mode");
sql(readFileSync(new URL("../db/migrations/044_theme_mode.sql", import.meta.url), "utf8"));
ok(users > 0 && count("select count(*) from users where theme_mode = 'auto'") === users, "la migración 044 deja en «Automático» las cuentas que ya existían", users);
const ricardo = await as("ricardo@demo.com");
ok(ricardo.session.themeMode === "auto" && (await modeOf(ricardo)) === "auto", "una cuenta de los datos demo: «Automático» al entrar y en GET /auth/session", ricardo.session);
const newcomer = agent({ ip: nextIp() });
let r = await newcomer("POST", "/auth/register", {
  firstName: "Nora",
  lastName: "Nueva",
  email: `nora.${tag}@correo.ec`,
  password: "Clave12345",
  confirmPassword: "Clave12345",
});
ok(r.status === 201 && r.body.themeMode === "auto" && (await modeOf(newcomer)) === "auto", "una cuenta nueva (registro): también", r.body);

console.log("Cambiar el modo");
r = await setMode(ricardo, { mode: "dark" });
ok(r.status === 200 && JSON.stringify(r.body) === JSON.stringify({ mode: "dark" }), 'PUT /auth/theme-mode { mode: "dark" } → 200 { mode: "dark" }', r);
ok((await modeOf(ricardo)) === "dark", "la sesión lo trae");
const ricardoOther = await as("ricardo@demo.com");
ok(ricardoOther.session.themeMode === "dark" && (await modeOf(ricardoOther)) === "dark", "y otra sesión suya (otro equipo) también: al entrar y en GET /auth/session", ricardoOther.session);
r = await setMode(ricardoOther, { mode: "light" });
ok(r.status === 200 && (await modeOf(ricardo)) === "light", "lo que cambia en un equipo llega a la sesión que ya tenía abierta en el otro", r.body);

console.log("Sólo la cuenta propia");
const valeria = await as("valeria@demo.com");
ok(valeria.session.role === "professional" && valeria.session.businessId === ricardo.session.businessId, "valeria@demo.com tiene el rol Profesional en el mismo negocio", valeria.session);
r = await setMode(ricardo, { mode: "dark", userId: valeria.session.userId });
ok(r.status === 200 && (await modeOf(valeria)) === "auto" && (await modeOf(ricardo)) === "dark", "un id de otra cuenta en el pedido sólo cambia la propia", r.body);
ok(sql("select string_agg(email, ',' order by email) from users where theme_mode <> 'auto'") === "ricardo@demo.com", "en la base sólo cambió su cuenta");

console.log("Validación");
const wrong = await setMode(ricardo, { mode: "azul" });
const empty = await setMode(ricardo, {});
ok(
  wrong.status === 400 && wrong.body.error.code === "validation" && wrong.body.error.message === "Elige Claro, Oscuro o Automático" &&
    empty.status === 400 && empty.body.error.code === "validation",
  '{ mode: "azul" } y {} → 400',
  [wrong.body, empty.body],
);
ok((await modeOf(ricardo)) === "dark", "y no cambia lo guardado");
r = await agent({ ip: nextIp() })("PUT", "/auth/theme-mode", { mode: "dark" });
ok(r.status === 401, "sin sesión → 401", r);

console.log("La actividad");
const dental = ricardo.session.businessId as string;
let rows = modeAudit(ricardo.session.userId);
ok(
  rows.length === 3 &&
    rows.every((row) => row.businessId === dental && row.actorName === "Ricardo Paredes" && row.entityType === "user" && row.entityId === ricardo.session.userId),
  "el propietario: en la actividad de su negocio, como autor y sobre su cuenta (los pedidos rechazados no dejan nada)",
  rows,
);
ok(
  rows.map((row) => row.summary).join(" | ") ===
    [summaryOf("Automático", "Oscuro"), summaryOf("Oscuro", "Claro"), summaryOf("Claro", "Oscuro")].join(" | "),
  "con el modo anterior y el nuevo en el resumen",
  rows,
);
ok(
  changesOf(rows[0]) === JSON.stringify([["Modo de pantalla", "Automático", "Oscuro"]]) &&
    changesOf(rows[1]) === JSON.stringify([["Modo de pantalla", "Oscuro", "Claro"]]),
  "y en los cambios («Modo de pantalla: Automático → Oscuro»)",
  rows,
);
r = await setMode(valeria, { mode: "light" });
rows = modeAudit(valeria.session.userId);
ok(
  r.status === 200 && rows.length === 1 && rows[0].businessId === dental && rows[0].actorName === "Valeria Cruz" &&
    rows[0].summary === summaryOf("Automático", "Claro") && changesOf(rows[0]) === JSON.stringify([["Modo de pantalla", "Automático", "Claro"]]),
  "el rol Profesional: también en la actividad de su negocio",
  rows,
);
r = await ricardo("GET", `/businesses/${dental}/audit-logs?action=user.theme_mode_changed`);
ok(
  r.status === 200 && r.body.entries.length === 4 && r.body.entries[0].actorName === "Valeria Cruz" && r.body.entries[0].entityType === "user",
  "el propietario los ve en la actividad del negocio",
  r.body,
);

const admin = await as("admin@demo.com");
r = await setMode(admin, { mode: "dark" });
// Modo soporte: abre el panel de un negocio y, desde ahí, vuelve a cambiarlo.
const support = await admin("GET", `/businesses/${dental}`);
const r2 = await setMode(admin, { mode: "auto" });
// Sin la verificación en dos pasos (obligatoria en otra API): /admin la pide, el modo no.
const strict = await startApi({ SUPER_ADMIN_2FA: "required" });
const adminStrict = await as("admin@demo.com", { base: strict.base });
const blocked = await adminStrict("GET", "/admin/stats");
const r3 = await setMode(adminStrict, { mode: "light" });
strict.stop();
ok(
  r.status === 200 && support.status === 200 && r2.status === 200 && blocked.body?.error?.code === "two_factor_required" && r3.status === 200 && r3.body.mode === "light",
  "el super admin lo cambia, también en modo soporte y sin la verificación en dos pasos",
  [r.body, support.status, r2.body, blocked.body, r3.body],
);
rows = modeAudit(admin.session.userId);
ok(
  rows.length === 3 && rows.every((row) => row.businessId === null && row.actorName === "Admin Agenda360 (Super admin)" && row.entityId === admin.session.userId),
  "y queda en la actividad de la plataforma (business_id null), nunca en la del negocio que estaba viendo",
  rows,
);
ok(
  rows.map((row) => row.summary).join(" | ") ===
    [summaryOf("Automático", "Oscuro"), summaryOf("Oscuro", "Automático"), summaryOf("Automático", "Claro")].join(" | ") &&
    changesOf(rows[2]) === JSON.stringify([["Modo de pantalla", "Automático", "Claro"]]),
  "con el modo anterior y el nuevo",
  rows,
);
r = await admin("GET", "/admin/audit-logs?action=user.theme_mode_changed");
const platformRows = (r.body?.entries ?? []).filter((entry: { actorId: string }) => entry.actorId === admin.session.userId);
ok(r.status === 200 && platformRows.length === 3 && platformRows.every((entry: { businessId: string | null }) => entry.businessId === null), "el super admin los ve en la actividad de la plataforma", r.body);

console.log("El mismo modo dos veces");
r = await setMode(valeria, { mode: "dark" });
const entries = count("select count(*) from audit_logs");
const again = await setMode(valeria, { mode: "dark" });
ok(
  r.status === 200 && again.status === 200 && JSON.stringify(again.body) === JSON.stringify({ mode: "dark" }) && count("select count(*) from audit_logs") === entries,
  "responde 200 { mode } y no deja una segunda entrada",
  again,
);
ok(modeAudit(valeria.session.userId).length === 2 && (await modeOf(valeria)) === "dark", "sólo el primero cuenta como cambio");

console.log("La base");
for (const value of ["'azul'", "null"]) {
  let rejected = false;
  try {
    sql(`update users set theme_mode = ${value} where id = '${ricardo.session.userId}'`);
  } catch {
    rejected = true;
  }
  ok(rejected, `la columna rechaza ${value} escrito directo con SQL`);
}
ok((await modeOf(ricardo)) === "dark", "y lo guardado sigue igual");

done("del modo de pantalla");
