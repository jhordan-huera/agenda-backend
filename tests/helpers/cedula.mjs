// Cédula ecuatoriana válida y estable a partir de un texto (p. ej. el email del cliente de prueba).
export function cedulaFor(seed) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000;
  const nine = `091${String(hash).padStart(6, "0")}`;
  const sum = [...nine].reduce((t, d, i) => { const p = Number(d) * (i % 2 === 0 ? 2 : 1); return t + (p > 9 ? p - 9 : p); }, 0);
  return `${nine}${(10 - (sum % 10)) % 10}`;
}
