import type { RequestContext } from "../services/context.ts";

declare global {
  namespace Express {
    interface Request {
      /** Usuario de la sesión (o null), cargado por el middleware de sesión. */
      ctx: RequestContext;
    }
  }
}
