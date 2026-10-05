// Cron de Vercel (POST /api/cron/run), aviso de ntfy (scripts/cron.ts) e IP real por el proxy.
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { buildNotice } from "../scripts/cron.ts";
import { cedulaFor } from "./helpers/cedula.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
const CRON_SECRET = process.env.CRON_SECRET;
const PROXY_SECRET = process.env.PROXY_SECRET;
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  }
};
const sql = (query) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const cron = (secret) =>
  fetch(`${BASE}/cron/run`, { method: "POST", headers: secret ? { Authorization: `Bearer ${secret}` } : {} }).then(async (res) => ({
    status: res.status,
    body: await res.json().catch(() => undefined),
  }));

console.log("Ruta del cron");
let r = await cron();
ok(r.status === 401, "sin secreto → 401", r);
r = await cron("x".repeat(40));
ok(r.status === 401, "secreto incorrecto → 401", r);
r = await cron(CRON_SECRET);
const queued = Number(sql("select count(*) from notifications where status = 'queued'"));
ok(
  r.status === 200 && r.body.since === null && typeof r.body.reminders === "number" && r.body.emails.sent === 0 && r.body.pending === queued,
  "primera ejecución: resumen (sin Gmail en las pruebas, todo queda en cola)",
  r.body,
);
const firstRun = sql("select ran_at from cron_runs order by ran_at desc limit 1");
ok(firstRun !== "", "queda registrada en cron_runs");
r = await cron(CRON_SECRET);
ok(r.status === 200 && r.body.since && Math.abs(Date.parse(r.body.since) - Date.parse(firstRun)) < 1000, "la siguiente cuenta desde la anterior", [r.body.since, firstRun]);

sql("update notifications set status = 'sent', sent_at = now() where id = (select id from notifications where status = 'queued' order by created_at limit 1)");
r = await cron(CRON_SECRET);
ok(r.body?.sentSinceLastRun === 1, "cuenta los correos enviados al momento (fuera del cron)", r.body);
r = await cron(CRON_SECRET);
ok(r.body?.sentSinceLastRun === 0, "y no los vuelve a contar", r.body);

console.log("Aviso de ntfy");
const base = { reminders: 0, sentSinceLastRun: 0, since: null, pending: 0, durationMs: 10 };
const emails = (patch) => ({ sent: 0, retrying: 0, failed: 0, skipped: 0, errors: [], ...patch });
ok(buildNotice({ ...base, emails: emails() }) === null, "sin novedades no avisa");
let notice = buildNotice({ ...base, reminders: 2, sentSinceLastRun: 3, emails: emails({ sent: 2 }) });
ok(notice?.priority === 2 && notice.title === "Agenda360: 3 correos enviados" && /2 recordatorios nuevos/.test(notice.message), "correos enviados: aviso discreto", notice);
notice = buildNotice({ ...base, emails: emails({ retrying: 1, errors: ["Gmail: 454 Too many login attempts"] }) });
ok(notice?.priority === 3 && /1 correo no se pudo enviar/.test(notice.title) && /Too many login attempts/.test(notice.message), "reintentos: aviso normal con el error", notice);
notice = buildNotice({ ...base, pending: 4, emails: emails({ failed: 2, retrying: 1, errors: ["invalid_grant"] }) });
ok(notice?.priority === 4 && /3 correos no se pudieron enviar/.test(notice.title) && /No se enviarán.*2/.test(notice.message) && /Siguen en cola: 4/.test(notice.message), "fallos definitivos: prioridad alta", notice);

// scripts/cron.ts completo contra un ntfy de mentira.
const received = [];
const ntfy = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push(JSON.parse(body));
    res.end("{}");
  });
});
await new Promise((resolve) => ntfy.listen(0, "127.0.0.1", resolve));
const runScript = (secret) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/cron.ts"], {
      env: {
        PATH: process.env.PATH,
        API_URL: BASE.replace(/\/api$/, ""),
        CRON_SECRET: secret,
        NTFY_TOPIC: "agendo-pruebas",
        NTFY_SERVER: `http://127.0.0.1:${ntfy.address().port}`,
        APP_URL: "https://agendo.example",
      },
      stdio: "ignore",
    });
    child.on("exit", (code) => resolve(code));
  });
sql("update notifications set status = 'sent', sent_at = now() where id = (select id from notifications where status = 'queued' order by created_at limit 1)");
let code = await runScript(CRON_SECRET);
ok(code === 0 && received.length === 1 && received[0].topic === "agendo-pruebas" && received[0].priority === 2 && received[0].click === "https://agendo.example/admin", "el script avisa de los correos enviados", received);
code = await runScript("y".repeat(40));
ok(code === 1 && received.length === 2 && received[1].priority === 5 && /401/.test(received[1].message), "si la API rechaza el secreto: aviso urgente y el job falla", received[1]);
ntfy.close();

console.log("IP real por el proxy del frontend");
const lookup = (headers) =>
  fetch(`${BASE}/public/businesses/jhordan/clients/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...headers },
    body: JSON.stringify({ documentId: cedulaFor("proxy") }),
  }).then((res) => res.status);
const viaProxy = (ip, secret = PROXY_SECRET) => ({ "x-agendo-proxy-secret": secret, "x-agendo-client-ip": ip });
const statuses = [];
for (let i = 0; i < 31; i++) statuses.push(await lookup(viaProxy("203.0.113.7")));
ok(statuses.slice(0, 30).every((s) => s === 200) && statuses[30] === 429, "cada visitante tiene su propio límite (30 búsquedas)", statuses.slice(28));
ok((await lookup(viaProxy("203.0.113.8"))) === 200, "otro visitante detrás del mismo proxy no queda bloqueado");
ok((await lookup(viaProxy("203.0.113.7", "secreto-falso-de-mas-de-24-caracteres"))) === 200, "sin el secreto, la cabecera se ignora (no se puede falsear la IP)");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas del cron pasaron");
process.exitCode = failures ? 1 : 0;
