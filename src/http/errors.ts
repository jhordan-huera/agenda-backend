import type { ErrorRequestHandler, RequestHandler } from "express";

export type AppErrorCode =
  | "not_found"
  | "conflict"
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "plan_limit"
  | "rate_limited"
  | "unavailable"
  | "server";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  plan_limit: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  server: 500,
  unavailable: 503,
};

/**
 * Error con mensaje listo para mostrar al usuario. El frontend lo recibe como
 * `{ error: { code, message } }` y lo convierte en su DataError con el mismo código.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** Errores de PostgreSQL que pueden llegar por datos del usuario (las validaciones previas cubren casi todo). */
function fromDatabaseError(error: unknown): AppError | null {
  const code = (error as { code?: unknown }).code;
  switch (code) {
    case "23505":
      return new AppError("conflict", "Ya existe un registro con esos datos.");
    case "23P01":
      return new AppError("conflict", "Ya existe una cita en ese horario. Por favor elige otra hora.");
    case "23503":
      return new AppError("conflict", "No se puede completar la operación porque hay datos relacionados.");
    case "22P02":
    case "22007":
    case "22008":
      return new AppError("validation", "Alguno de los datos enviados no tiene un formato válido.");
    default:
      return null;
  }
}

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "28P01", // contraseña incorrecta
  "28000", // acceso denegado
  "3D000", // la base de datos no existe
  "53300", // demasiadas conexiones
  "57P01", // el servidor se está apagando
  "57P03", // el servidor aún no acepta conexiones
]);

/** La base de datos no está disponible (sin conexión, credenciales mal, reinicio…). */
export function isDatabaseUnavailable(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) ||
    (typeof message === "string" && /connection terminated|timeout exceeded when trying to connect/i.test(message))
  );
}

/** Errores de express.json() (cuerpo demasiado grande o JSON mal formado). */
function fromBodyParserError(error: unknown): AppError | null {
  const type = (error as { type?: unknown }).type;
  if (type === "entity.too.large") return new AppError("validation", "Los datos enviados son demasiado grandes. Prueba con una imagen más pequeña.");
  if (type === "entity.parse.failed") return new AppError("validation", "El cuerpo de la petición no es un JSON válido.");
  return null;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError("not_found", "Ruta no encontrada."));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const appError = error instanceof AppError ? error : (fromBodyParserError(error) ?? fromDatabaseError(error));
  if (!appError && isDatabaseUnavailable(error)) {
    console.error("No hay conexión con la base de datos:", (error as Error).message);
    res.status(503).json({
      error: { code: "unavailable", message: "El servicio no está disponible en este momento. Inténtalo en unos minutos." },
    });
    return;
  }
  if (!appError) {
    console.error(error);
    res.status(500).json({ error: { code: "server", message: "Ocurrió un error inesperado. Inténtalo de nuevo." } });
    return;
  }
  res.status(STATUS_BY_CODE[appError.code]).json({ error: { code: appError.code, message: appError.message } });
};
