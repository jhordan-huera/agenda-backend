import { professionalSchema, type ProfessionalInput } from "../shared/lib/validations/professional.ts";
import type { BankAccount } from "../shared/types/index.ts";
import { parseInput } from "./context.ts";

/**
 * Datos bancarios de las agendas: hasta 3 cuentas (`professionals.bank_accounts`, migración 030), la
 * primera es la principal. Mientras dure la transición se mantiene lo de antes, cuando había una sola:
 *   · la columna `bank_account` guarda la primera (o null), para el código anterior de la API;
 *   · los fronts viejos que aún estén en caché sólo conocen `bankAccount` (una cuenta o null): las
 *     respuestas lo siguen llevando y la API lo acepta si no viene `bankAccounts`.
 */

/** Valores de `bank_accounts` y `bank_account` (la primera cuenta, o null) para guardarlos. */
export const bankAccountValues = (bankAccounts: BankAccount[]) => [
  JSON.stringify(bankAccounts),
  bankAccounts.length ? JSON.stringify(bankAccounts[0]) : null,
];

/**
 * Las cuentas de una respuesta pública (confirmación de la reserva, página de pago), con `bankAccount`.
 * @deprecated `bankAccount` (la primera cuenta, o null) es sólo para los fronts viejos en caché:
 * quitarlo cuando ya no queden.
 */
export const withLegacyBankAccount = (bankAccounts: BankAccount[]) => ({ bankAccounts, bankAccount: bankAccounts[0] ?? null });

/**
 * La ficha de un profesional que manda el panel. Un front viejo manda `bankAccount` (una cuenta o
 * null) en lugar de `bankAccounts`: obsoleto, se acepta sólo si no viene `bankAccounts`. Ese front
 * sólo veía la primera cuenta, así que con una cuenta se reemplaza la primera y se conservan las
 * demás (`keepOtherAccounts`, ver accountsToSave); con null se quita el cobro por transferencia.
 */
export function parseProfessionalInput(input: unknown): { data: ProfessionalInput; keepOtherAccounts: boolean } {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!body || body.bankAccounts !== undefined || body.bankAccount === undefined) {
    return { data: parseInput(professionalSchema, input), keepOtherAccounts: false };
  }
  const { bankAccount, ...rest } = body;
  return {
    data: parseInput(professionalSchema, { ...rest, bankAccounts: bankAccount === null ? [] : [bankAccount] }),
    keepOtherAccounts: bankAccount !== null,
  };
}

/** Las cuentas que se guardan: las del formulario o, desde un front viejo, su cuenta y las demás que ya había. */
export function accountsToSave(parsed: { data: ProfessionalInput; keepOtherAccounts: boolean }, current: BankAccount[]): BankAccount[] {
  return parsed.keepOtherAccounts ? [...parsed.data.bankAccounts, ...current.slice(1)] : parsed.data.bankAccounts;
}
