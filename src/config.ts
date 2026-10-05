import { z } from "zod";

/**
 * Variables de entorno validadas al arrancar: si falta algo, el proceso termina con
 * un mensaje claro en lugar de fallar más tarde. Ver .env.example.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string({ error: "Falta DATABASE_URL: copia .env.example como .env y pon la conexión a PostgreSQL." })
    .min(1, "DATABASE_URL está vacía: pon la conexión a PostgreSQL en .env."),
  FRONTEND_URL: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((url) => url.trim().replace(/\/+$/, "")).filter(Boolean))
    .pipe(z.array(z.url("FRONTEND_URL debe ser una URL (p. ej. http://localhost:5173)")).min(1)),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  TRUST_PROXY: z
    .string()
    .default("loopback")
    .transform((value) => (/^\d+$/.test(value) ? Number(value) : value)),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  REMINDER_JOB_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(5),
  // Secreto compartido con el proxy del frontend en Vercel, que reenvía la IP real del visitante.
  PROXY_SECRET: z.string().trim().min(24, "PROXY_SECRET debe tener al menos 24 caracteres").optional(),
  // Envío de emails con Gmail (OAuth2). Sin estas variables los emails quedan en cola sin enviarse.
  GMAIL_USER: z.string().trim().optional(),
  GMAIL_FROM_NAME: z.string().trim().default("Agenda360"),
  GMAIL_CLIENT_ID: z.string().trim().optional(),
  GMAIL_CLIENT_SECRET: z.string().trim().optional(),
  GMAIL_REFRESH_TOKEN: z.string().trim().optional(),
  EMAIL_REDIRECT_TO: z.string().trim().optional(),
  // Archivos de la historia clínica en Supabase Storage (Project Settings → API → clave secreta).
  // Sin ellas: en local se guardan en storage/; en producción los archivos quedan desactivados.
  SUPABASE_URL: z.url("SUPABASE_URL debe ser una URL (https://xxxx.supabase.co)").optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(20).optional(),
  STORAGE_BUCKET: z.string().trim().regex(/^[a-z0-9-]{3,63}$/).default("historias-clinicas"),
  // CAPTCHA de la página de reservas (Cloudflare Turnstile). Sin las dos claves no se pide.
  TURNSTILE_SITE_KEY: z.string().trim().optional(),
  TURNSTILE_SECRET_KEY: z.string().trim().optional(),
  // Sólo para las pruebas: un servidor local que imita a Cloudflare.
  TURNSTILE_VERIFY_URL: z.url().default("https://challenges.cloudflare.com/turnstile/v0/siteverify"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuración inválida:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === "production";

const gmail =
  env.GMAIL_USER && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN
    ? {
        user: env.GMAIL_USER,
        fromName: env.GMAIL_FROM_NAME,
        clientId: env.GMAIL_CLIENT_ID,
        clientSecret: env.GMAIL_CLIENT_SECRET,
        refreshToken: env.GMAIL_REFRESH_TOKEN,
      }
    : null;

const turnstile =
  env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY
    ? { siteKey: env.TURNSTILE_SITE_KEY, secretKey: env.TURNSTILE_SECRET_KEY, verifyUrl: env.TURNSTILE_VERIFY_URL }
    : null;

export const config = {
  env: env.NODE_ENV,
  isProduction,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  /** Conexión cifrada (Supabase y otros proveedores gestionados). */
  databaseSsl: env.DATABASE_SSL === "true",
  databasePoolMax: env.DATABASE_POOL_MAX,
  /** La API corre como función de Vercel (sin servidor siempre encendido). */
  onVercel: process.env.VERCEL === "1",
  supabaseUrl: env.SUPABASE_URL ?? null,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? null,
  storageBucket: env.STORAGE_BUCKET,
  proxySecret: env.PROXY_SECRET ?? null,
  /** Orígenes permitidos por CORS. El primero se usa en los enlaces de los emails. */
  frontendUrls: env.FRONTEND_URL,
  frontendUrl: env.FRONTEND_URL[0],
  cookieSameSite: env.COOKIE_SAME_SITE,
  trustProxy: env.TRUST_PROXY,
  reminderJobIntervalMinutes: env.REMINDER_JOB_INTERVAL_MINUTES,
  /** null si faltan las credenciales de Gmail. */
  gmail,
  /** CAPTCHA de la búsqueda por cédula y de las reservas online. null: desactivado. */
  turnstile,
  /**
   * Fuera de producción todos los emails van a esta dirección (por defecto, la propia cuenta
   * de Gmail) para no escribir a los clientes de los datos demo. "off" la desactiva.
   */
  emailRedirectTo:
    env.EMAIL_REDIRECT_TO === "off" ? null : env.EMAIL_REDIRECT_TO || (isProduction ? null : (gmail?.user ?? null)),
};
