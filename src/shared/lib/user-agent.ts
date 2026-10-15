// Copia de agenda-front/src/lib/user-agent.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
/** "Chrome en Windows", "Safari en iPhone"… a partir del User-Agent (aproximado). */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg(e|A|iOS)?\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /SamsungBrowser/.test(userAgent)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(userAgent)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(userAgent)
            ? "Chrome"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : null;
  const system = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(userAgent)
            ? "Mac"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? system ?? "Navegador desconocido";
}
