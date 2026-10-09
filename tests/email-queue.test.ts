// Cola de emails: reintentos con espera creciente (horas, no minutos), cada email marcado apenas sale
// (un corte a mitad del lote no duplica lo enviado) y el tiempo máximo de una pasada.
import { execFileSync } from "node:child_process";
import type { OutgoingEmail } from "../src/services/mailer.ts";

let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};
const sql = (query: string) =>
  execFileSync("psql", [process.env.TEST_DATABASE_URL!, "-qAtc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const { pool } = await import("../src/db/pool.ts");
const { MAX_ATTEMPTS, processEmailQueue, retryDelayMinutes } = await import("../src/services/mailer.ts");

// Sólo los emails de esta prueba.
sql("update notifications set status = 'failed' where status = 'queued'");
let counter = 0;
const queue = (secret: string | null = null) =>
  sql(
    `insert into notifications (business_id, type, to_email, subject, body, status, secret)
     values (null, 'welcome', 'persona${++counter}@correo.ec', 'Bienvenida ${counter}', 'Hola', 'queued', ${secret ? `'${secret}'` : "null"})
     returning id`,
  ).split("\n")[0];
const row = (id: string) =>
  JSON.parse(
    sql(
      `select json_build_object('status', status, 'attempts', attempts, 'error', last_error, 'secret', secret,
              'waitMinutes', round(extract(epoch from next_attempt_at - now()) / 60), 'sentAt', sent_at)
         from notifications where id = '${id}'`,
    ),
  );
const sent: OutgoingEmail[] = [];
const works = async (email: OutgoingEmail) => {
  sent.push(email);
};
const gmailDown = async () => {
  throw new Error("454 Too many login attempts");
};

console.log("Reintentos con espera creciente");
const id = queue("Clave-Secreta-1");
let report = await processEmailQueue({ send: gmailDown });
let email = row(id);
ok(report.retrying === 1 && report.errors[0]?.includes("Too many login attempts"), "falla y queda para reintentar", report);
ok(email.status === "queued" && email.attempts === 1 && email.waitMinutes === 5, "el siguiente intento, en 5 minutos", email);
ok(email.secret === "Clave-Secreta-1", "la contraseña se guarda hasta el último intento", email);
report = await processEmailQueue({ send: works });
ok(report.sent === 0 && sent.length === 0 && row(id).attempts === 1, "antes de esa hora no se vuelve a intentar", [report, row(id)]);
sql(`update notifications set attempts = 3, next_attempt_at = now() where id = '${id}'`);
await processEmailQueue({ send: gmailDown });
email = row(id);
ok(email.status === "queued" && email.attempts === 4 && email.waitMinutes === 40, "al cuarto fallo, 40 minutos (se duplica cada vez)", email);
const totalHours = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => retryDelayMinutes(i + 1)).reduce((a, b) => a + b, 0) / 60;
ok(totalHours >= 8, `${MAX_ATTEMPTS} intentos a lo largo de unas ${Math.round(totalHours)} horas (antes, 5 en minutos)`, totalHours);
sql(`update notifications set attempts = ${MAX_ATTEMPTS - 1}, next_attempt_at = now() where id = '${id}'`);
report = await processEmailQueue({ send: gmailDown });
email = row(id);
ok(report.failed === 1 && email.status === "failed" && email.attempts === MAX_ATTEMPTS, "tras el último intento queda como fallido", [report, email]);
ok(email.secret === null, "y la contraseña se borra", email);

console.log("Cada email se marca apenas sale");
const first = queue();
const second = queue();
let seenFirst: string | null = null;
report = await processEmailQueue({
  send: async (outgoing) => {
    // Al enviar el segundo, el primero ya consta como enviado: si el proceso muriera aquí, no se repetiría.
    if (outgoing.subject.endsWith(String(counter))) seenFirst = row(first).status;
    sent.push(outgoing);
  },
});
ok(report.sent === 2 && seenFirst === "sent", "mientras sale el segundo, el primero ya está marcado como enviado", [report, seenFirst]);
ok(row(first).sentAt && row(second).status === "sent" && row(second).attempts === 1, "los dos enviados, con un intento", [row(first), row(second)]);

console.log("Reserva mientras se envía");
const third = queue();
let duringSend: { status: string; waitMinutes: number } | null = null;
await processEmailQueue({
  send: async () => {
    duringSend = row(third);
  },
});
ok(duringSend?.status === "queued" && duringSend.waitMinutes === 10, "mientras se envía queda reservado 10 minutos: otro proceso no lo toma", duringSend);

console.log("Tiempo máximo de una pasada (Lambda responde en unos segundos)");
const late = [queue(), queue(), queue()];
sent.length = 0;
report = await processEmailQueue({ send: works, deadline: Date.now() - 1 });
const lateRows = late.map(row);
ok(report.sent === 0 && sent.length === 0, "sin tiempo, no empieza envíos", report);
ok(lateRows.every((r) => r.status === "queued" && r.attempts === 0 && r.waitMinutes <= 0), "y lo que había reservado vuelve a la cola ya mismo, sin gastar intentos", lateRows);
report = await processEmailQueue({ send: works });
ok(report.sent === 3, "la pasada siguiente lo envía", report);

await pool.end();
console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas de la cola de emails pasaron");
process.exitCode = failures ? 1 : 0;
