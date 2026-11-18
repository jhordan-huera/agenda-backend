import { Router, type CookieOptions, type Request, type Response } from "express";
import { config } from "../config.ts";
import { requireCaptcha } from "../http/captcha.ts";
import { clientIp } from "../http/client-ip.ts";
import { AppError } from "../http/errors.ts";
import { handle, limitRequests } from "../http/handlers.ts";
import {
  createPatientSession,
  endPatientSession,
  findPatientSession,
  patientAccountService,
} from "../services/patient-accounts.ts";

/**
 * /api/patient: la cuenta del paciente (spec 052), aparte de la del equipo. Su propia cookie (`agenda360_patient`):
 * nunca carga la sesión del equipo ni entra a /businesses. Cada ruta con sesión busca la cuenta de la cookie.
 */
export const patientRoutes = Router();

const COOKIE_NAME = "agenda360_patient";

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction || config.hosted || config.cookieSameSite === "none",
    sameSite: config.cookieSameSite,
    path: "/",
  };
}

const connectionOf = (req: Request) => ({ ip: clientIp(req), userAgent: req.get("user-agent") ?? null });

const tokenOf = (req: Request): string => {
  const token: unknown = req.cookies?.[COOKIE_NAME];
  return typeof token === "string" ? token : "";
};

async function startSession(res: Response, accountId: string): Promise<void> {
  const session = await createPatientSession(accountId);
  res.cookie(COOKIE_NAME, session.token, { ...cookieOptions(), expires: session.expiresAt });
}

async function requireAccount(req: Request): Promise<string> {
  const session = await findPatientSession(tokenOf(req));
  if (!session) throw new AppError("unauthorized", "Inicia sesión con tu teléfono.");
  // Renovada (30 días más sin pasar de 180): la cookie también.
  if (session.renewedUntil) req.res?.cookie(COOKIE_NAME, tokenOf(req), { ...cookieOptions(), expires: session.renewedUntil });
  return session.accountId;
}

const loginLimit = limitRequests({
  name: "paciente-entrar",
  windowMinutes: 15,
  max: 30,
  message: "Demasiados intentos de inicio de sesión. Espera unos minutos e inténtalo de nuevo.",
});
const signupLimit = limitRequests({
  name: "paciente-cuenta",
  windowMinutes: 60,
  max: 10,
  message: "Demasiadas cuentas nuevas desde esta conexión. Inténtalo más tarde.",
});
const resetLimit = limitRequests({
  name: "paciente-clave",
  windowMinutes: 15,
  max: 30,
  message: "Demasiados intentos con este enlace. Espera unos minutos.",
});

/** La clave pública del CAPTCHA (null: no se pide) para «Crear mi cuenta». */
patientRoutes.get(
  "/config",
  handle(async () => ({ captchaSiteKey: config.turnstile?.siteKey ?? null })),
);

/** La invitación del QR del consultorio para sus pacientes: su nombre y su logo en «Mi tarjeta». */
patientRoutes.get(
  "/invite/:slug",
  handle(async (req) => {
    const invite = await patientAccountService.invite(String(req.params.slug));
    if (!invite) throw new AppError("not_found", "No encontramos ese consultorio.");
    return invite;
  }),
);

patientRoutes.post("/signup", signupLimit, requireCaptcha, async (req, res) => {
  const accountId = await patientAccountService.signup(req.body);
  await startSession(res, accountId);
  res.json(await patientAccountService.me(accountId));
});

// Con el CAPTCHA (revisión de seguridad): sin él, un programa prueba contraseñas comunes contra muchos teléfonos.
patientRoutes.post("/login", loginLimit, requireCaptcha, async (req, res) => {
  const accountId = await patientAccountService.login(req.body, connectionOf(req));
  await startSession(res, accountId);
  res.json(await patientAccountService.me(accountId));
});

patientRoutes.post("/logout", async (req, res) => {
  await endPatientSession(tokenOf(req));
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.status(204).end();
});

/** «Cerrar sesión en todos los dispositivos» (revisión de seguridad 2026-11-18): un celular perdido deja de ver la tarjeta. */
patientRoutes.post("/logout-all", async (req, res) => {
  await patientAccountService.logoutEverywhere(await requireAccount(req), connectionOf(req));
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.status(204).end();
});

patientRoutes.get(
  "/me",
  handle(async (req) => patientAccountService.me(await requireAccount(req))),
);
patientRoutes.get(
  "/cards",
  handle(async (req) => patientAccountService.cards(await requireAccount(req))),
);
patientRoutes.post(
  "/qr",
  handle(async (req) => patientAccountService.newQr(await requireAccount(req))),
);
const passwordLimit = limitRequests({
  name: "paciente-contrasena",
  windowMinutes: 15,
  max: 10,
  message: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
});

patientRoutes.put(
  "/password",
  passwordLimit,
  handle(async (req) => patientAccountService.changePassword(await requireAccount(req), req.body, tokenOf(req), connectionOf(req))),
);
patientRoutes.delete("/account", passwordLimit, async (req, res) => {
  await patientAccountService.deleteAccount(await requireAccount(req), req.body, connectionOf(req));
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.status(204).end();
});

/* -- El enlace del consultorio para cambiar la contraseña (sin sesión). -- */
patientRoutes.get(
  "/reset/:token",
  resetLimit,
  handle((req) => patientAccountService.resetInfo(String(req.params.token))),
);
patientRoutes.post("/reset/:token", resetLimit, async (req, res) => {
  const accountId = await patientAccountService.resetPassword(String(req.params.token), req.body, connectionOf(req));
  await startSession(res, accountId);
  res.json(await patientAccountService.me(accountId));
});
