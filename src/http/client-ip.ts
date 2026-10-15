import { isIP } from "node:net";
import type { Request } from "express";
import { config } from "../config.ts";
import { sameSecret, validClientIpSignature } from "./secrets.ts";

/**
 * IP del visitante para los límites anti-abuso. En Vercel el frontend reenvía /api a esta API
 * (proxy, ver middleware.ts del frontend) y Vercel reemplaza la IP por la del proxy: el frontend la
 * manda en `x-agendo-client-ip`, firmada con PROXY_SECRET y la hora (`x-agendo-client-ts` y
 * `x-agendo-client-sig`; ver secrets.ts). Sin una firma válida y reciente se ignora la cabecera
 * (nadie puede falsear su IP) y se usa la de la conexión.
 *
 * Fase 1 de la firma (spec 009): también vale el PROXY_SECRET fijo en `x-agendo-proxy-secret`, como
 * antes, para que no importe si se publica antes el backend o el frontend. Se quita (fase 2) cuando el
 * frontend con la firma esté publicado.
 */
export function clientIp(req: Request): string {
  const forwarded = req.get("x-agendo-client-ip")?.trim() ?? "";
  if (config.proxySecret && forwarded && isIP(forwarded) && fromFrontendProxy(req, forwarded)) return forwarded;
  return req.ip ?? "desconocida";
}

/** ¿Llega por el proxy del frontend? (la guarda de la Function URL de Lambda, ver app.ts). */
export function fromFrontendProxy(req: Request, ip = req.get("x-agendo-client-ip")?.trim() ?? ""): boolean {
  const secret = config.proxySecret;
  if (!secret) return false;
  return (
    validClientIpSignature(ip, req.get("x-agendo-client-ts"), req.get("x-agendo-client-sig"), secret) ||
    sameSecret(req.get("x-agendo-proxy-secret"), secret)
  );
}
