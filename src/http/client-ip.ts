import { isIP } from "node:net";
import type { Request } from "express";
import { config } from "../config.ts";
import { sameSecret } from "./secrets.ts";

/**
 * IP del visitante para los límites anti-abuso. En Vercel el frontend reenvía /api a esta API
 * (proxy, ver middleware.ts del frontend) y Vercel reemplaza la IP por la del proxy: el
 * frontend la manda en `x-agendo-client-ip` junto con PROXY_SECRET. Sin el secreto correcto
 * se ignora la cabecera (nadie puede falsear su IP) y se usa la de la conexión.
 */
export function clientIp(req: Request): string {
  if (config.proxySecret && sameSecret(req.get("x-agendo-proxy-secret"), config.proxySecret)) {
    const forwarded = req.get("x-agendo-client-ip")?.trim();
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  return req.ip ?? "desconocida";
}
