/**
 * Datos de personas a medias, para los avisos de ntfy: un tema de ntfy lo lee cualquiera que conozca
 * su nombre y los pacientes son datos de salud. Lo justo para reconocer a quién se refiere; los datos
 * completos están en el panel.
 */

/** "an***@gmail.com" */
export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  const visible = `${local.slice(0, 2)}***`;
  return domain ? `${visible}@${domain}` : visible;
}

/** "Juan Pérez López" → "Juan P."; un solo nombre queda igual. */
export function shortName(value: string): string {
  const [first, second] = value.trim().split(/\s+/);
  return second ? `${first} ${second.charAt(0).toUpperCase()}.` : (first ?? "");
}

/** "0994445555" → "099***5555"; "+593 99 444 5555" → "+593***5555"; "" si no hay teléfono. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return digits ? "***" : "";
  return `${value.trim().startsWith("+") ? "+" : ""}${digits.slice(0, 3)}***${digits.slice(-4)}`;
}
