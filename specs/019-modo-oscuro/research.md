# Decisiones técnicas: Modo oscuro

## R1. Dónde vive el modo

**Decisión:** en la columna `users.theme_mode`, con `'auto'` por defecto. Viaja en `GET /auth/session`,
leído en la consulta de la sesión que ya se hace en cada petición. Se cambia con
`PUT /auth/theme-mode`.

**Por qué:**
- el dueño pidió que se guarde en la cuenta;
- la sesión ya se pide al entrar, así que no hace falta ninguna consulta ni petición nueva (la CPU de
  Vercel);
- el `'auto'` por defecto de la propia migración cumple «todos empiezan en Automático».

**Alternativas:**
- *Sólo en el aparato:* el dueño lo descartó.
- *Dentro de `panel_colors`:* ésos son sólo del super admin. El modo es de todos.

## R2. Sin destello al abrir

**Decisión:** un archivo `public/theme-boot.js` que el `<head>` carga sin `async`.
- Pone `dark` en `<html>` y el `theme-color` antes de pintar.
- Lee la última elección del aparato (`localStorage`) o el modo del aparato.
- En las páginas de los pacientes, sólo el modo del aparato.

**Por qué:** el CSP es `script-src 'self'`, así que un script dentro del HTML no correría. Un archivo
del mismo dominio sí, como ya pasa con `early-data.js`. Es menos de 1 KB, va en la CDN y lo guarda el
service worker.

**Alternativas:**
- *Un `hash` del script en el CSP:* frágil, se rompe con cada cambio del script.
- *Esperar a React:* deja ver el destello blanco.

## R3. Aplicar y escuchar el modo

**Decisión:** un `ThemeModeProvider`.
- **Qué modo usa:**
  - con sesión, el de la sesión;
  - sin sesión, la última elección del aparato o el modo del aparato;
  - en las páginas de los pacientes, siempre el modo del aparato.
- **«Automático»** escucha `matchMedia('(prefers-color-scheme: dark)')` y cambia sin recargar.
- **Guarda** la última elección en `localStorage`.

**Por qué:** un solo lugar decide el modo, y `theme-boot.js` y React usan la misma regla.

## R4. La paleta oscura desde los mismos colores

**Decisión:** `resolveBrandPalette` devuelve `{ light, dark }`. La oscura usa las mismas funciones
OKLCH (`tone`, `adjustLightness`, `contrastRatio`), con estas claridades:

| Qué | Claro (hoy) | Oscuro |
|---|---|---|
| Fondo (`paper`/`card`) | blanco | L 0,21, con el tono del principal |
| Lienzo (`canvas`) / `desk` | 0,962 / 0,976 | 0,17 / 0,24 |
| Texto | 0,261 | 0,93 |
| Texto secundario (`graphite`) | 0,503 | ~0,72, hasta 4,5:1 sobre `desk` |
| Principal (`ink`) | el del negocio, hasta 4,5:1 con texto blanco | aclarado hasta 4,5:1 sobre el fondo; el texto de sus botones, el fondo oscuro |
| Resaltado | el del negocio, hasta 4,5:1 con el texto | oscurecido hasta 4,5:1 con el texto claro |
| Bordes (`rule`) | texto al 10 % y 18 % | texto claro al 12 % y 22 % |
| Menú (`shell`) | 0,235 | 0,15 |

Los colores de Agenda360 en `index.css` (bloque `.dark`) salen de esta misma fórmula con
`DEFAULT_BRAND_COLORS`. Así un negocio sin colores propios y uno con ellos se ven igual de bien.

**Por qué:** cumple la decisión «los mismos colores, ajustados solos». La fórmula clara ya garantiza
el contraste moviendo la claridad, y la oscura hace lo mismo hacia el otro lado.

**Alternativas:** invertir los colores. Lo descarté porque cambia el tono y quedan colores chillones.

## R5. Variables en un `<style>` e impresión clara

