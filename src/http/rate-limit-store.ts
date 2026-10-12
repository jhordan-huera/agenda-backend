import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { one, pool, type Db } from "../db/pool.ts";

/**
 * Cuentas de los límites de intentos en PostgreSQL (tabla rate_limits), compartidas por todas las
 * instancias de la API: en Vercel y en Lambda cada instancia tenía su propia memoria y el límite
 * real se multiplicaba por el número de instancias.
 *
 * Cada clave lleva una cuenta y cuándo vuelve a empezar (`reset_at`). La suma es atómica (un solo
 * insert … on conflict): dos peticiones a la vez en dos instancias no se pisan. Las filas caducadas
 * las borra el cron (deleteExpiredRateLimits) y, de vez en cuando, la propia API.
 */

/** De cada cuántas sumas, una (de media) aprovecha para borrar las filas caducadas. */
const CLEANUP_EVERY = 500;

/**
 * Suma uno a `key` y devuelve la cuenta y cuándo vuelve a empezar. Si la ventana anterior ya
 * terminó, empieza otra de `windowMs` milisegundos.
 */
export async function incrementCounter(db: Db, key: string, windowMs: number): Promise<{ hits: number; resetAt: Date }> {
  const row = (await one<{ hits: number; resetAt: string }>(
    db,
    `insert into rate_limits (key, hits, reset_at)
     values ($1, 1, now() + make_interval(secs => $2::double precision / 1000))
     on conflict (key) do update
       set hits = case when rate_limits.reset_at <= now() then 1 else rate_limits.hits + 1 end,
           reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
     returning hits, reset_at as "resetAt"`,
    [key, windowMs],
  ))!;
  return { hits: row.hits, resetAt: new Date(row.resetAt) };
}

/** Borra las cuentas cuya ventana ya terminó. Devuelve cuántas. */
export async function deleteExpiredRateLimits(db: Db = pool): Promise<number> {
  const result = await db.query("delete from rate_limits where reset_at <= now()");
  return result.rowCount ?? 0;
}

export class PostgresRateLimitStore implements Store {
  /** Las claves no son de esta instancia: se comparten con las demás (ver express-rate-limit). */
  localKeys = false;
  /** "<limitador>:" Cada limitador cuenta aparte, aunque compartan la tabla. */
  prefix: string;
  private windowMs = 60_000;

  constructor(name: string) {
    this.prefix = `${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string): string {
    return this.prefix + key;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const row = await one<{ hits: number; resetAt: string }>(
      pool,
      'select hits, reset_at as "resetAt" from rate_limits where key = $1 and reset_at > now()',
      [this.key(key)],
    );
    return row ? { totalHits: row.hits, resetTime: new Date(row.resetAt) } : undefined;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { hits, resetAt } = await incrementCounter(pool, this.key(key), this.windowMs);
    if (Math.random() < 1 / CLEANUP_EVERY) {
      void deleteExpiredRateLimits().catch((error: unknown) =>
        console.error("[límites] No se pudieron borrar las cuentas caducadas:", error instanceof Error ? error.message : error),
      );
    }
    return { totalHits: hits, resetTime: resetAt };
  }

  async decrement(key: string): Promise<void> {
    await pool.query("update rate_limits set hits = greatest(hits - 1, 0) where key = $1 and reset_at > now()", [this.key(key)]);
  }

  async resetKey(key: string): Promise<void> {
    await pool.query("delete from rate_limits where key = $1", [this.key(key)]);
  }
}
