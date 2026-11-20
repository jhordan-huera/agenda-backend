import type { CookieOptions, RequestHandler, Response } from "express";
import { config } from "../config.ts";
import { findSessionByToken, type IssuedSession } from "../services/auth-service.ts";
import {
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
  requireUser,
  superAdminNeedsTwoFactor,
  TWO_FACTOR_REQUIRED_CODE,
  TWO_FACTOR_REQUIRED_MESSAGE,
} from "../services/context.ts";
import { DEVICE_COOKIE } from "../services/trusted-device.ts";
import { AppError } from "./errors.ts";

const COOKIE_NAME = "agendo_session";

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // el JavaScript del navegador no puede leerla (protege ante XSS)
    // En la nube siempre, aunque falte NODE_ENV=production (spec 009): sólo viaja por HTTPS.
    secure: config.isProduction || config.hosted || config.cookieSameSite === "none",
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

/** El dispositivo de confianza (trusted-device.ts): sólo viaja a /api/auth, donde se inicia sesión. */
export function setDeviceCookie(res: Response, device: { token: string; expiresAt: Date } | null): void {
  if (!device) return;
  res.cookie(DEVICE_COOKIE, device.token, { ...cookieOptions(), path: "/api/auth", expires: device.expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/**
 * Carga el usuario de la cookie de sesión en `req.ctx` (o null si no hay sesión válida). Cada uso
 * renueva la sesión (caducidad por inactividad); con «Recordarme» también la fecha de la cookie.
 */
export const loadSession: RequestHandler = async (req, res, next) => {
  req.ctx = { user: null, sessionId: null };
  const token: unknown = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || !token) return next();
  const session = await findSessionByToken(token);
  if (session) {
    const { renewedUntil, ...ctx } = session;
    req.ctx = ctx;
    if (renewedUntil) setSessionCookie(res, { token, expiresAt: renewedUntil, persistent: true });
  } else clearSessionCookie(res);
  next();
};

/**
 * Panel /admin y modo soporte (/businesses, /images): el super admin sin la verificación en dos pasos
 * (obligatoria) recibe 403 con el código `two_factor_required`, y el frontend le pide activarla. Sólo
 * puede iniciar sesión, activarla (/auth/two-factor) y cerrar sesión.
 */
export const requireSuperAdminTwoFactor: RequestHandler = (req, res, next) => {
  if (!superAdminNeedsTwoFactor(req.ctx)) return next();
  res.status(403).json({ error: { code: TWO_FACTOR_REQUIRED_CODE, message: TWO_FACTOR_REQUIRED_MESSAGE } });
};

/**
 * Las rutas del panel (/businesses, /users, /images, /admin) sólo atienden a quien tiene sesión: sin ella,
 * el mismo 401 que daría cada servicio, pero antes de validar nada de lo que manda la petición. Así un
 * desconocido no hace trabajar a la API con cuerpos grandes (2026-11-14, el fallo de la regla del nombre).
 */
export const requireSignedIn: RequestHandler = (req, _res, next) => {
  requireUser(req.ctx);
  assertPasswordChanged(req.ctx.passwordChangeRequired);
  next();
};

/**
 * La sesión que se abrió con una contraseña temporal (spec 054) sólo puede crear la contraseña nueva: el panel
 * (/businesses, /users, /images, /admin, dentro de requireSignedIn), /push y las rutas de /auth que no son crear la
 * contraseña, ver la sesión, el modo de pantalla o cerrar sesión responden 403 `password_change_required`.
 */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  assertPasswordChanged(req.ctx.passwordChangeRequired);
  next();
};

function assertPasswordChanged(required: boolean | undefined): void {
  if (required) throw new AppError("password_change_required", PASSWORD_CHANGE_REQUIRED_MESSAGE);
}

/**
 * Protección CSRF: toda petición que modifica datos debe llevar la cabecera
 * X-Requested-With. Un formulario de otra web no puede añadirla, y un fetch desde otro
 * origen necesita el permiso CORS, que sólo tiene el frontend (FRONTEND_URL).
 */
export const requireAjaxHeader: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.get("X-Requested-With")) return next();
  next(new AppError("forbidden", "Petición rechazada: falta la cabecera X-Requested-With."));
};
