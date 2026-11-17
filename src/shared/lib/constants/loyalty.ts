// Copia de agenda-front/src/lib/constants/loyalty.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { LoyaltyBenefitKind, LoyaltyLevel, SocialLinks, StampIcon } from "../../types/index.ts";

/*
 * Tarjeta de fidelización (spec 052): los sellos, los tipos de beneficio, los niveles, el QR y las redes. Lo comparten
 * el panel, la tarjeta del paciente y la API.
 */

/** Los íconos del sello, en el orden del selector. La migración 059 tiene la misma lista en un `check`. */
export const STAMP_ICONS: readonly { value: StampIcon; label: string }[] = [
  { value: "tooth", label: "Diente" },
  { value: "brain", label: "Cerebro" },
  { value: "heart", label: "Corazón" },
  { value: "hand", label: "Mano" },
  { value: "leaf", label: "Hoja" },
  { value: "scissors", label: "Tijeras" },
  { value: "sparkles", label: "Brillo" },
  { value: "droplet", label: "Gota" },
  { value: "smile", label: "Sonrisa" },
  { value: "stethoscope", label: "Estetoscopio" },
  { value: "dumbbell", label: "Pesa" },
  { value: "paw", label: "Huella" },
  { value: "star", label: "Estrella" },
];
export const STAMP_ICON_KEYS = STAMP_ICONS.map((icon) => icon.value) as [StampIcon, ...StampIcon[]];

export const BENEFIT_KINDS: readonly { value: LoyaltyBenefitKind; label: string }[] = [
  { value: "percent", label: "Descuento en porcentaje" },
  { value: "fixed", label: "Descuento de un valor fijo" },
  { value: "free_appointment", label: "Cita gratis" },
  { value: "free_service", label: "Servicio gratis" },
  { value: "custom", label: "Personalizado" },
];
export const BENEFIT_KIND_KEYS = BENEFIT_KINDS.map((kind) => kind.value) as [LoyaltyBenefitKind, ...LoyaltyBenefitKind[]];

/** Hasta cuántas citas puede pedir un beneficio y hasta cuántos días puede durar una recompensa. */
export const LOYALTY_MAX_VISITS = 100;
export const LOYALTY_MAX_VALID_DAYS = 730;
/** Las casillas de la tarjeta: hasta el último beneficio, con este mínimo. */
export const LOYALTY_MIN_SLOTS = 5;

export const LOYALTY_LEVELS: Record<LoyaltyLevel, string> = { classic: "Clásica", silver: "Plata", gold: "Oro" };

/** El nivel de una tarjeta: la 1 es Clásica, la 2 Plata y de la 3 en adelante Oro. */
export function levelOf(cardNumber: number): LoyaltyLevel {
  return cardNumber >= 3 ? "gold" : cardNumber === 2 ? "silver" : "classic";
}

/** El texto corto de un beneficio («50 % de descuento», «$10 de descuento», «Cita gratis»…). */
export function describeBenefit(kind: LoyaltyBenefitKind, value: number | null, serviceName?: string | null, currency = "USD"): string {
  if (kind === "percent") return `${value ?? 0} % de descuento`;
  if (kind === "fixed") {
    const amount = new Intl.NumberFormat("es-EC", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value ?? 0);
    return `${amount} de descuento`;
  }
  if (kind === "free_appointment") return "Cita gratis";
  if (kind === "free_service") return serviceName ? `${serviceName} gratis` : "Servicio gratis";
  return "Beneficio personalizado";
}

/** El precio de una cita después de canjear una recompensa en ella (nunca negativo). «Personalizado» no lo cambia. */
export function priceAfterReward(price: number, kind: LoyaltyBenefitKind, value: number | null): number {
  if (kind === "percent") return Math.max(0, Math.round(price * (1 - (value ?? 0) / 100) * 100) / 100);
  if (kind === "fixed") return Math.max(0, Math.round((price - (value ?? 0)) * 100) / 100);
  if (kind === "free_appointment" || kind === "free_service") return 0;
  return price;
}

/** El código de una recompensa: 6 caracteres sin los que se confunden (0, O, 1, I), como «K7Q-3MD». */
export const REWARD_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const formatRewardCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);
/** Lo que escribe el equipo («k7q 3md», «K7Q-3MD») como se guarda («K7Q3MD»). */
export const normalizeRewardCode = (text: string) => text.toUpperCase().replace(/[^0-9A-Z]/g, "");

/** El enlace para cambiar la contraseña de un paciente vence a las 24 horas. */
export const PATIENT_RESET_HOURS = 24;

/* -- El QR del paciente: un enlace a /q/:token, que el panel también lee con «Escanear». -- */

const QR_TOKEN = /^[0-9a-f]{32}$/;

export const patientQrUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}/q/${token}`;

/** El QR del consultorio para sus pacientes: «Mi tarjeta» con su nombre y su logo, para crear la cuenta. */
export const PATIENT_INVITE_PARAM = "consultorio";
export const patientInviteUrl = (origin: string, slug: string) =>
  `${origin.replace(/\/+$/, "")}/mi-tarjeta?${PATIENT_INVITE_PARAM}=${encodeURIComponent(slug)}`;

/** El token de lo que leyó la cámara: el enlace `…/q/<token>` o el token solo. null si no es un QR de paciente. */
export function readQrToken(text: string): string | null {
  const value = text.trim();
  const match = /\/q\/([0-9a-f]{32})(?:[/?#]|$)/i.exec(value);
  const token = (match ? match[1] : value).toLowerCase();
  return QR_TOKEN.test(token) ? token : null;
}

/* -- Las redes del negocio: se guarda el enlace del dominio de cada red; '' = no la tiene. -- */

export const SOCIAL_NETWORKS: readonly { key: keyof SocialLinks; label: string; domain: string }[] = [
  { key: "facebook", label: "Facebook", domain: "facebook.com" },
  { key: "instagram", label: "Instagram", domain: "instagram.com" },
  { key: "tiktok", label: "TikTok", domain: "tiktok.com" },
];

export const EMPTY_SOCIAL_LINKS: SocialLinks = { facebook: "", instagram: "", tiktok: "" };

/**
 * Lo que escribe el negocio («@sonrisa», «instagram.com/sonrisa», el enlace completo) como enlace de esa red. '' si
 * está vacío; null si no es de esa red o el usuario no es válido.
 */
export function normalizeSocialLink(network: keyof SocialLinks, input: string): string | null {
  const value = input.trim();
  if (value === "") return "";
  const { domain } = SOCIAL_NETWORKS.find((item) => item.key === network)!;
  const handle = /^@?([A-Za-z0-9._-]{1,60})$/.exec(value);
  if (handle) return network === "tiktok" ? `https://www.tiktok.com/@${handle[1]}` : `https://www.${domain}/${handle[1]}`;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host !== domain || url.pathname.length <= 1 || url.username || url.password) return null;
  return `https://www.${domain}${url.pathname.replace(/\/+$/, "")}`;
}

/** Sólo las redes que tiene, en el orden de siempre (la tarjeta y la página de reservas). */
export function socialLinksOf(links: SocialLinks | null | undefined): { key: keyof SocialLinks; label: string; url: string }[] {
  return SOCIAL_NETWORKS.filter((network) => (links?.[network.key] ?? "") !== "").map((network) => ({
    key: network.key,
    label: network.label,
    url: links![network.key],
  }));
}
