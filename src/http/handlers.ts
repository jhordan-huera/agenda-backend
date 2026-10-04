import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { clientIp } from "./client-ip.ts";

/**
 * Envuelve un servicio como manejador de Express: responde con JSON lo que devuelve
 * (`null` incluido) o con 204 si no devuelve nada. Express 5 pasa los errores
 * de las funciones async al manejador de errores.
 */
export function handle(work: (req: Request<Record<string, string>>) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    // Las rutas sólo usan parámetros simples (:id), que Express entrega como string.
    const result = await work(req as Request<Record<string, string>>);
    if (result === undefined) res.status(204).end();
    else res.json(result);
  };
}

/** Valor de un parámetro de la query string (sólo strings no vacíos). */
export function queryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Límite de intentos por IP (login, registro, reservas públicas…). */
export function limitRequests(options: { windowMinutes: number; max: number; message: string }): RequestHandler {
  return rateLimit({
    windowMs: options.windowMinutes * 60_000,
    limit: options.max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // ipKeyGenerator agrupa las IPv6 por subred: cambiar de dirección no salta el límite.
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "rate_limited", message: options.message } });
    },
  });
}
