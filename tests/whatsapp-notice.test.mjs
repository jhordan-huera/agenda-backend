// Avisos por WhatsApp al cambiar una cita: ajustes del negocio y registro en la actividad.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
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
const login = async (email) => {
  const a = agent();
  const r = await a("POST", "/auth/login", { email, password: "demo1234", remember: true });
  return { a, session: r.body };
};
const sql = (query) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const { a: owner, session } = await login("jhordan@demo.com");
const B = `/businesses/${session.businessId}`;
const { a: staff } = await login("miguel@demo.com");
const { a: other } = await login("laura@demo.com");
const original = (await owner("GET", B)).body.notificationSettings;

try {
  console.log("Ajustes");
  ok(original.whatsappOnStatusChange === true && original.whatsappFollowUps === true, "activados por defecto en los negocios", original);
  const { whatsappOnStatusChange: _a, whatsappFollowUps: _b, ...withoutWhatsApp } = original;
  let r = await owner("PATCH", B, { notificationSettings: withoutWhatsApp });
  ok(r.status === 200 && r.body.notificationSettings.whatsappOnStatusChange === true, "un front de antes (sin los campos nuevos) no los apaga", r.body.notificationSettings);
  r = await owner("PATCH", B, { notificationSettings: { ...original, whatsappFollowUps: false } });
  ok(r.status === 200 && r.body.notificationSettings.whatsappFollowUps === false, "se puede apagar el de Completada / No asistió", r.body.notificationSettings);
  const logs = (await owner("GET", `${B}/audit-logs?limit=5`)).body.entries;
  const change = logs.flatMap((entry) => entry.changes ?? []).find((c) => /completar o marcar No asistió/.test(c.label));
  ok(change?.before === "Sí" && change.after === "No", "el cambio queda en la actividad", logs[0]?.changes);

  console.log("Registro al abrir WhatsApp");
  const appointment = (await owner("GET", `${B}/appointments`)).body.find((a) => a.status !== "cancelled");
  r = await owner("POST", `${B}/appointments/${appointment.id}/whatsapp-notice`, { kind: "confirmed" });
  ok(r.status === 204, "el propietario lo registra", r.body);
  r = await staff("POST", `${B}/appointments/${appointment.id}/whatsapp-notice`, { kind: "rescheduled" });
  ok(r.status === 204, "también el staff (gestiona citas)", r.body);
  r = await owner("POST", `${B}/appointments/${appointment.id}/whatsapp-notice`, { kind: "pending" });
  ok(r.status === 204, "el de una cita cancelada que vuelve a quedar pendiente", r.body);
  r = await owner("POST", `${B}/appointments/${appointment.id}/whatsapp-notice`, { kind: "otra-cosa" });
  ok(r.status === 400, "un aviso que no existe → 400", r.body);
  const laura = (await other("GET", "/auth/session")).body;
  r = await other("POST", `/businesses/${laura.businessId}/appointments/${appointment.id}/whatsapp-notice`, { kind: "confirmed" });
  ok(r.status === 404, "con la cita de otro negocio → 404", r.body);
  const entries = (await owner("GET", `${B}/audit-logs?entityType=appointment&entityId=${appointment.id}`)).body.entries;
  const notices = entries.filter((entry) => entry.action === "appointment.whatsapp_notice");
  ok(
    notices.length === 3 &&
      notices.some((entry) => /^Abrió WhatsApp para avisar que la cita está confirmada a /.test(entry.summary)) &&
      notices.some((entry) => /que la cita vuelve a estar agendada/.test(entry.summary)) &&
      notices.some((entry) => entry.actorName === "Miguel Ortega" && /cambio de la cita/.test(entry.summary)),
    "queda en la actividad de la cita, con quién lo abrió",
    notices.map((entry) => `${entry.actorName}: ${entry.summary}`),
  );

  console.log("Migración 019");
  sql(`update businesses set notification_settings = notification_settings - 'whatsappOnStatusChange' - 'whatsappFollowUps' where id = '${session.businessId}'`);
  const migration = readFileSync(new URL("../db/migrations/019_whatsapp_notices.sql", import.meta.url), "utf8");
  sql(migration.replace(/--.*$/gm, ""));
  r = await owner("GET", B);
  ok(r.body.notificationSettings.whatsappOnStatusChange === true && r.body.notificationSettings.confirmations === original.confirmations, "activa los avisos en los negocios que ya existían", r.body.notificationSettings);
  sql(`update businesses set notification_settings = notification_settings || '{"whatsappFollowUps": false}' where id = '${session.businessId}'`);
  sql(migration.replace(/--.*$/gm, ""));
  r = await owner("GET", B);
  ok(r.body.notificationSettings.whatsappFollowUps === false, "y respeta lo que un negocio ya hubiera apagado", r.body.notificationSettings);
} finally {
  await owner("PATCH", B, { notificationSettings: original });
}

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de avisos por WhatsApp pasaron");
process.exitCode = failures ? 1 : 0;
