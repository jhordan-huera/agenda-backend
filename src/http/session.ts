import type { CookieOptions, RequestHandler, Response } from "express";
import { config } from "../config.ts";
import { findSessionByToken, type IssuedSession } from "../services/auth-service.ts";
import { AppError } from "./errors.ts";

const COOKIE_NAME = "agendo_session";

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // el JavaScript del navegador no puede leerla (protege ante XSS)
    secure: config.isProduction || config.cookieSameSite === "none",
    sameSite: config.cookieSameSite,
    path: "/",
  };
}

/** "Recordarme" ⇒ cookie persistente; si no, se borra al cerrar el navegador. */
export function setSessionCookie(res: Response, issued: IssuedSession): void {
  res.cookie(COOKIE_NAME, issued.token, {
    ...cookieOptions(),
    ...(issued.persistent ? { expires: issued.expiresAt } : {}),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/** Carga el usuario de la cookie de sesión en `req.ctx` (o null si no hay sesión válida). */
export const loadSession: RequestHandler = async (req, res, next) => {
  req.ctx = { user: null, sessionId: null };
  const token: unknown = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || !token) return next();
  const session = await findSessionByToken(token);
  if (session) req.ctx = session;
  else clearSessionCookie(res);
  next();
};

/**
 * Protección CSRF: toda petición que modifica datos debe llevar la cabecera
 * X-Requested-With. Un formulario de otra web no puede añadirla, y un fetch desde otro
 * origen necesita el permiso CORS, que sólo tiene el frontend (FRONTEND_URL).
 */
export const requireAjaxHeader: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.get("X-Requested-With")) return next();
  next(new AppError("forbidden", "Petición rechazada: falta la cabecera X-Requested-With."));
};
