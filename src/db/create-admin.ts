import { hashPassword } from "../services/accounts.ts";
import { emailField } from "../shared/lib/validations/fields.ts";
import { one, pool } from "./pool.ts";

/**
 * `npm run db:create-admin -- <email> <contraseña> [nombre] [apellido]`
 *
 * Crea la cuenta de super admin (operador de la plataforma, panel /admin) o convierte
 * en super admin una cuenta existente sin negocio. Nunca se hace desde la aplicación.
 */
async function createAdmin() {
  const [rawEmail, password, firstName = "Admin", lastName = "Agenda360"] = process.argv.slice(2);
  const email = emailField.safeParse(rawEmail ?? "");
  if (!email.success || !password) {
    throw new Error("Uso: npm run db:create-admin -- <email> <contraseña> [nombre] [apellido]");
  }
  if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");

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
