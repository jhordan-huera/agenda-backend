import { Router, type RequestHandler } from "express";
import { config } from "../config.ts";
import { AppError } from "../http/errors.ts";
import { handle } from "../http/handlers.ts";
import { sameSecret } from "../http/secrets.ts";
import { runScheduledTasks } from "../jobs/scheduled-tasks.ts";

/**
 * Tareas periódicas por HTTP. En Vercel no hay un proceso siempre encendido: el cron de
 * GitHub (.github/workflows/cron.yml) llama a POST /api/cron/run con
 * `Authorization: Bearer <CRON_SECRET>` y avisa por ntfy con el resumen que devuelve.
 */
export const cronRoutes = Router();

const requireCronSecret: RequestHandler = (req, _res, next) => {
  if (!config.cronSecret) throw new AppError("not_found", "Ruta no encontrada.");
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!sameSecret(token, config.cronSecret)) throw new AppError("unauthorized", "Secreto del cron incorrecto.");
  next();
};

cronRoutes.post("/run", requireCronSecret, handle(() => runScheduledTasks()));
