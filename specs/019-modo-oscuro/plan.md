# Plan de implementación: Modo oscuro en todo el sistema, con los colores de cada negocio

**Rama**: `dev` · **Fecha**: 2026-10-16 · **Spec**: [spec.md](./spec.md)

## Resumen

Cada persona elige «Claro», «Oscuro» o «Automático» en Configuración → Perfil. La elección se guarda en
su cuenta (migración 044) y llega con la sesión que el panel ya pide al entrar, sin consultas nuevas.
Cambiarla es un `PUT` y queda en la actividad.

En el front:
- **La paleta oscura** se calcula con las mismas fórmulas que la clara, a partir de los mismos dos
  colores del negocio o del super admin. Los colores de Agenda360 tienen la suya en `index.css`.
- **El modo** es la clase `dark` en `<html>`. Un archivo pequeño, `theme-boot.js`, la pone antes de que
  se pinte nada, para que no haya destello. Tiene que ser un archivo aparte porque el CSP no deja
  scripts dentro del HTML.
- **Unos 290 colores fijos** pasan a tokens o reciben su variante oscura. Siguen claros los emails, lo
  impreso, el QR, las fotos y los archivos.

## Diseño

1. **La preferencia (backend):**
   - **Migración 044:** `users.theme_mode`, con `'light' | 'dark' | 'auto'`, por defecto `'auto'` y un
     check. Las cuentas que ya existen quedan en `'auto'` con la propia migración (decisión del
     dueño).
   - **La sesión:** `GET /auth/session` suma `themeMode`. Se lee en la consulta de la sesión que ya se
     hace en cada petición (`u.theme_mode`), así que no hay ninguna consulta nueva.
   - **`PUT /auth/theme-mode` `{ mode }` → `{ mode }`:**
     - cambia sólo la cuenta de quien lo pide;
     - si el modo es el mismo, no hace nada;
     - deja una entrada en la actividad: `user.theme_mode_changed`, tipo `user`, «Cambió el modo de
       pantalla de «Automático» a «Oscuro»». Va en la actividad de su negocio, o en la de la
       plataforma si es super admin, igual que los avisos al celular de la spec 013.
   - **El contrato** está en [contracts/theme-mode.md](./contracts/theme-mode.md).
2. **El código compartido**, que se edita en el front y se copia con `sync:shared`:
   - `ThemeMode` y `Session.themeMode` en `types/index.ts`;
   - `THEME_MODE_LABELS` (Claro, Oscuro, Automático) en `lib/constants/app.ts`;
   - `themeModeSchema` en `lib/validations/auth.ts`.
3. **Sin destello al abrir** (R2):
   - **`public/theme-boot.js`,** sin `async`, en el `<head>` de `index.html`, antes del CSS:
     - lee la última elección de ese aparato (`localStorage`, con `try/catch`) o el modo del aparato;
     - pone `dark` en `<html>` y ajusta `<meta name="theme-color">`.
   - **En las páginas de los pacientes** (`/book/`, `/pago/`, `/cita/`) sólo mira el modo del aparato.
   - **La pantalla de carga de `index.html`** suma sus colores oscuros con `html.dark .boot-loader`.
4. **El modo en marcha** (R3):
   - **`ThemeModeProvider`**, en `providers.tsx`:
     - aplica el modo de la sesión, o el de la última elección o el del aparato antes de iniciar sesión;
     - escucha `matchMedia('(prefers-color-scheme: dark)')` para «Automático»;
     - guarda la última elección en el aparato;
     - expone `useThemeMode()`.
   - **En las páginas de los pacientes** fuerza el modo del aparato.
5. **La paleta oscura** (R4): `resolveBrandPalette(colors)` devuelve `{ light, dark }`.
   - **La oscura:**
     - fondos con claridad de 0,17 a 0,26 y un toque del tono principal;
     - texto a 0,93;
     - el principal aclarado hasta 4,5:1 sobre el fondo, con el texto de los botones oscuro;
     - el resaltado oscurecido para que el texto claro se lea encima;
     - los gráficos con su rejilla y sus ejes oscuros.
   - **`brandThemeVariables`** sirve para las dos.
   - **`BrandThemeProvider`** deja de poner las variables en `<html>` una por una. Inyecta un `<style>`
     con `:root { claras }` y `@media screen { :root.dark { oscuras } }`. Así cambiar de modo es sólo
     cambiar la clase, y al imprimir siempre salen las claras (R5).
   - **Los colores de Agenda360** tienen su bloque `.dark` en `index.css`, sacado de la misma fórmula.
