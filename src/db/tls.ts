import type { ConnectionOptions } from "node:tls";

/**
 * Certificado raíz de Supabase ("Supabase Root 2021 CA", válido hasta el 26-04-2031). Es público:
 * https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
 * SHA-256: 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 *
 * Con él se comprueba que al otro lado está de verdad la base de Supabase: sin comprobarlo, alguien
 * en medio de la red podría hacerse pasar por ella y quedarse con la contraseña y los datos. Va en
 * el código (y no en un .crt aparte) para que llegue siempre a Vercel, que compila sólo el código, y
 * a Lambda. pg_dump lo recibe en un archivo temporal (scripts/backup.ts).
 */
export const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

function hostnameOf(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
}

/** Base de Supabase: conexión directa (db.<ref>.supabase.co) o pooler (….pooler.supabase.com). */
export const isSupabaseHost = (hostname: string) => /(^|\.)supabase\.(co|com)$/i.test(hostname);

/**
 * Opciones TLS de `pg` para una DATABASE_URL (undefined: sin cifrar, p. ej. la base local):
 * - Supabase: sólo vale un certificado firmado por su CA raíz y con el nombre del servidor.
 * - Otro proveedor en la nube: los certificados de confianza del sistema.
 * - Este equipo con DATABASE_SSL=true: cifrada, pero sin comprobar (suele ser autofirmado).
 */
export function databaseTls(databaseUrl: string, enabled: boolean): ConnectionOptions | undefined {
  if (!enabled) return undefined;
  const hostname = hostnameOf(databaseUrl);
  if (LOCAL_HOSTS.has(hostname)) return { rejectUnauthorized: false };
  if (isSupabaseHost(hostname)) return { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
  return { rejectUnauthorized: true };
}
