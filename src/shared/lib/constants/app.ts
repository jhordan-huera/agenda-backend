// Copia de agenda-front/src/lib/constants/app.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { ThemeMode } from "../../types/index.ts";

export const APP_NAME = "Agenda360";
export const APP_TAGLINE = "Tu agenda, tus clientes, tu negocio.";

export const DEFAULT_TIMEZONE = "America/Guayaquil";
export const DEFAULT_CURRENCY = "USD";

export const DEFAULT_SUPPORT_EMAIL = "soporte@agendo.app";

/** Opciones del modo de pantalla (spec 019), en el orden en que se muestran. */
export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: "Claro",
  dark: "Oscuro",
  auto: "Automático",
};
