import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";
import { config } from "../config.ts";

/*
 * Conversión de tipos de PostgreSQL a los del dominio (src/shared/types):
 * fechas "YYYY-MM-DD", horas "HH:mm", importes como number y timestamps ISO 8601.
 */
const { types } = pg;
const parseTimestamptz = types.getTypeParser(types.builtins.TIMESTAMPTZ);
types.setTypeParser(types.builtins.DATE, (value) => value);
types.setTypeParser(types.builtins.TIME, (value) => value.slice(0, 5));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));
types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => (parseTimestamptz(value) as Date).toISOString());

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Supabase firma sus certificados con su propia CA: se cifra la conexión sin validar la cadena.
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: config.databasePoolMax,
});

pool.on("error", (error) => console.error("Error en una conexión inactiva de PostgreSQL:", error.message));

// En Vercel, cierra las conexiones inactivas antes de que la función se suspenda.
if (config.onVercel) attachDatabasePool(pool);

/** Pool o conexión dentro de una transacción: los servicios aceptan cualquiera de los dos. */
export interface Db {
  query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
}

export async function many<T>(db: Db, text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query(text, values)).rows as T[];
}

export async function one<T>(db: Db, text: string, values: unknown[] = []): Promise<T | null> {
  return ((await db.query(text, values)).rows[0] as T | undefined) ?? null;
}

/** Ejecuta `work` en una transacción: si lanza un error, no se guarda nada. */
export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los ids que llegan en la URL se comprueban antes de usarlos en una consulta uuid. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}
