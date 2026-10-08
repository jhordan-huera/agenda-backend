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
  // En Vercel cada instancia abre su propio grupo de conexiones: con 3 por instancia no se agotan
  // las del pooler de Supabase en un pico de tráfico. En local, 10.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(process.env.VERCEL ? 3 : 10),
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
  /** Web publicada, para los enlaces de los emails si difiere de FRONTEND_URL (p. ej. desde este equipo). */
  APP_URL: z.url().optional(),
});

// Una variable vacía cuenta como no puesta: en GitHub Actions, un secreto que no existe llega como "".
const parsed = envSchema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")));
if (!parsed.success) {
  console.error("Configuración inválida:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === "production";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

/** El host de DATABASE_URL es este equipo (o un socket local, sin host). */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const onVercel = process.env.VERCEL === "1";
/** AWS Lambda (con Lambda Web Adapter, que ejecuta `node src/server.ts` como en local). */
const onLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
/** Alojada en la nube: no es un equipo propio. Las tareas de fondo las hace el cron de GitHub. */
const hosted = onVercel || onLambda;
/**
 * Un equipo propio conectado a la base de producción (`npm run dev` → producción): lo que se hace es
 * real, pero las tareas de fondo (cola de emails, recordatorios) siguen a cargo del cron de GitHub.
 */
const productionDbFromHere = !hosted && !isLocalDatabaseUrl(env.DATABASE_URL);

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
  onVercel,
  onLambda,
  hosted,
  productionDbFromHere,
  supabaseUrl: env.SUPABASE_URL ?? null,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? null,
  storageBucket: env.STORAGE_BUCKET,
  proxySecret: env.PROXY_SECRET ?? null,
  /** Orígenes permitidos por CORS. */
  frontendUrls: env.FRONTEND_URL,
  frontendUrl: env.FRONTEND_URL[0],
  /** Base de los enlaces de los emails: APP_URL o, si no está, el primer FRONTEND_URL. */
  appUrl: (env.APP_URL ?? env.FRONTEND_URL[0]).replace(/\/+$/, ""),
  cookieSameSite: env.COOKIE_SAME_SITE,
  trustProxy: env.TRUST_PROXY,
  reminderJobIntervalMinutes: env.REMINDER_JOB_INTERVAL_MINUTES,
  /** null si faltan las credenciales de Gmail. */
  gmail,
  /** CAPTCHA de la búsqueda por cédula y de las reservas online. null: desactivado. */
  turnstile,
  /**
   * Fuera de producción todos los emails van a esta dirección (por defecto, la propia cuenta
   * de Gmail) para no escribir a los clientes de los datos demo. "off" la desactiva. Con la base
   * de producción, aunque sea desde este equipo, van a sus destinatarios reales.
   */
  emailRedirectTo:
    env.EMAIL_REDIRECT_TO === "off"
      ? null
      : env.EMAIL_REDIRECT_TO || (isProduction || productionDbFromHere ? null : (gmail?.user ?? null)),
};
