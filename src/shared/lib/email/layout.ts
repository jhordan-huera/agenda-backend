// Copia de agenda-front/src/lib/email/layout.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
/**
 * Diseño de los emails: cada plantilla describe su contenido en bloques y de ahí salen dos
 * versiones, HTML (tablas y estilos en línea, lo que entienden Gmail, Outlook y Apple Mail) y
 * texto (para clientes sin HTML y para el registro de emails del panel).
 */

export type EmailBlock =
  /** Párrafo. */
  | { kind: "text"; text: string }
  /** Botón (en texto: "Etiqueta: URL"). */
  | { kind: "button"; label: string; url: string }
  /** Recuadro de datos: "Etiqueta: valor" (con enlace opcional). */
  | { kind: "details"; title?: string; rows: { label: string; value: string; href?: string; mono?: boolean }[] }
  /** Aviso destacado (p. ej. motivo de un rechazo). */
  | { kind: "callout"; text: string; tone?: "info" | "warning" }
  /** Texto pequeño y gris. */
  | { kind: "note"; text: string };

export interface EmailMessage {
  subject: string;
  /** Resumen que muestra la bandeja de entrada junto al asunto. */
  preheader: string;
  /** Cabecera: la marca (Agenda360) o el negocio en los emails de citas. */
  brand: { name: string; caption?: string };
  title: string;
  greeting?: string;
  blocks: EmailBlock[];
  /** Firma: "El equipo de Agenda360" o los datos del negocio. */
  signature: string[];
  /** Pie pequeño bajo la tarjeta. */
  footer: string;
}

export interface EmailContent {
  subject: string;
  body: string;
  html: string;
}

const COLORS = {
  brand: "#4f46e5",
  text: "#111827",
  muted: "#6b7280",
  border: "#e5e7eb",
  page: "#f3f4f6",
  panel: "#f9fafb",
  info: { bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3" },
  warning: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Escapa texto para HTML (nombres, notas… los escribe la gente). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Saltos de línea del texto → <br>. */
const multiline = (value: string) => escapeHtml(value).replace(/\n/g, "<br>");
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : "#");

function renderBlockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
      return `<p style="margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${COLORS.text};">${multiline(block.text)}</p>`;
    case "note":
      return `<p style="margin:0 0 16px;font:400 13px/1.5 ${FONT};color:${COLORS.muted};">${multiline(block.text)}</p>`;
    case "button":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td style="border-radius:8px;background:${COLORS.brand};"><a href="${safeUrl(block.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font:600 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a></td>
</tr></table>`;
    case "callout": {
      const tone = COLORS[block.tone ?? "info"];
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
<td style="padding:12px 16px;background:${tone.bg};border:1px solid ${tone.border};border-radius:8px;font:400 14px/1.5 ${FONT};color:${tone.text};">${multiline(block.text)}</td>
</tr></table>`;
    }
    case "details": {
      const rows = block.rows
        .map(
          (row) => `<tr>
<td valign="top" style="padding:6px 12px 6px 0;width:38%;font:400 14px/1.4 ${FONT};color:${COLORS.muted};">${escapeHtml(row.label)}</td>
<td valign="top" style="padding:6px 0;font:600 14px/1.4 ${row.mono ? MONO : FONT};color:${COLORS.text};">${
            row.href
              ? `<a href="${safeUrl(row.href)}" target="_blank" style="color:${COLORS.brand};text-decoration:underline;">${escapeHtml(row.value)}</a>`
              : multiline(row.value)
          }</td>
</tr>`,
        )
        .join("");
      const title = block.title
        ? `<p style="margin:0 0 8px;font:600 11px/1.4 ${FONT};letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.muted};">${escapeHtml(block.title)}</p>`
        : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:10px;"><tr>
<td style="padding:16px 18px;">${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td>
</tr></table>`;
    }
  }
}

function renderHtml(message: EmailMessage): string {
  const initial = escapeHtml(message.brand.name.trim().charAt(0).toUpperCase() || "A");
  // Botones: bajo el último, el enlace en texto por si el botón no se ve.
  const buttons = message.blocks.filter(
    (block): block is Extract<EmailBlock, { kind: "button" }> => block.kind === "button" && /^https?:\/\//i.test(block.url),
  );
  const fallback = buttons.length
    ? `<p style="margin:8px 0 0;font:400 12px/1.5 ${FONT};color:${COLORS.muted};">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${safeUrl(buttons[0].url)}" style="color:${COLORS.brand};word-break:break-all;">${escapeHtml(buttons[0].url)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(message.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(message.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:${COLORS.brand};border-radius:9px;font:700 17px/36px ${FONT};color:#ffffff;">${initial}</td>
<td style="padding-left:10px;">
<div style="font:700 17px/1.2 ${FONT};color:${COLORS.text};">${escapeHtml(message.brand.name)}</div>
${message.brand.caption ? `<div style="font:400 12px/1.4 ${FONT};color:${COLORS.muted};">${escapeHtml(message.brand.caption)}</div>` : ""}
</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${COLORS.border};border-radius:14px;padding:32px 28px;">
<h1 style="margin:0 0 18px;font:700 22px/1.3 ${FONT};color:${COLORS.text};">${escapeHtml(message.title)}</h1>
${message.greeting ? `<p style="margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${COLORS.text};">${escapeHtml(message.greeting)}</p>` : ""}
${message.blocks.map(renderBlockHtml).join("\n")}
<p style="margin:8px 0 0;font:400 15px/1.6 ${FONT};color:${COLORS.text};">${message.signature.map(escapeHtml).join("<br>")}</p>
${fallback}
</td></tr>
<tr><td align="center" style="padding:18px 12px 0;font:400 12px/1.5 ${FONT};color:${COLORS.muted};">${multiline(message.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderBlockText(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
    case "note":
    case "callout":
      return block.text;
    case "button":
      return `${block.label}: ${block.url}`;
    case "details":
      return [block.title, ...block.rows.map((row) => `${row.label}: ${row.href ?? row.value}`)].filter(Boolean).join("\n");
  }
}

function renderText(message: EmailMessage): string {
  return [message.greeting, ...message.blocks.map(renderBlockText), message.signature.join("\n")]
    .filter((part) => part && part.trim())
    .join("\n\n");
}

/** Asunto, texto y HTML de un email. */
export function composeEmail(message: EmailMessage): EmailContent {
  return { subject: message.subject, body: renderText(message), html: renderHtml(message) };
}
