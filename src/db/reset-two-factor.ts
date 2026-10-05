import { emailField } from "../shared/lib/validations/fields.ts";
import { one, pool } from "./pool.ts";

/**
 * `npm run db:reset-2fa -- <email>`
 *
 * Emergencia: desactiva la verificación en dos pasos de una cuenta que perdió el celular y sus
 * códigos de recuperación, y cierra sus sesiones. Se ejecuta desde tu ordenador contra la base
 * del DATABASE_URL de .env (nunca desde la aplicación). Queda en la auditoría.
 */
async function resetTwoFactor() {
  const email = emailField.safeParse(process.argv[2] ?? "");
  if (!email.success) throw new Error("Uso: npm run db:reset-2fa -- <email>");
  const user = await one<{ id: string; name: string; enabled: boolean }>(
    pool,
    `select id, first_name || ' ' || last_name as name, two_factor_secret is not null as enabled from users where email = $1`,
    [email.data],
  );
  if (!user) throw new Error(`No existe ninguna cuenta con el email ${email.data}.`);
  if (!user.enabled) {
    console.info(`${email.data} no tiene activada la verificación en dos pasos: no hay nada que hacer.`);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update users
          set two_factor_secret = null, two_factor_pending_secret = null, two_factor_enabled_at = null,
              two_factor_last_step = null, two_factor_recovery_codes = '{}'
        where id = $1`,
      [user.id],
    );
    await client.query("delete from sessions where user_id = $1", [user.id]);
    await client.query("delete from login_challenges where user_id = $1", [user.id]);
    await client.query(
      `insert into audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id, summary)
       values (null, null, 'Comando db:reset-2fa', 'session.two_factor_reset', 'session', $1, $2)`,
      [user.id, `Se desactivó la verificación en dos pasos de ${user.name} desde el servidor (emergencia)`],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  console.info(`✓ Verificación en dos pasos desactivada para ${email.data}. Entra con tu contraseña y vuelve a activarla.`);
}

try {
  await resetTwoFactor();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
