import { Router, type Request } from "express";
import { clientIp } from "../http/client-ip.ts";
import { handle, limitRequests } from "../http/handlers.ts";
import { clearSessionCookie, setSessionCookie } from "../http/session.ts";
import { authService } from "../services/auth-service.ts";
import { twoFactorService } from "../services/two-factor.ts";

/** /api/auth: sesión con cookie httpOnly (ver src/http/session.ts). */
export const authRoutes = Router();

/** IP y navegador del visitante: quedan en la auditoría de las sesiones. */
const connectionOf = (req: Request) => ({ ip: clientIp(req), userAgent: req.get("user-agent") ?? null });

const loginLimit = limitRequests({
  windowMinutes: 15,
  max: 30,
  message: "Demasiados intentos de inicio de sesión. Espera unos minutos e inténtalo de nuevo.",
});
const signupLimit = limitRequests({
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
  setSessionCookie(res, result.issued);
  res.json(result.session);
});

authRoutes.post("/login/two-factor", loginLimit, async (req, res) => {
  const { session, issued } = await authService.verifyTwoFactor(req.body, connectionOf(req));
  setSessionCookie(res, issued);
  res.json(session);
});

authRoutes.post("/register", signupLimit, async (req, res) => {
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
  handle((req) => authService.changePassword(req.ctx, req.body)),
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
