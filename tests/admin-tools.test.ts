// Herramientas locales: db:create-admin (contraseña fuera de los argumentos, 8 caracteres como
// mínimo) y db:migrate (schema_migrations con RLS).
import { spawnSync } from "node:child_process";
import pg from "pg";

const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  }
};

const createAdmin = (args: string[], password?: string) =>
  spawnSync(process.execPath, ["src/db/create-admin.ts", ...args], {
    env: { ...process.env, ADMIN_PASSWORD: password ?? "" },
    encoding: "utf8",
    input: "",
  });

try {
  console.log("db:create-admin");
  let r = createAdmin(["operador@example.com", "--nombre", "Olga", "--apellido", "Ortiz"], "corta1");
  ok(r.status === 1 && /al menos 8 caracteres/.test(r.stderr), "exige 8 caracteres", r.stderr);
  r = createAdmin(["operador@example.com", "Contraseña-larga-2026"]);
  ok(r.status === 1 && /ya no se pasa como argumento/.test(r.stderr), "la contraseña como argumento se rechaza (quedaría en el historial)", r.stderr);
  r = createAdmin(["operador@example.com"]);
  ok(r.status === 1 && /ADMIN_PASSWORD/.test(r.stderr), "sin terminal ni ADMIN_PASSWORD no sigue", r.stderr);
  r = createAdmin(["operador@example.com", "--nombre", "Olga", "--apellido", "Ortiz"], "Contraseña-larga-2026");
  ok(r.status === 0 && !r.stdout.includes("Contraseña-larga-2026"), "con ADMIN_PASSWORD crea la cuenta", r.stdout + r.stderr);
  const user = (await db.query("select first_name, last_name, platform_role from users where email = 'operador@example.com'")).rows[0];
  ok(user?.platform_role === "super_admin" && user.first_name === "Olga" && user.last_name === "Ortiz", "super admin con su nombre", user);

  console.log("db:migrate");
  const rls = (await db.query("select relrowsecurity from pg_class where oid = 'schema_migrations'::regclass")).rows[0];
  ok(rls?.relrowsecurity === true, "schema_migrations nace con RLS en una base nueva", rls);
} finally {
  await db.query("delete from users where email = 'operador@example.com'").catch(() => undefined);
  await db.end();
}

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
