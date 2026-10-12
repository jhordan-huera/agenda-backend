// Envío por la API de Gmail (GMAIL_TRANSPORT=api), sin red: el mensaje RFC 822 que se sube, la
// renovación del token con el refresh token y que los errores no muestren las credenciales.
import { buildRawMessage, createGmailSender, gmailTransportKind } from "../src/services/gmail-transport.ts";

let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (cond) console.log("  ✓", label);
  else {
    failures++;
    console.log("  ✗", label, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
  }
};

const account = {
  user: "agenda@example.com",
  fromName: "Agenda360",
  clientId: "id-de-cliente.apps.googleusercontent.com",
  clientSecret: "secreto-del-cliente-123",
  refreshToken: "1//refresh-token-de-prueba",
};
const mail = {
  from: { name: account.fromName, address: account.user },
  to: "paciente@example.com",
  subject: "Tu cita está confirmada",
  text: "Hola, tu cita es el martes a las 10:00.",
  html: "<p>Hola, tu cita es el <b>martes</b> a las 10:00.</p>",
};

console.log("Mensaje RFC 822");
const raw = (await buildRawMessage(mail)).toString("utf8");
const headers = raw.slice(0, raw.indexOf("\r\n\r\n"));
ok(/^From: Agenda360 <agenda@example\.com>$/m.test(headers), "remitente con nombre", headers);
ok(/^To: paciente@example\.com$/m.test(headers), "destinatario", headers);
ok(/^Subject: =\?UTF-8\?[QB]\?/m.test(headers), "asunto con tildes codificado (RFC 2047)", headers);
ok(/^Message-ID: <.+@.+>$/m.test(headers) && /^Date: /m.test(headers) && /^MIME-Version: 1\.0$/m.test(headers), "con Message-ID, fecha y MIME", headers);
ok(/^Content-Type: multipart\/alternative;\s+boundary=/m.test(headers), "texto y HTML como alternativas", headers);
ok(/Content-Type: text\/plain; charset=utf-8/.test(raw) && /Content-Type: text\/html; charset=utf-8/.test(raw), "las dos partes en UTF-8");
const withBcc = (await buildRawMessage({ ...mail, bcc: "copia@example.com" })).toString("utf8");
ok(/^Bcc: copia@example\.com$/m.test(withBcc), "conserva Bcc (Gmail la quita al enviar)");
const withAttachment = (
  await buildRawMessage({ ...mail, html: undefined, attachments: [{ filename: "agenda360-2026-10-09.sql.gz.enc", content: Buffer.from("cifrado"), contentType: "application/octet-stream" }] })
).toString("utf8");
ok(/multipart\/mixed/.test(withAttachment) && /filename=agenda360-2026-10-09\.sql\.gz\.enc/.test(withAttachment), "con adjunto (la copia de seguridad)");

console.log("Forma de envío");
ok(gmailTransportKind(undefined) === "smtp" && gmailTransportKind("") === "smtp", "por defecto, SMTP (como hasta ahora)");
ok(gmailTransportKind("api") === "api" && gmailTransportKind(" API ") === "api", "GMAIL_TRANSPORT=api");
let threw = false;
try {
  gmailTransportKind("pop3");
} catch {
  threw = true;
}
ok(threw, "otro valor es un error claro");

console.log("API de Gmail (sin red)");
type Call = { url: string; method?: string; headers: Record<string, string>; body: string };
const calls: Call[] = [];
let sendStatus = 200;
let tokenStatus = 200;
let issued = 0;
const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input);
  const body = init.body instanceof Uint8Array ? Buffer.from(init.body).toString("utf8") : String(init.body ?? "");
  calls.push({ url, method: init.method, headers: init.headers as Record<string, string>, body });
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    if (tokenStatus !== 200) return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: tokenStatus });
    issued++;
    return new Response(JSON.stringify({ access_token: `ya29.token-${issued}`, expires_in: 3599, token_type: "Bearer" }), { status: 200 });
  }
  if (url.startsWith("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send")) {
    return new Response(sendStatus === 200 ? JSON.stringify({ id: "18c0", threadId: "18c0" }) : JSON.stringify({ error: { code: sendStatus, message: "Request had insufficient authentication scopes." } }), { status: sendStatus });
  }
  return new Response("no esperada", { status: 500 });
}) as typeof fetch;

const sender = createGmailSender(account, { kind: "api", fetch: fakeFetch });
ok(sender.kind === "api", "con kind api usa la API");
await sender.send(mail);
const [tokenCall, sendCall] = calls;
const form = new URLSearchParams(tokenCall?.body);
ok(
  tokenCall?.method === "POST" &&
    form.get("grant_type") === "refresh_token" &&
    form.get("refresh_token") === account.refreshToken &&
    form.get("client_id") === account.clientId &&
    form.get("client_secret") === account.clientSecret,
  "renueva el acceso con el refresh token",
  tokenCall,
);
ok(
  sendCall?.method === "POST" &&
    sendCall.url.endsWith("/upload/gmail/v1/users/me/messages/send?uploadType=media") &&
    sendCall.headers.Authorization === "Bearer ya29.token-1" &&
    sendCall.headers["Content-Type"] === "message/rfc822",
  "sube el mensaje a users.messages.send con el token",
  sendCall && { ...sendCall, body: undefined },
);
ok(sendCall?.body.includes("To: paciente@example.com") && sendCall.body.includes("Content-Type: text/html"), "el cuerpo es el mensaje RFC 822");

await sender.send(mail);
ok(calls.length === 3 && calls[2].headers.Authorization === "Bearer ya29.token-1", "el token se reutiliza mientras no caduca", calls.length);

sendStatus = 401;
let error = await sender.send(mail).then(() => null, (e: Error) => e);
ok(error && /API de Gmail 401/.test(error.message), "un 401 es un error (se reintenta en la cola)", error?.message);
sendStatus = 200;
await sender.send(mail);
ok(calls.at(-2)?.url.startsWith("https://oauth2.googleapis.com/token") && calls.at(-1)?.headers.Authorization === "Bearer ya29.token-2", "tras un 401 pide un token nuevo", calls.length);

sendStatus = 403;
error = await sender.send(mail).then(() => null, (e: Error) => e);
ok(error && /403/.test(error.message) && /insufficient authentication scopes/.test(error.message), "sin el permiso gmail.send, el error lo dice", error?.message);
sendStatus = 200;

const fresh = createGmailSender(account, { kind: "api", fetch: fakeFetch });
tokenStatus = 400;
error = await fresh.send(mail).then(() => null, (e: Error) => e);
ok(
  error && /invalid_grant/.test(error.message) && !error.message.includes(account.refreshToken) && !error.message.includes(account.clientSecret),
  "token revocado: invalid_grant, sin mostrar las credenciales",
  error?.message,
);

console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallos.`);
process.exitCode = failures === 0 ? 0 : 1;
