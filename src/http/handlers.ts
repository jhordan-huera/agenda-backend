import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { clientIp } from "./client-ip.ts";
import { PostgresRateLimitStore } from "./rate-limit-store.ts";

/**
 * Envuelve un servicio como manejador de Express: responde con JSON lo que devuelve
 * (`null` incluido) o con 204 si no devuelve nada. Express 5 pasa los errores
 * de las funciones async al manejador de errores.
 */
export function handle(
  work: (req: Request<Record<string, string>>, res: Response) => Promise<unknown>,
): RequestHandler {
  return async (req, res) => {
    // Las rutas sólo usan parámetros simples (:id), que Express entrega como string.
    const result = await work(req as Request<Record<string, string>>, res);
    if (result === undefined) res.status(204).end();
    else res.json(result);
  };
}

/** Valor de un parámetro de la query string (sólo strings no vacíos). */
export function queryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Subred IPv6 que cuenta como un solo visitante: a cada conexión se le suele dar una /64 entera,
 * así que cambiar de dirección dentro de ella no salta el límite. Las IPv4 cuentan una a una.
 */
const IPV6_SUBNET = 64;

/** Clave del visitante para los límites: su IP (o su subred /64 si es IPv6). */
export const visitorKey = (req: Request) => ipKeyGenerator(clientIp(req), IPV6_SUBNET);

/** Nombre estable de un limitador sin `name` (el mismo en todas las instancias de la API). */
const nameFromMessage = (message: string) => `limite-${createHash("sha256").update(message).digest("hex").slice(0, 10)}`;

/**
 * Límite de intentos por IP (login, registro, reservas públicas…). Las cuentas se guardan en
 * PostgreSQL (ver rate-limit-store.ts): todas las instancias de la API comparten el mismo límite.
 * `name` distingue las cuentas de cada limitador (por defecto, una huella del mensaje).
 */
export function limitRequests(options: { name?: string; windowMinutes: number; max: number; message: string }): RequestHandler {
  return rateLimit({
    windowMs: options.windowMinutes * 60_000,
    limit: options.max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new PostgresRateLimitStore(options.name ?? nameFromMessage(options.message)),
    // Si la base de datos falla al contar, la petición sigue (y fallará igual si necesita la base):
    // el límite nunca deja la API caída por sí solo.
    passOnStoreError: true,
    keyGenerator: visitorKey,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "rate_limited", message: options.message } });
    },
  });
}
