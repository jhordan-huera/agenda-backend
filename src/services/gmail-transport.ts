import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";

/**
 * Envío con la cuenta de Gmail, de dos formas (variable GMAIL_TRANSPORT):
 *
 * - `smtp` (por defecto): SMTP con OAuth2. Google sólo lo admite con el permiso
 *   https://mail.google.com/, que da acceso a TODO el buzón (leer, borrar, reenviar): si el refresh
 *   token se filtrara, se filtraría el buzón entero.
 * - `api`: la API de Gmail (users.messages.send). Basta el permiso
 *   https://www.googleapis.com/auth/gmail.send: con el token sólo se pueden enviar emails. Exige un
 *   refresh token generado con ese permiso (ver README, «Emails»).
 *
 * Lo usan la cola de emails (mailer.ts) y la copia de seguridad (scripts/backup.ts).
 */
export type GmailTransportKind = "smtp" | "api";

export interface GmailAccount {
  user: string;
  fromName: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailSender {
  kind: GmailTransportKind;
  send(mail: Mail.Options): Promise<void>;
  close(): void;
}

/** La forma de envío de GMAIL_TRANSPORT (vacía: smtp, la de siempre). */
export function gmailTransportKind(value = process.env.GMAIL_TRANSPORT): GmailTransportKind {
  const kind = value?.trim().toLowerCase() || "smtp";
  if (kind !== "smtp" && kind !== "api") throw new Error(`GMAIL_TRANSPORT debe ser "smtp" o "api" (ahora es "${value}").`);
  return kind;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Subida del mensaje completo (RFC 822): admite hasta 35 MB, también los adjuntos de las copias. */
const SEND_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media";
/** El token de acceso se renueva un minuto antes de caducar. */
const TOKEN_MARGIN_MS = 60_000;

/**
 * El email tal como sale (RFC 822), compuesto por nodemailer igual que lo haría por SMTP. Gmail lee
 * los destinatarios de las cabeceras, así que se conserva Bcc (Gmail la quita al enviar).
 */
export async function buildRawMessage(mail: Mail.Options): Promise<Buffer> {
  const message = new MailComposer(mail).compile();
  message.keepBcc = true;
  return message.build();
}

interface SenderOptions {
  kind?: GmailTransportKind;
  /** Inactividad máxima (SMTP) o duración máxima de cada petición (API). */
  timeoutMs?: number;
  /** Sólo para las pruebas: otra forma de hacer las peticiones (sin red). */
  fetch?: typeof fetch;
}

function smtpSender(account: GmailAccount, timeoutMs: number): GmailSender {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: account.user,
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      refreshToken: account.refreshToken,
    },
    // Sin límites, una conexión colgada con Gmail retendría el lote (y la función) indefinidamente.
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: timeoutMs,
  });
  return {
    kind: "smtp",
    send: async (mail) => {
      await transporter.sendMail(mail);
    },
    close: () => transporter.close(),
  };
}

function apiSender(account: GmailAccount, timeoutMs: number, request: typeof fetch): GmailSender {
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_MARGIN_MS > Date.now()) return token.value;
    const response = await request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: account.clientId,
        client_secret: account.clientSecret,
        refresh_token: account.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
    if (!response.ok || typeof body.access_token !== "string") {
      // Sólo el código de error (p. ej. invalid_grant: token revocado o caducado), nunca el token.
      throw new Error(`Gmail no renovó el acceso (${response.status} ${typeof body.error === "string" ? body.error : ""})`.trim());
    }
    token = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return token.value;
  }

  return {
    kind: "api",
    async send(mail) {
      const raw = await buildRawMessage(mail);
      const response = await request(SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "message/rfc822" },
        body: new Uint8Array(raw),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return;
      // Acceso caducado o revocado: el siguiente intento pide otro.
      if (response.status === 401) token = null;
      throw new Error(`API de Gmail ${response.status}: ${(await response.text()).replace(/\s+/g, " ").slice(0, 300)}`);
    },
    close: () => undefined,
  };
}

/** Quien envía con la cuenta de Gmail, por SMTP o por la API según GMAIL_TRANSPORT. */
export function createGmailSender(account: GmailAccount, options: SenderOptions = {}): GmailSender {
  const timeoutMs = options.timeoutMs ?? 12_000;
  return (options.kind ?? gmailTransportKind()) === "api"
    ? apiSender(account, timeoutMs, options.fetch ?? fetch)
    : smtpSender(account, timeoutMs);
}
