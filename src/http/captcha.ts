import type { RequestHandler } from "express";
import { config } from "../config.ts";
import { clientIp } from "./client-ip.ts";
import { AppError } from "./errors.ts";

/**
 * CAPTCHA de la página pública de reservas (Cloudflare Turnstile): frena a los robots que
 * prueban cédulas o llenan la agenda de un negocio con reservas falsas (y envían emails desde
 * nuestra cuenta de Gmail). El navegador manda el token en `captchaToken`; cada token sirve
 * una sola vez. Sin TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY no se pide.
 */

const VERIFY_TIMEOUT_MS = 10_000;

const FAILED_MESSAGE = "No pudimos comprobar que no eres un robot. Recarga la página e inténtalo de nuevo.";

/** Respuesta de siteverify (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). */
interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/** true: token válido. Si Cloudflare no responde, se deja pasar (las reservas no se caen con él). */
async function verifyToken(token: string, ip: string): Promise<boolean> {
  const turnstile = config.turnstile!;
  try {
    const response = await fetch(turnstile.verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: turnstile.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Cloudflare respondió ${response.status}`);
    const result = (await response.json()) as SiteverifyResponse;
    if (!result.success) console.warn(`[captcha] Token rechazado: ${(result["error-codes"] ?? []).join(", ") || "sin motivo"}`);
    return result.success;
  } catch (error) {
    console.error("[captcha] No se pudo verificar el token, se deja pasar:", error instanceof Error ? error.message : error);
    return true;
  }
}

/** Exige un token de Turnstile válido en `req.body.captchaToken` (si el CAPTCHA está activado). */
export const requireCaptcha: RequestHandler = async (req, _res, next) => {
  if (!config.turnstile) return next();
  const token = req.body?.captchaToken;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new AppError("forbidden", FAILED_MESSAGE);
  }
  if (!(await verifyToken(token, clientIp(req)))) throw new AppError("forbidden", FAILED_MESSAGE);
  next();
};
