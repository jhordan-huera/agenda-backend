import type { RequestHandler } from "express";
import { config } from "../config.ts";
import { clientIp } from "./client-ip.ts";
import { AppError } from "./errors.ts";

/**
 * CAPTCHA (Cloudflare Turnstile) de la página pública de reservas y del registro: frena a los
 * robots que llenan la agenda de un negocio con reservas falsas o crean cuentas en masa (y envían
 * emails desde nuestra cuenta de Gmail). El navegador manda el token en `captchaToken`; cada token
 * sirve una sola vez. Sin TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY no se pide (en producción
 * alojada se avisa al arrancar y en /api/health).
 *
 * Con las claves puestas, todo lo que no sea una respuesta válida de Cloudflare se rechaza (también
 * si Cloudflare no responde): un fallo suyo no puede abrir la puerta a los robots.
 */

const VERIFY_TIMEOUT_MS = 10_000;

const FAILED_MESSAGE = "No pudimos comprobar que no eres un robot. Recarga la página e inténtalo de nuevo.";
const UNAVAILABLE_MESSAGE = "No pudimos comprobar que no eres un robot en este momento. Espera un momento e inténtalo de nuevo.";

/** Respuesta de siteverify (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). */
interface SiteverifyResponse {
  success: boolean;
  /** Dominio de la página en la que se resolvió el CAPTCHA. */
  hostname?: string;
  "error-codes"?: string[];
}

if (!config.turnstile && config.hosted) {
  console.error(
    "✗ CAPTCHA DESACTIVADO en producción: faltan TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY. Las reservas " +
      "online y el registro quedan sin protección ante robots (ver README, «CAPTCHA»).",
  );
}

type Verification = { ok: true } | { ok: false; error: AppError };

async function verifyToken(token: string, ip: string): Promise<Verification> {
  const turnstile = config.turnstile!;
  let result: SiteverifyResponse;
  try {
    const response = await fetch(turnstile.verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: turnstile.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Cloudflare respondió ${response.status}`);
    result = (await response.json()) as SiteverifyResponse;
  } catch (error) {
    console.error("[captcha] No se pudo verificar el token, se rechaza:", error instanceof Error ? error.message : error);
    return { ok: false, error: new AppError("unavailable", UNAVAILABLE_MESSAGE) };
  }
  if (result.success !== true) {
    console.warn(`[captcha] Token rechazado: ${(result["error-codes"] ?? []).join(", ") || "sin motivo"}`);
    return { ok: false, error: new AppError("forbidden", FAILED_MESSAGE) };
  }
  // Un token resuelto en otra web (que use nuestra Site Key) no vale aquí.
  const hostname = result.hostname?.toLowerCase() ?? "";
  if (!turnstile.hostnames.includes(hostname)) {
    console.warn(`[captcha] Token de otro dominio (${hostname || "sin dominio"}): se rechaza.`);
    return { ok: false, error: new AppError("forbidden", FAILED_MESSAGE) };
  }
  return { ok: true };
}

/** Exige un token de Turnstile válido en `req.body.captchaToken` (si el CAPTCHA está activado). */
export const requireCaptcha: RequestHandler = async (req, _res, next) => {
  if (!config.turnstile) return next();
  const token = req.body?.captchaToken;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new AppError("forbidden", FAILED_MESSAGE);
  }
  const verification = await verifyToken(token, clientIp(req));
  if (!verification.ok) throw verification.error;
  next();
};
