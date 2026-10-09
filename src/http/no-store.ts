import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Las respuestas de la API son privadas (citas, pacientes, sesión): por defecto ningún navegador,
 * proxy ni CDN las guarda. Una ruta que sí quiere caché (p. ej. el perfil público de un negocio)
 * pone su propio Cache-Control después y sustituye a éste.
 *
 * Middleware para `app.use("/api", noStore)` antes de las rutas.
 */
export function noStore(_req: IncomingMessage, res: ServerResponse, next: () => void): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}

