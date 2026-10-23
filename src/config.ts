import { z } from "zod";
import { vapidKeysProblem } from "./services/web-push.ts";

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
  // Sólo servidor local: cada cuántos minutos pasa el paso de las invitaciones de calendario del cron (spec
  // 027; 0 = desactivado). Las pruebas lo apagan.
  CALENDAR_INVITE_JOB_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(10),
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
  // CAPTCHA de la página de reservas y del registro (Cloudflare Turnstile). Sin las dos claves no se pide.
  TURNSTILE_SITE_KEY: z.string().trim().optional(),
  TURNSTILE_SECRET_KEY: z.string().trim().optional(),
  // Otros dominios desde los que se resuelve el CAPTCHA, además de los de FRONTEND_URL y APP_URL
  // (separados por comas; p. ej. "example.com" con las claves de prueba de Cloudflare).
  TURNSTILE_HOSTNAMES: z.string().trim().optional(),
  // Sólo para las pruebas: un servidor local que imita a Cloudflare.
  TURNSTILE_VERIFY_URL: z.url().default("https://challenges.cloudflare.com/turnstile/v0/siteverify"),
  // Cupo diario de la cuenta que envía (spec 015): un Gmail gratuito, unos 500 envíos en 24 h; con
  // Google Workspace, unos 2.000. Se mira al enviar (src/services/mailer.ts): lo que no cabe espera.
  EMAIL_DAILY_QUOTA: z.coerce.number().int().min(1).default(500),
  /** Tope de la base de datos del plan de Supabase, en MB (la tarjeta «Base de datos» de Salud). */
  DATABASE_LIMIT_MB: z.coerce.number().int().min(1).default(500),
  /**
   * Tope de los archivos de Supabase Storage (historias clínicas, comprobantes e imágenes), en MB: la
   * pantalla «Base de datos» del super admin principal (spec 024). El plan gratuito tiene 1 GB.
   */
  FILES_LIMIT_MB: z.coerce.number().int().min(1).default(1024),
  // Lo que se guarda del cupo para el equipo (contraseñas, seguridad, planes): los emails al paciente
  // usan como mucho el cupo menos esto.
  EMAIL_TEAM_RESERVE: z.coerce.number().int().min(0).default(20),
  // Lo que se guarda para el paciente (recordatorios, confirmaciones): las copias al profesional y los
  // avisos al negocio usan como mucho el cupo menos esto.
  EMAIL_PATIENT_RESERVE: z.coerce.number().int().min(0).default(100),
  // Emails al paciente que provoca alguien de fuera (reservas online y registros) en 24 h: así quien
  // llene la cuenta con reservas falsas no deja sin recordatorios ni avisos a los negocios (spec 009).
  PUBLIC_EMAILS_PER_DAY: z.coerce.number().int().min(1).default(150),
  // Clave para cifrar el secreto de la verificación en dos pasos en la base (spec 009). Obligatoria
  // en la nube; con una base local se usa una clave fija de desarrollo.
  TWO_FACTOR_KEY: z.string().trim().min(32, "TWO_FACTOR_KEY debe tener al menos 32 caracteres").optional(),
  // Avisos al celular por ntfy desde la API (p. ej. al llegar al tope de emails). Sin NTFY_TOPIC,
  // el aviso sólo queda en el registro.
  NTFY_TOPIC: z.string().trim().optional(),
  NTFY_SERVER: z.url().default("https://ntfy.sh"),
  /** Web publicada, para los enlaces de los emails si difiere de FRONTEND_URL (p. ej. desde este equipo). */
  APP_URL: z.url().optional(),
  // Verificación en dos pasos del super admin. Siempre obligatoria con datos reales (producción, la
  // nube o la base de producción desde este equipo); con una base local, sólo si vale "required".
  SUPER_ADMIN_2FA: z.enum(["required", "optional"]).optional(),
  // Avisos en el celular (Web Push, spec 013): el par de claves propio de Agenda360, creado con
  // `npm run push:keys`. Sin ellas (o si no son válidas) no hay avisos y la API funciona igual.
  VAPID_PUBLIC_KEY: z.string().trim().optional(),
  VAPID_PRIVATE_KEY: z.string().trim().optional(),
  // El contacto que piden los servicios de avisos (mailto: o https:). Por defecto, APP_URL si es
  // https y, si no, el email de GMAIL_USER.
  VAPID_SUBJECT: z.string().trim().optional(),
})
  // Las reservas, de menor a mayor y por debajo del cupo: el equipo puede más que el paciente, y el
  // paciente más que el negocio (ver EMAIL_PRIORITY en src/services/email-limits.ts).
  .superRefine((env, ctx) => {
    if (env.EMAIL_PATIENT_RESERVE >= env.EMAIL_DAILY_QUOTA) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_PATIENT_RESERVE"], message: "debe ser menor que EMAIL_DAILY_QUOTA" });
    }
    if (env.EMAIL_TEAM_RESERVE > env.EMAIL_PATIENT_RESERVE) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_TEAM_RESERVE"], message: "no puede ser mayor que EMAIL_PATIENT_RESERVE" });
    }
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

/**
 * En la nube la API no arranca sin lo que la protege (spec 009). Sin estas variables funcionaría,
 * pero sin CAPTCHA, con la IP del proxy para todos los visitantes, sin cifrar la conexión a la base o
 * sin poder leer la verificación en dos pasos. El registro dice qué falta, nunca un valor.
 */