6. **Impresión siempre clara** (R5):
   - la variante `dark` pasa a ser `@media screen` + `.dark`;
   - los tokens oscuros también van dentro de `@media screen`;
   - el reporte impreso (`report-print-document`) no cambia.
7. **Los colores fijos** (R6), por grupos:
   - **`bg-white` y `text-white`:** pasan a tokens (`bg-card`, `bg-background`,
     `text-primary-foreground`…). Quedan blancos a propósito el QR y la placa del logo.
   - **Estados de las citas y avisos** (`appointment-status.ts` y los avisos de éxito, alerta y error):
     reciben su variante `dark:`, con fondo translúcido y texto claro del mismo color.
   - **Colores de cada profesional** (`professionals/colors.ts`): una versión para fondo oscuro con la
     misma fórmula, que los mantiene distinguibles.
   - **Gráficos** (`chart-colors.ts`, `admin-chart-colors.ts`): salen de la paleta del modo.
   - **Odontograma y mapa del cuerpo:** los trazos toman el color del texto. Los colores de cada estado
     del diente o de cada zona se ajustan para fondo oscuro, sin cambiar lo que significan.
   - **La portada** (`how-it-works-section`): sus dibujos, con tokens.
   - **El ícono de WhatsApp:** conserva su verde.
8. **Terceros:**
   - **El mapa de MapLibre:** el estilo `dark` de OpenFreeMap en modo oscuro, cambiado con `setStyle`
     al cambiar el modo (R7). El mismo servidor ya está permitido en el CSP.
   - **Los avisos (Sonner) y el CAPTCHA (Turnstile):** con el `theme` del modo.
9. **Logos:** en modo oscuro, cada logo del negocio va sobre una placa clara redondeada
   (`dark:bg-white dark:p-1`), para que un logo oscuro no desaparezca.
10. **La sección «Modo de pantalla»** (`features/settings/theme-mode-card.tsx`):
    - va en Configuración → Perfil del panel y en Configuración de /admin;
    - tiene tres opciones con su dibujo;
    - el cambio es optimista (se ve al instante) y vuelve atrás si falla.

    La vista previa de colores (`brand-colors-picker`) muestra lado a lado el claro y el oscuro.
11. **La beta:**
    - los mismos archivos del front;
    - en su repositorio mock, `themeMode` en las cuentas de prueba (empieza en «Automático») y
      `setThemeMode` en su actividad simulada;
    - `theme-boot.js` y la pantalla de carga en su `index.html`.
12. **Constitución 1.16.0** (MENOR): el principio VII cambia «Estilo SaaS claro» por:
    > Dos modos, claro y oscuro: cada persona elige el suyo en su cuenta (Claro, Oscuro o Automático,
    > por defecto Automático) y las páginas de los pacientes siguen a su aparato. Los dos salen de los
    > mismos colores del negocio o del super admin, con contraste AA. Los emails, lo impreso, el QR y
    > los archivos siguen claros (2026-10-16).

    Y donde dice «no se fijan colores que ignoren la marca», suma «ni el modo».

## Contexto técnico

- **Lenguaje:** TypeScript, React 19, Tailwind 4. La variante `dark` ya está declarada pero sin usar.
- **Dependencias:** ninguna nueva.
- **Migración 044:** `users.theme_mode`.
- **Variables nuevas:** ninguna.
- **Restricciones:**
  - la CPU de Vercel: ninguna petición nueva al cargar, y `theme-boot.js` es un archivo estático de la
    CDN;
  - el CSP: `script-src 'self'`, así que nada de scripts dentro del HTML;
  - 390 px;
  - contraste AA.
- **Pruebas:**
  - la suite nueva `tests/theme-mode.test.ts`;
  - `npm run check:contrast` en el front, nuevo y sin dependencias: mide el contraste de las paletas;
  - el recorrido del quickstart en los dos modos.

