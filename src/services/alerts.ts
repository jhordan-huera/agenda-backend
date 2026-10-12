import { waitUntil } from "@vercel/functions";
import { config } from "../config.ts";

/**
 * Avisos al celular por ntfy desde la API (los del cron los envía scripts/notify.ts, que no va en
 * el paquete de Lambda). Siempre quedan en el registro; a ntfy sólo llegan con NTFY_TOPIC.
 * Nunca hacen fallar la petición que los provoca: se envían en segundo plano.
 */

export interface Alert {
  title: string;
  message: string;
  /** Escala de ntfy: 3 normal, 4 alta, 5 urgente. */
  priority: 3 | 4 | 5;
  tags: string[];
}

const pending = new Set<Promise<void>>();

async function post(alert: Alert): Promise<void> {
  const ntfy = config.ntfy!;
  const response = await fetch(`${ntfy.server}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: ntfy.topic,
      title: alert.title,
      message: alert.message,
      priority: alert.priority,
      tags: alert.tags,
      click: `${config.appUrl}/admin/activity`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ntfy respondió ${response.status}`);
}

/** Registra el aviso y lo envía a ntfy sin esperar (en Vercel, waitUntil; en Lambda, flushAlerts). */
export function sendAlert(alert: Alert): void {
  console.error(`[aviso] ${alert.title}: ${alert.message}`);
  if (!config.ntfy) return;
  const sending = post(alert)
    .catch((error: unknown) => console.error("[aviso] No se pudo enviar a ntfy:", error instanceof Error ? error.message : error))
    .finally(() => pending.delete(sending));
  pending.add(sending);
  if (config.onVercel) waitUntil(sending);
}

/** Lambda congela la ejecución al responder: app.ts espera aquí los avisos pendientes. */
export async function flushAlerts(): Promise<void> {
  await Promise.all([...pending]);
}
