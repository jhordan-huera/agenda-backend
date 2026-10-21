import { one, type Db } from "../db/pool.ts";
import type { BankAccount, PlanPrices, PlatformSettings } from "../shared/types/index.ts";

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

/**
 * Los precios de los planes (spec 029, ampliación del 2026-10-20, migración 050). Como las cuentas, van aparte
 * de getPlatformSettings, que sale en la lectura pública: sólo los lee el super admin (/admin → Planes y la
 * ficha de cada negocio) y la API, para calcular la mensualidad. Nunca van en una respuesta a un negocio.
 */
export async function getPlanPrices(db: Db): Promise<PlanPrices> {
  return (await one<PlanPrices>(
    db,
    `select pro_price as "proPrice", business_price as "businessPrice",
            business_included_agendas as "businessIncludedAgendas", business_extra_agenda_price as "businessExtraAgendaPrice"
       from platform_settings`,
  ))!;
}
