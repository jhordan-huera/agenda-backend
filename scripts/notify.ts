/**
 * Avisos al celular por ntfy (https://ntfy.sh) de los trabajos de GitHub Actions: el cron de
 * correos (cron.ts) y la copia de seguridad (backup.ts). Los registros de Actions son públicos:
 * en ellos sólo queda el título; el mensaje va únicamente a ntfy.
 *
 * Variables: NTFY_TOPIC (sin él, el aviso sólo queda en el registro) y, opcionales, NTFY_SERVER
 * (por defecto https://ntfy.sh) y APP_URL (enlace del aviso).
 */

export interface Notice {
  title: string;
  message: string;
  /** Escala de ntfy: 2 baja (sin sonido), 3 normal, 4 alta, 5 urgente (un trabajo no pudo hacerse). */
  priority: 2 | 3 | 4 | 5;
  tags: string[];
}

/** ntfy no muestra como texto los mensajes de más de 4096 bytes. */
const NTFY_LIMIT = 4_000;

export function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export async function notify(notice: Notice): Promise<void> {
  const topic = env("NTFY_TOPIC");
  // Sólo el título: el registro de Actions es público y el mensaje puede llevar cuentas.
  console.info(`[ntfy] ${notice.title}`);
  if (!topic) {
    console.warn("Sin NTFY_TOPIC: el aviso sólo queda en este registro.");
    return;
  }
  const server = (env("NTFY_SERVER") ?? "https://ntfy.sh").replace(/\/+$/, "");
  const appUrl = env("APP_URL");
  const message =
    Buffer.byteLength(notice.message) <= NTFY_LIMIT
      ? notice.message
      : Buffer.from(notice.message).subarray(0, NTFY_LIMIT - 10).toString().replace(/�+$/, "") + "\n…";
  const response = await fetch(`${server}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      title: notice.title,
      message,
      priority: notice.priority,
      tags: notice.tags,
      ...(appUrl ? { click: `${appUrl.replace(/\/+$/, "")}/admin` } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ntfy respondió ${response.status}: ${(await response.text()).slice(0, 200)}`);
}
