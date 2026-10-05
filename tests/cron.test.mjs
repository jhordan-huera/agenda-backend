// Cron de recordatorios (scripts/cron.ts, directo contra la base, sin Vercel), aviso de ntfy e IP real por el proxy.
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { buildNotice } from "../scripts/cron.ts";
import { cedulaFor } from "./helpers/cedula.mjs";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100/api";
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

console.log("La API ya no hace el trabajo del cron");
let r = await fetch(`${BASE}/cron/run`, { method: "POST", headers: { "X-Requested-With": "fetch" } });
ok(r.status === 404, "POST /api/cron/run ya no existe", r.status);

// scripts/cron.ts completo, contra la base de pruebas y un ntfy de mentira (sin Gmail: los correos quedan en cola).
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
const runScript = (extraEnv = {}) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, ["scripts/cron.ts"], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DATABASE_SSL: "false",
        FRONTEND_URL: "https://agendo.example",
        LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
        NTFY_TOPIC: "agendo-pruebas",
        NTFY_SERVER: `http://127.0.0.1:${ntfy.address().port}`,
        APP_URL: "https://agendo.example",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => resolve({ code, output }));
  });
const lastRun = () => JSON.parse(sql("select json_build_object('ranAt', ran_at, 'report', report) from cron_runs order by ran_at desc limit 1") || "null");

console.log("Cron directo contra la base");
const queuedBefore = Number(sql("select count(*) from notifications where status = 'queued'"));
const remindersBefore = Number(sql("select count(*) from notifications where type = 'appointment_reminder'"));
let run = await runScript();
let first = lastRun();
const remindersAfter = Number(sql("select count(*) from notifications where type = 'appointment_reminder'"));
ok(run.code === 0 && first?.report.since === null, "primera ejecución: termina bien y queda en cron_runs", run.output.slice(-300));
ok(first?.report.reminders > 0 && first.report.reminders === remindersAfter - remindersBefore, "pone en cola los recordatorios de las citas próximas", [first?.report.reminders, remindersAfter - remindersBefore]);
ok(Number(sql("select count(*) from notifications where status = 'queued'")) === queuedBefore + first.report.reminders, "sin Gmail no envía nada: todo sigue en cola");
ok(/Recordatorios: \d+ · enviados/.test(run.output) && !/@/.test(run.output), "el registro (público en GitHub) sólo lleva cifras, ningún email", run.output.slice(-300));
ok(received.length === 1 && received[0].priority === 4 && /no tiene acceso a Gmail/.test(received[0].title), "avisa que faltan las credenciales de Gmail", received[0]);
run = await runScript();
let second = lastRun();
ok(run.code === 0 && second.report.reminders === 0 && Math.abs(Date.parse(second.report.since) - Date.parse(first.ranAt)) < 1000, "la siguiente cuenta desde la anterior y no repite recordatorios", second.report);

sql("update notifications set status = 'sent', sent_at = now() where id = (select id from notifications where status = 'queued' order by created_at limit 1)");
await runScript();
ok(lastRun().report.sentSinceLastRun === 1, "cuenta los correos que la API envió al momento", lastRun().report);
await runScript();
ok(lastRun().report.sentSinceLastRun === 0, "y no los vuelve a contar", lastRun().report);

received.length = 0;
run = await runScript({ DATABASE_URL: "" });
ok(run.code === 1 && received.length === 1 && received[0].priority === 5 && /DATABASE_URL/.test(received[0].message), "sin base de datos: aviso urgente y el job falla", received[0]);
ntfy.close();

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
ok(buildNotice({ ...base, emails: emails() }, { gmailConfigured: false }) === null, "sin Gmail pero sin nada en cola: no avisa");

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
