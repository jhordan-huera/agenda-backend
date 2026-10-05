import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router, type RequestHandler } from "express";
import * as helmetModule from "helmet";
import { config } from "./config.ts";
import { pool } from "./db/pool.ts";
import { errorHandler, notFoundHandler } from "./http/errors.ts";
import { loadSession, requireAjaxHeader } from "./http/session.ts";
import { authRoutes } from "./routes/auth-routes.ts";
import { businessRoutes, userRoutes } from "./routes/business-routes.ts";
import { cronRoutes } from "./routes/cron-routes.ts";
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
// Las imágenes (foto de perfil, logo) llegan como data URL dentro del JSON.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const api = Router();

/** Estado del servicio y de la conexión a la base de datos. */
api.get("/health", async (_req, res) => {
  const database = await pool.query("select 1").then(
    () => true,
    () => false,
  );
  res.status(database ? 200 : 503).json({ ok: database, database });
});

// Antes de la cabecera anti-CSRF y la sesión: la llama el cron de GitHub con su secreto.
api.use("/cron", cronRoutes);
// Archivos con el almacenamiento local (desarrollo): el token firmado de la URL es la autorización.
api.use("/files", fileRoutes);

api.use(requireAjaxHeader);
api.use(loadSession);
api.use("/auth", authRoutes);
api.use("/public", publicRoutes);
api.use("/users", userRoutes);
api.use("/businesses", businessRoutes);
api.use("/admin", adminRoutes);

app.use("/api", api);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