if (hosted) {
  const problems = [
    !(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) && "faltan TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY",
    !env.PROXY_SECRET && "falta PROXY_SECRET",
    // Una base en este mismo equipo no viaja por la red (sólo pasa en las pruebas que imitan la nube).
    !isLocalDatabaseUrl(env.DATABASE_URL) && env.DATABASE_SSL !== "true" && "DATABASE_SSL debe valer true",
    /[?&]sslmode=/i.test(env.DATABASE_URL) && "DATABASE_URL no debe llevar sslmode (el cifrado lo pone DATABASE_SSL)",
    !env.TWO_FACTOR_KEY && "falta TWO_FACTOR_KEY",
  ].filter(Boolean);
  if (problems.length > 0) {
    console.error(`Configuración insegura para la nube: ${problems.join("; ")}.`);
    process.exit(1);
  }
}

/** Sólo con una base local (demo y pruebas): nunca cifra nada real. */
const DEVELOPMENT_TWO_FACTOR_KEY = "agenda360-clave-de-desarrollo-solo-para-la-base-local";

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

const appUrl = (env.APP_URL ?? env.FRONTEND_URL[0]).replace(/\/+$/, "");

/** Dominios desde los que se puede resolver el CAPTCHA: los del frontend y los de TURNSTILE_HOSTNAMES. */
const captchaHostnames = [
  ...new Set(
    [
      ...[...env.FRONTEND_URL, appUrl].map((url) => new URL(url).hostname),
      ...(env.TURNSTILE_HOSTNAMES ?? "").split(","),
    ]
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/**
 * Avisos en el celular (spec 013). No se suman a lo que impide arrancar en la nube (R2 del plan): no
 * protegen nada, y una clave mal copiada no puede dejar la agenda sin servicio. El registro dice qué
 * falta, nunca un valor.
 */
const vapidProblem = vapidKeysProblem(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
const validSubject = env.VAPID_SUBJECT && /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(env.VAPID_SUBJECT) ? env.VAPID_SUBJECT : null;
if (env.VAPID_SUBJECT && !validSubject) console.warn("VAPID_SUBJECT no empieza por mailto: o https://: se usa el contacto por defecto.");
const webPush = vapidProblem
  ? null
  : {
      publicKey: env.VAPID_PUBLIC_KEY!.replace(/=+$/, ""),
      privateKey: env.VAPID_PRIVATE_KEY!.replace(/=+$/, ""),
      // Sin APP_URL https ni Gmail (sólo en local) queda un contacto reservado que no recibe nada.
      subject:
        validSubject ??
        (appUrl.startsWith("https://") ? appUrl : env.GMAIL_USER ? `mailto:${env.GMAIL_USER}` : "mailto:avisos@agenda360.invalid"),
    };

const turnstile =
  env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY
    ? {
        siteKey: env.TURNSTILE_SITE_KEY,
        secretKey: env.TURNSTILE_SECRET_KEY,
        verifyUrl: env.TURNSTILE_VERIFY_URL,
        hostnames: captchaHostnames,
      }
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
  appUrl,
  cookieSameSite: env.COOKIE_SAME_SITE,
  trustProxy: env.TRUST_PROXY,
  reminderJobIntervalMinutes: env.REMINDER_JOB_INTERVAL_MINUTES,
  calendarInviteJobIntervalMinutes: env.CALENDAR_INVITE_JOB_INTERVAL_MINUTES,
  /** null si faltan las credenciales de Gmail. */
  gmail,
  /** CAPTCHA de las reservas online y del registro. null: desactivado. */
  turnstile,
  /**
   * Cupo diario de Gmail con sus reservas (spec 015, ver EMAIL_PRIORITY en src/services/email-limits.ts):
   * en 24 h, el equipo hasta `quota`, el paciente hasta `quota - teamReserve` y el negocio hasta
   * `quota - patientReserve`.
   */
  emailQuota: { quota: env.EMAIL_DAILY_QUOTA, teamReserve: env.EMAIL_TEAM_RESERVE, patientReserve: env.EMAIL_PATIENT_RESERVE },
  databaseLimitBytes: env.DATABASE_LIMIT_MB * 1024 * 1024,
  /** Tope de los archivos de Supabase Storage (spec 024): no cuentan en la base. */
  filesLimitBytes: env.FILES_LIMIT_MB * 1024 * 1024,
  /** Emails al paciente que provoca el público en 24 h: reservas online y registros (ver email-limits.ts). */
  publicEmailsPerDay: env.PUBLIC_EMAILS_PER_DAY,
  /**
   * Clave del cifrado del secreto de la verificación en dos pasos (ver services/secret-box.ts). null:
   * la base no es local y falta TWO_FACTOR_KEY (en la nube la API ni arranca).
   */
  twoFactorKey: env.TWO_FACTOR_KEY ?? (!hosted && !productionDbFromHere ? DEVELOPMENT_TWO_FACTOR_KEY : null),
  /** Claves de los avisos en el celular (null: sin avisos; ver services/web-push.ts). */
  webPush,
  /** Por qué no hay avisos en el celular ("falta VAPID_PRIVATE_KEY"), sin valores; null si hay. Lo registran la API y el cron. */
  webPushProblem: vapidProblem,
  /**
   * Las direcciones de aparatos en `http://127.0.0.1:<puerto>` (el servicio de avisos falso de las
   * pruebas): sólo con una base local, nunca en la nube ni con la base de producción (R4).
   */
  pushAllowsLocalEndpoints: !hosted && !productionDbFromHere,
  /** Avisos por ntfy desde la API (null: sólo en el registro). */
  ntfy: env.NTFY_TOPIC ? { topic: env.NTFY_TOPIC, server: env.NTFY_SERVER.replace(/\/+$/, "") } : null,
  /**
   * El super admin debe tener la verificación en dos pasos para usar /admin y el modo soporte. Con
   * datos reales no se puede desactivar; con una base local (datos demo y pruebas) es opcional.
   */
  superAdminTwoFactorRequired: isProduction || hosted || productionDbFromHere || env.SUPER_ADMIN_2FA === "required",
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
