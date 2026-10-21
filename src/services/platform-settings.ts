import { one, type Db } from "../db/pool.ts";
import type { BankAccount, PlatformSettings } from "../shared/types/index.ts";

/** Configuración global (una sola fila en platform_settings). */
export async function getPlatformSettings(db: Db): Promise<PlatformSettings> {
  return (await one<PlatformSettings>(
    db,
    `select allow_public_signup as "allowPublicSignup", support_email as "supportEmail", support_phone as "supportPhone"
       from platform_settings`,
  ))!;
}

/**
 * Las cuentas de Agenda360 para recibir las mensualidades (spec 029, migración 049). Van aparte de
 * getPlatformSettings, que sale en la lectura pública (/public/platform-settings, con caché en la CDN):
 * sólo las leen el super admin y los propietarios con su mensualidad.
 */
export async function getPlatformBankAccounts(db: Db): Promise<BankAccount[]> {
  const row = await one<{ bankAccounts: BankAccount[] }>(db, `select bank_accounts as "bankAccounts" from platform_settings`);
  return row?.bankAccounts ?? [];
}
