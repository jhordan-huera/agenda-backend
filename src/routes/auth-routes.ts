import { Router, type Request } from "express";
import { requireCaptcha } from "../http/captcha.ts";
import { clientIp } from "../http/client-ip.ts";
import { handle, limitRequests } from "../http/handlers.ts";
import { clearSessionCookie, setDeviceCookie, setSessionCookie } from "../http/session.ts";
import { authService } from "../services/auth-service.ts";
import { DEVICE_COOKIE } from "../services/trusted-device.ts";
import { twoFactorService } from "../services/two-factor.ts";

/** /api/auth: sesión con cookie httpOnly (ver src/http/session.ts). */
export const authRoutes = Router();

/** IP y navegador del visitante: quedan en la auditoría de las sesiones. */
const connectionOf = (req: Request) => ({
  ip: clientIp(req),
  userAgent: req.get("user-agent") ?? null,
  deviceToken: typeof req.cookies?.[DEVICE_COOKIE] === "string" ? (req.cookies[DEVICE_COOKIE] as string) : null,
});

const loginLimit = limitRequests({
  name: "login",
  windowMinutes: 15,
  max: 30,
  message: "Demasiados intentos de inicio de sesión. Espera unos minutos e inténtalo de nuevo.",
});
const signupLimit = limitRequests({
  name: "registro",
  windowMinutes: 60,
  max: 20,
  message: "Demasiados registros desde esta conexión. Inténtalo más tarde.",
});

authRoutes.get(
  "/session",
  handle((req) => authService.getSession(req.ctx)),
);

authRoutes.post("/login", loginLimit, async (req, res) => {
  const result = await authService.signIn(req.body, connectionOf(req));
  // Con la verificación en dos pasos todavía no hay sesión: falta el código.
  if ("twoFactor" in result) {
    res.json(result.twoFactor);
    return;
  }
  // El dispositivo primero y la sesión al final (un cliente que guarda sólo la última cookie se queda con la sesión).
  setDeviceCookie(res, result.device);
  setSessionCookie(res, result.issued);
  res.json(result.session);
});

authRoutes.post("/login/two-factor", loginLimit, async (req, res) => {
  const { session, issued, device } = await authService.verifyTwoFactor(req.body, connectionOf(req));
  setDeviceCookie(res, device);
  setSessionCookie(res, issued);
  res.json(session);
});

// Con CAPTCHA: el registro envía un email de bienvenida a la dirección que se escriba.
authRoutes.post("/register", signupLimit, requireCaptcha, async (req, res) => {
  const { session, issued } = await authService.signUp(req.body);
  setSessionCookie(res, issued);
  res.status(201).json(session);
});

authRoutes.post("/logout", async (req, res) => {
  await authService.signOut(req.ctx, connectionOf(req));
  clearSessionCookie(res);
  res.status(204).end();
});

authRoutes.post(
  "/change-password",
  loginLimit,
  handle((req) => authService.changePassword(req.ctx, req.body, connectionOf(req))),
);

// Modo de pantalla de la propia cuenta (spec 019): cualquier rol y el super admin, también sin la
// verificación en dos pasos (es una preferencia de su pantalla).
authRoutes.put(
  "/theme-mode",
  handle((req) => authService.setThemeMode(req.ctx, req.body)),
);

/* Verificación en dos pasos de la propia cuenta (hoy, sólo el super admin). */
authRoutes.get(
  "/two-factor",
  handle((req) => twoFactorService.status(req.ctx)),
);
authRoutes.post(
  "/two-factor/setup",
  handle((req) => twoFactorService.setup(req.ctx)),
);
authRoutes.post(
  "/two-factor/enable",
  loginLimit,
  handle((req) => twoFactorService.enable(req.ctx, req.body, connectionOf(req))),
);
authRoutes.post(
  "/two-factor/disable",
  loginLimit,
  handle((req) => twoFactorService.disable(req.ctx, req.body, connectionOf(req))),
);
authRoutes.post(
  "/two-factor/recovery-codes",
  loginLimit,
  handle((req) => twoFactorService.regenerateRecoveryCodes(req.ctx, req.body, connectionOf(req))),
);