**Decisión:**
- `BrandThemeProvider` inyecta un `<style>` con:
  - `:root { claras }`;
  - `@media screen { :root.dark { oscuras } }`.
- La variante `dark` de Tailwind pasa a ser `@custom-variant dark { @media screen { &:where(.dark,
  .dark *) { @slot; } } }`.
- Los tokens oscuros de `index.css` también van dentro de `@media screen`.

**Por qué:**
- Hoy las variables van en el atributo `style` de `<html>`, y eso le gana a cualquier regla de modo.
  Con el `<style>`, cambiar de modo es sólo cambiar la clase.
- Al imprimir sólo valen las claras, así que el reporte impreso sale igual que hoy, sin código aparte.
- El CSP permite estilos dentro del HTML (`style-src 'unsafe-inline'`).

## R6. Los colores fijos

**Recuento** (2026-10-16): unos 91 `bg-white`, `text-white` o `black`; 196 paletas fijas (emerald,
amber, red…); 6 hex en clases y 15 hex en 12 archivos.

| Grupo | Cómo |
|---|---|
| Superficies blancas | Tokens: `bg-card`, `bg-background`, `bg-popover`. |
| Texto blanco sobre el principal | `text-primary-foreground`. |
| Estados de las citas (`appointment-status.ts`, compartido) y avisos de éxito, alerta y error | Variante `dark:`: fondo del mismo color al 15 %, texto 300, borde 500/40. Siguen distinguiéndose. |
| Colores de cada profesional | `professionalColor(index, mode)`: el mismo tono aclarado hasta 3:1 sobre el fondo oscuro, para las barras y bordes. El texto de la cita usa el del modo. |
| Gráficos | `useChartColors()` devuelve los del modo: los del negocio o los de Agenda360. |
| Odontograma y mapa del cuerpo | Los trazos y el texto con `currentColor`. Los colores de cada estado, con su versión para fondo oscuro. Lo impreso, igual que hoy. |
| QR, placa del logo, ícono de WhatsApp, emails | Se quedan como están, a propósito. |

**Cómo se comprueba:** al terminar, `grep` de `bg-white`, `text-white` y los hex. Cada uno que quede
lleva su motivo en un comentario o es uno de los de arriba.

## R7. El mapa

**Decisión:** el estilo `https://tiles.openfreemap.org/styles/dark` en modo oscuro y `liberty` en el
claro. Al cambiar el modo, `map.setStyle()`. Los marcadores de HTML se mantienen.

**Por qué:** es el mismo servidor que ya está permitido en el CSP y no tiene costo.

**Si no responde:** se queda en el claro. El 2026-10-16 el estilo respondía (200, JSON). Falta comprobar en la implementación que
se ve bien.

## R8. Cómo se mide el contraste

**Decisión:** `scripts/check-contrast.ts` en el front, sin dependencias: importa `brand-theme.ts`.
- **Paletas:** la de Agenda360, la de cada `BRAND_PRESETS` y cuatro extremos (`#111111`, `#f5f5f5`,
  `#808080` y `#00ff00`), cada una en claro y en oscuro.
- **Contraste exigido:**
  - **4,5:1** en los textos: texto/fondo, secundario/`desk`, principal/fondo,
    texto-del-botón/principal, texto/resaltado y secundario/`secondary`;
  - **3:1** en lo que no es texto: las series de los gráficos sobre el fondo y los colores de los
    profesionales.
- **Resultado:** sale con error si alguna combinación no llega. Se corre como `npm run check:contrast`.

**Por qué:** el CE-001 se mide con números y no a ojo. Y si mañana cambia una fórmula, el script lo
avisa.

## R9. La beta

**Decisión:** copiar los archivos del front que cambian y ajustar su repositorio mock:
- las cuentas de prueba empiezan en «Automático»;
- `setThemeMode` guarda en el mock y suma su entrada en la actividad simulada;
- su `index.html` lleva `theme-boot.js`.

Como siempre, antes se guarda una copia, `beta-src-antes-019.tgz`.
