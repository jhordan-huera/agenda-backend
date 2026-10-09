import { hashPassword } from "../services/accounts.ts";
import { emailField } from "../shared/lib/validations/fields.ts";
import { one, pool } from "./pool.ts";

/**
 * `npm run db:create-admin -- <email> [--nombre Ana] [--apellido Pérez]`
 *
 * Crea la cuenta de super admin (operador de la plataforma, panel /admin) o convierte
 * en super admin una cuenta existente sin negocio. Nunca se hace desde la aplicación.
 *
 * La contraseña se pide en la terminal sin mostrarla (o se lee de ADMIN_PASSWORD): como argumento
 * quedaría en el historial de la shell. Mínimo MIN_ADMIN_PASSWORD caracteres.
 */
const MIN_ADMIN_PASSWORD = 12;
const USAGE = "Uso: npm run db:create-admin -- <email> [--nombre Ana] [--apellido Pérez]  (la contraseña se pide después)";

/** Lee una línea de la terminal sin mostrar lo que se escribe. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelado."));
          return;
        }
        if (char === "\u007f" || char === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (char >= " ") value += char;
      }
    };
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    throw new Error("Sin terminal para pedir la contraseña: ejecútalo en una terminal o define ADMIN_PASSWORD.");
  }
  const password = await askHidden(`Contraseña del super admin (mínimo ${MIN_ADMIN_PASSWORD} caracteres, no se muestra): `);
  if (password.length >= MIN_ADMIN_PASSWORD && (await askHidden("Repítela: ")) !== password) {
    throw new Error("Las contraseñas no coinciden.");
  }
  return password;
}

/** El valor de `--nombre X` (o undefined). */
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function createAdmin() {
  const args = process.argv.slice(2);
  const firstName = option(args, "--nombre") ?? "Admin";
  const lastName = option(args, "--apellido") ?? "Agenda360";
  const positional = args.filter((arg, index) => !arg.startsWith("--") && !["--nombre", "--apellido"].includes(args[index - 1]));
  const email = emailField.safeParse(positional[0] ?? "");
  if (!email.success) throw new Error(USAGE);
  if (positional.length > 1) {
    // Antes la contraseña era el segundo argumento: ahora sería el nombre. Mejor parar.
    throw new Error(
      `${USAGE}\nLa contraseña ya no se pasa como argumento (quedaría en el historial de la shell). ` +
        "Si la escribiste, bórrala del historial (p. ej. history -d en bash o editando ~/.zsh_history).",
    );
  }
  const password = await readPassword();
  if (password.length < MIN_ADMIN_PASSWORD) throw new Error(`La contraseña debe tener al menos ${MIN_ADMIN_PASSWORD} caracteres.`);
  // bcrypt sólo usa los primeros 72 bytes: lo que pase de ahí no contaría.
  if (Buffer.byteLength(password) > 72) throw new Error("La contraseña es demasiado larga (máximo 72 bytes).");

  const existing = await one<{ id: string }>(pool, "select id from users where email = $1", [email.data]);
  if (existing) {
    if (await one(pool, "select 1 from business_users where user_id = $1", [existing.id])) {
      throw new Error("Esa cuenta pertenece a un negocio: el super admin debe ser una cuenta aparte.");
    }
    await pool.query(
      "update users set platform_role = 'super_admin', is_active = true, password_hash = $2 where id = $1",
      [existing.id, await hashPassword(password)],
    );
    await makeOwnerIfNone(existing.id);
    console.info(`✓ ${email.data} ahora es super admin (contraseña actualizada).`);
    return;
  }
  const created = await one<{ id: string }>(
    pool,
    `insert into users (first_name, last_name, email, password_hash, platform_role)
     values ($1, $2, $3, $4, 'super_admin') returning id`,
    [firstName, lastName, email.data, await hashPassword(password)],
  );
  await makeOwnerIfNone(created!.id);
  console.info(`✓ Super admin creado: ${email.data}`);
}

/** Si aún no hay super admin principal (el que gestiona a los demás), lo es esta cuenta. */
async function makeOwnerIfNone(userId: string): Promise<void> {
  await pool.query(
    "update users set platform_owner = true where id = $1 and not exists (select 1 from users where platform_owner)",
    [userId],
  );
}

try {
  await createAdmin();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
