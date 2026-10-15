// Cabeceras del proxy del frontend (middleware.ts): la IP del visitante firmada con PROXY_SECRET y la
// hora (spec 009). La API sólo acepta la firma durante 2 minutos: se calcula en cada petición.
import { createHmac } from "node:crypto";

export function viaProxy(ip, secret = process.env.PROXY_SECRET ?? "") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "x-agendo-client-ip": ip,
    "x-agendo-client-ts": timestamp,
    "x-agendo-client-sig": createHmac("sha256", secret).update(`${ip}.${timestamp}`).digest("hex"),
  };
}