## Comprobación contra la constitución (1.15.0 → 1.16.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | «Modo de pantalla», sus opciones y la actividad, en español. |
| II. Privacidad | Sí | Sólo se guarda una preferencia de la persona. Ningún dato de pacientes. |
| III. Decisiones | Sí | Las cuatro del dueño, tal cual. Los colores de cada super admin siguen siendo sólo suyos. Los negocios siguen sin ver planes ni precios. |
| IV. Local | Sí | Las pruebas, el script de contraste y el recorrido, en local. Nada en Vercel. |
| V. Compartido | Sí | El tipo, las etiquetas y la validación se editan en el front y se copian con `sync:shared`. |
| VI. Barato | Sí | Sin dependencias. El modo viaja con la sesión que ya se pide. |
| VII. Diseño | Sí, con el cambio | El principio pasa a decir claro y oscuro, desde los tokens, con contraste AA y probado a 390 px. |
| Auditar todo (1.9.0) | Sí | Cambiar el modo va a la actividad, con su prueba. Mirar el modo no. |
| Restricciones | Sí | La migración 044 va antes del backend. El CSP no cambia. |

## Estructura

```text
agenda-backend
  .specify/memory/constitution.md          1.16.0
  db/migrations/044_theme_mode.sql         NUEVO
  src/services/auth-service.ts             themeMode en la sesión; setThemeMode con la auditoría
  src/routes/auth-routes.ts                PUT /auth/theme-mode
  src/shared/*                             sync:shared (tipo, etiquetas y validación)
  tests/theme-mode.test.ts                 NUEVO
  README.md                                el modo de pantalla

agenda-front
  .specify/memory/constitution.md          1.16.0
  index.html, public/theme-boot.js (NUEVO)  sin destello; la pantalla de carga oscura
  src/index.css                            variante dark sólo en pantalla; los tokens oscuros de Agenda360
  src/lib/brand-theme.ts                   la paleta oscura (light y dark)
  src/features/branding/*                  BrandThemeProvider con <style>; la vista previa en los dos modos
  src/features/theme/ (NUEVO)              ThemeModeProvider, useThemeMode
  src/features/settings/theme-mode-card.tsx (NUEVO)   en Perfil y en /admin → Configuración
  src/lib/data/*, src/hooks/queries/*      setThemeMode
  src/types, src/lib/constants/app.ts, src/lib/validations/auth.ts   compartido
  los ~290 colores fijos                   ver R6
  scripts/check-contrast.ts (NUEVO)        npm run check:contrast
  README.md

agenda-beta                                los mismos archivos del front, el mock y su index.html
```

## Pruebas

**Backend** (`tests/theme-mode.test.ts`, nueva):
- una cuenta que ya existía y una nueva empiezan en `auto`;
- cambiar el modo se ve en `GET /auth/session`, también desde otra sesión de la misma persona;
- no cambia el modo de otra persona;
- un valor que no existe responde 400 y sin sesión, 401;
- la entrada en la actividad:
  - el propietario y el rol Profesional, en la de su negocio;
  - el super admin, en la de la plataforma;
  - con el modo anterior y el nuevo;
- el mismo modo dos veces no deja una segunda entrada.

**Front:**
- `npm run build`, `npm run lint` y `npm run check:contrast`;
- el recorrido del [quickstart](./quickstart.md):
  - cada pantalla en los dos modos, a 1440 y a 390 px (Chromium y WebKit);
  - sin destello;
  - «Automático» con el aparato simulado en oscuro y en claro;
  - las páginas de los pacientes;
  - la impresión;
  - el modo soporte.

**Beta:** build, lint y su recorrido.

## Publicación

1. **Constitución 1.16.0,** al aprobar este plan, en los dos repos.
2. **La migración 044,** como paso aparte:

   ```
   npm run db:migrate
   ```

3. **Primero el PR del backend y después el del front.** El front tolera una sesión sin `themeMode` y
   la toma como «Automático», así que el orden no rompe nada.
4. **Avisar a los negocios** con el mensaje del reporte: quien tenga su aparato en modo oscuro verá el
   cambio.

## Riesgos

- **Son muchos archivos de un tipo de cambio visual.** Se mitiga con el recorrido con capturas de cada
  pantalla en los dos modos y con el script de contraste.
- **El estilo oscuro del mapa** depende de OpenFreeMap. Si no responde, se usa el claro.
- **Un aparato con «Automático»** que cambia de modo a mitad de una sesión cambia al instante. Es lo
  esperado.

## Decisiones del dueño del producto (2026-10-16)

1. **En la cuenta:** Claro, Oscuro o Automático, igual en todos los equipos.
2. **Todos empiezan en «Automático»,** también los usuarios que ya existen.
3. **Las páginas de los pacientes siguen a su celular.**
4. **Los colores del negocio se ajustan solos.**
5. **La spec,** aprobada el 2026-10-16 («si»):
   - la beta incluida;
   - siguen claros los emails, lo impreso, el QR y los archivos;
   - el logo va sobre una placa clara.
