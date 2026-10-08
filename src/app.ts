import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router, type RequestHandler } from "express";
import * as helmetModule from "helmet";
import { config } from "./config.ts";
import { pool } from "./db/pool.ts";
import { errorHandler, notFoundHandler } from "./http/errors.ts";
import { loadSession, requireAjaxHeader } from "./http/session.ts";
import { authRoutes } from "./routes/auth-routes.ts";
import { businessRoutes, imageRoutes, userRoutes } from "./routes/business-routes.ts";
import { fileRoutes } from "./routes/file-routes.ts";
import { adminRoutes, publicRoutes } from "./routes/platform-routes.ts";

// helmet trae tipos ESM y CommonJS: según cómo los resuelva TypeScript (en local o al compilar
// en Vercel), `default` es la función o el módulo entero. Se toma la función en ambos casos.
const helmetExport: unknown = helmetModule.default;
const helmet = (typeof helmetExport === "function" ? helmetExport : (helmetExport as { default: unknown }).default) as () => RequestHandler;

/**
 * La API. En local la arranca src/server.ts (con los trabajos programados); en Vercel este
 * archivo es la entrada y cada petición llega a `app` como una función (ver README).
 */
export const app = express();

app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.frontendUrls, credentials: true }));
// Las imágenes van al almacenamiento, pero las antiguas (data URL) aún llegan sin cambios dentro del
// JSON al guardar el perfil o el negocio, hasta pasarlas con src/db/move-images-to-storage.ts (npm run db:move-images).
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const api = Router();

/**
 * Motivo (sin datos sensibles) por el que no conecta la base de datos, para diagnosticar un
 * despliegue: red (p. ej. la dirección directa de Supabase sólo tiene IPv6), contraseña, usuario…
 */
function databaseProblem(error: unknown): string {
  const { code, message = "" } = (error ?? {}) as { code?: string; message?: string };
  if (["ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "EAI_AGAIN"].includes(code ?? "")) return "red";
  if (code === "28P01") return "contraseña";
  if (/tenant or user not found/i.test(message) || code === "28000") return "usuario";
  if (/ssl|certificate/i.test(message)) return "ssl";
  if (/timeout|timed out/i.test(message) || code === "ETIMEDOUT") return "tiempo de espera";
  if (code === "3D000") return "base de datos inexistente";
  return "otro";
}

/** Estado del servicio y de la conexión a la base de datos. */
api.get("/health", async (_req, res) => {
  const failure = await pool.query("select 1").then(
    () => null,
    (error: unknown) => {
      console.error("[health] Sin conexión a PostgreSQL:", (error as { code?: string })?.code, (error as Error)?.message);
      return { problem: databaseProblem(error), code: (error as { code?: string })?.code ?? null };
    },
  );
  res.status(failure ? 503 : 200).json({
    ok: !failure,
    database: !failure,
    // Sólo desde un equipo propio: el frontend local muestra el aviso "Base de PRODUCCIÓN".
    ...(config.productionDbFromHere ? { productionDatabase: true } : {}),
    ...failure,
  });
});

// Antes de la cabecera anti-CSRF y la sesión. Archivos con el almacenamiento local (desarrollo):
// el token firmado de la URL es la autorización.
api.use("/files", fileRoutes);

api.use(requireAjaxHeader);
api.use(loadSession);
api.use("/auth", authRoutes);
api.use("/public", publicRoutes);
api.use("/users", userRoutes);
api.use("/images", imageRoutes);
api.use("/businesses", businessRoutes);
api.use("/admin", adminRoutes);

app.use("/api", api);

// La raíz no es la aplicación: quien la abra en el navegador ve qué es y dónde comprobar el estado.
app.get(["/", "/api"], (_req, res) => {
  res.json({
    name: "API de Agenda360",
    message: "Esta dirección es la API. La aplicación se abre desde el frontend.",
    health: "/api/health",
  });
});
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
