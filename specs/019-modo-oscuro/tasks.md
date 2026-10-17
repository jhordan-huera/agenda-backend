---

description: "Tareas de «Modo oscuro en todo el sistema, con los colores de cada negocio»"
---

# Tareas: Modo oscuro en todo el sistema

**Entrada**: `specs/019-modo-oscuro/`. El dueño del producto aprobó la spec y el plan el 2026-10-16
(«si» y «si»).

**Pruebas:**
- **Backend:** `tests/theme-mode.test.ts`, nueva (quickstart §1).
- **Front:** `npm run check:contrast`, nuevo (quickstart §2), y el recorrido del quickstart §3.
- **Beta:** build, lint y el recorrido corto (quickstart §4).

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front y `beta/` =
~/Documentos/Proyectos/Betas/agenda-beta. Las decisiones R1–R9 están en `research.md`.

**Regla del barrido de colores (R6):**
- Una superficie blanca pasa a token (`bg-card`, `bg-background`, `bg-popover`).
- El texto blanco sobre el principal pasa a `text-primary-foreground`.
- Las paletas fijas de estado reciben su `dark:`: fondo del mismo color al 15 %, texto 300, borde
  500/40.
- Quedan como están, a propósito: el QR, la placa del logo, el verde de WhatsApp, los emails
  (`lib/email/*`) y lo impreso.

## Fase 1: Base

- [x] T001 Constitución 1.16.0 en `back/.specify/memory/constitution.md` y
  `front/.specify/memory/constitution.md` (deben quedar iguales):
  - el principio VII con el texto del plan (dos modos, desde los tokens y con contraste AA; los
    emails, lo impreso, el QR y los archivos siguen claros);
  - «ni el modo» en «no se fijan colores que ignoren la marca»;
  - la versión y la fecha (2026-10-16).
- [ ] T002 `back/db/migrations/044_theme_mode.sql`:
  `alter table users add column theme_mode text not null default 'auto' constraint
  users_theme_mode_check check (theme_mode in ('light', 'dark', 'auto'))`, con el comentario de la
  spec 019. Sin `update`: el `default` deja en `'auto'` las cuentas que ya existen.
- [ ] T003 El código compartido en `front/src`:
  - `types/index.ts`: `ThemeMode = "light" | "dark" | "auto"` y `Session.themeMode: ThemeMode`;
  - `lib/constants/app.ts`: `THEME_MODE_LABELS`, con «Claro», «Oscuro» y «Automático»;
  - `lib/validations/auth.ts`: `themeModeSchema = z.object({ mode: z.enum(["light", "dark", "auto"]) })`.

  Después, `npm run sync:shared` en `back/`.

## Fase 2: Fundamentos (bloquean las historias)

- [ ] T004 `front/src/lib/brand-theme.ts`: `resolveBrandPalette(colors)` devuelve `{ light, dark }`
  (R4).
  - `light` es exactamente la de hoy.
  - `dark` sale de las mismas funciones, con las claridades de la tabla de R4 y sus ajustes de
    contraste: 4,5:1 en los textos y 3:1 en las series de los gráficos.
  - `brandThemeVariables(palette)` sirve para las dos.
  - Se actualizan sus usos: `brand-palette-context.ts` (`useChartColors()` según el modo) y
    `brand-colors-picker.tsx`.
- [ ] T005 `front/src/index.css` (R5):
  - `@custom-variant dark { @media screen { &:where(.dark, .dark *) { @slot; } } }`;
  - el bloque `@media screen { :root.dark { … } }` con los tokens oscuros de Agenda360, sacados de
    `resolveBrandPalette(DEFAULT_BRAND_COLORS).dark`, con un comentario que lo diga;
  - `color-scheme: light` / `dark` en `:root` y `:root.dark`, para las barras de desplazamiento y los
    controles nativos.
- [ ] T006 `front/src/features/branding/brand-theme-provider.tsx`:
  - en vez de `style.setProperty` en `<html>`, inyecta y quita un `<style data-brand-theme>` con
    `:root { claras }` y `@media screen { :root.dark { oscuras } }` (R5);
  - sin colores propios no inyecta nada.
- [ ] T007 `front/src/features/theme/` (nuevo), con `theme-mode-provider.tsx`, `use-theme-mode.ts` y
  `theme-mode.ts` (R3):
  - **la constante** `THEME_STORAGE_KEY = "agenda360:modo-pantalla"`;
  - **`resolveMode(mode, prefersDark)`;**
  - **el proveedor:**
    - toma el modo de la sesión; sin sesión, el del aparato (`localStorage` con `try/catch`) o
      `"auto"`;
    - en las rutas `/book/`, `/pago/` y `/cita/`, siempre el modo del aparato;
    - pone o quita `dark` en `<html>`;
    - actualiza `<meta name="theme-color">` con el `--background` del modo;
    - escucha `matchMedia('(prefers-color-scheme: dark)')`;
    - guarda la última elección.
  - **`useThemeMode()`** devuelve `{ mode, resolved, setMode }`.
  - **Va en** `front/src/app/providers.tsx`, que además pasa `theme={resolved}` a `<Toaster>`.
- [ ] T008 `front/public/theme-boot.js` (nuevo) e `front/index.html` (R2):
  - **el script:** menos de 1 KB, sin dependencias, la misma regla que `resolveMode` y las rutas de
    pacientes, con `try/catch`;
  - **en `index.html`:**
    - el `<script src="/theme-boot.js"></script>` sin `async`, en el `<head>`, antes de los estilos;
    - `html.dark .boot-loader { … }` con los colores oscuros en el `<style>` de la pantalla de carga;
    - el `theme-color` inicial.
  - **El CSP de `vercel.json` no cambia.**
- [ ] T009 `front/scripts/check-contrast.ts` (nuevo) y `"check:contrast"` en `front/package.json`
  (R8):
  - importa `brand-theme.ts`;
  - mide Agenda360, cada `BRAND_PRESETS` y `#111111`, `#f5f5f5`, `#808080` y `#00ff00`, en claro y en
    oscuro, con los pares de R8;
  - muestra una tabla y sale con código 1 si algo no llega.

## Fase 3: Historia 1, elegir el modo en la cuenta (P1)

**Prueba independiente:** quickstart §1 y §3.2.

- [ ] T010 [US1] `back/src/services/auth-service.ts`:
  - `u.theme_mode as "themeMode"` en la consulta de la sesión (el CTE `found`) y `themeMode` en
    `Session` (`resolveSession`), sin consultas nuevas;
  - **`setThemeMode(ctx, input)`:**
    - `requireUser` y `themeModeSchema`;
    - si es el mismo modo, devuelve sin escribir;
    - si no, en una transacción, el `update` y `logAudit`:
      - `action: "user.theme_mode_changed"`, `entityType: "user"`, `entityId` su id;
      - `businessId`: su negocio, o `null` si es super admin;
      - actor «Nombre» o «Nombre (Super admin)», como en `push-device-service.ts`;
      - summary «Cambió el modo de pantalla de «X» a «Y»», con `THEME_MODE_LABELS`;
      - `changes` `[{ field: "Modo de pantalla", from, to }]`.
- [ ] T011 [US1] `back/src/routes/auth-routes.ts`: `PUT /theme-mode` →
  `authService.setThemeMode(req.ctx, req.body)`, según `contracts/theme-mode.md`. Sin la barrera de la
  verificación en dos pasos.
- [ ] T012 [P] [US1] `back/tests/theme-mode.test.ts` (nueva): lo de «Pruebas» del plan.
  - Incluye una cuenta creada antes de la migración que queda en `auto`, por la base de prueba con la
    044 ya aplicada sobre los datos demo.
  - En `back/src/db/seed.ts`, nada: la columna tiene su `default`.
- [ ] T013 [US1] `front/src/lib/data/repository.ts`, `api-repository.ts` y `src/hooks/queries/`:
  - `setThemeMode(mode)` y su mutación optimista: actualiza la sesión en la caché y vuelve atrás si
    falla, con un aviso;
  - una sesión sin `themeMode` se toma como `"auto"`.
- [ ] T014 [US1] `front/src/features/settings/theme-mode-card.tsx` (nuevo):
  - «Modo de pantalla» con tres opciones («Claro», «Oscuro» y «Automático, como tu aparato»), cada
    una con su dibujo, accesibles con teclado y lector de pantalla;
  - va en Configuración → Perfil (`settings-page.tsx`, la pestaña que ve cada rol) y en la
    Configuración de /admin, junto a `panel-colors-card.tsx`.

## Fase 4: Historia 2, todo el sistema en oscuro (P1)

**Prueba independiente:** quickstart §3.3, §3.4 y §3.7. Las tareas del barrido son [P]: tocan
archivos distintos.

- [ ] T015 [P] [US2] Componentes base: `front/src/components/ui/*`, `components/layout/*` y
  `components/shared/*`:
  - el barrido de R6;
  - la placa del logo del negocio, `dark:bg-white dark:p-1 rounded`, donde se muestre;
  - el `offline-banner` y el `FullPageLoader`.
- [ ] T016 [P] [US2] Panel, agenda y estados:
  - `front/src/lib/constants/appointment-status.ts` (compartido: después, `sync:shared`), con el
    `dark:` de los `badge`, `dot` y `event` de cada estado;
  - `features/professionals/colors.ts`: `professionalColor(index, mode)`, de R6, y sus usos en la
    agenda;
  - el barrido de R6 en `features/appointments`, `dashboard`, `clients`, `settings`, `notices`,
    `push`, `payments`, `billing` y `pages/dashboard/*`.
- [ ] T017 [P] [US2] Clínica: `front/src/features/clinical/*`.
  - En el odontograma (`odontogram.tsx`, `odontogram-labels.ts`) y el mapa del cuerpo
    (`body-map.tsx`), los trazos y el texto con `currentColor`, y cada estado con su versión para
    fondo oscuro.
  - En `questionnaire.tsx` y `clinical-note-content.tsx`, su impresión queda clara.
- [ ] T018 [P] [US2] Reportes y gráficos: `front/src/features/reports/*`.
  - `chart-colors.ts` con la versión oscura de Agenda360, y los gráficos con `useChartColors()`.
  - `report-print-document.tsx` no cambia: comprobar que sale claro.
- [ ] T019 [P] [US2] /admin: `front/src/features/admin/*` y `pages/admin/*`.
  - `admin-chart-colors.ts` toma los colores del modo.
  - Entran la analítica, la salud y la ficha del negocio.
- [ ] T020 [US2] Vista previa: `front/src/features/branding/brand-colors-picker.tsx` y
  `features/settings/brand-colors-settings.tsx`. Muestran lado a lado «Claro» y «Oscuro»: el oscuro,
  en un contenedor con `class="dark"` y las variables de `palette.dark`. Depende de T004.

## Fase 5: Historia 3, pacientes y antes de iniciar sesión (P1)

**Prueba independiente:** quickstart §3.5 y §3.6.

- [ ] T021 [P] [US3] Páginas de los pacientes: `front/src/pages/booking-page.tsx`, `payment-page.tsx`
  y `appointment-page.tsx`, y `features/booking/*`.
  - El barrido de R6 y la placa del logo.
  - El CAPTCHA (`use-captcha.ts`) con `theme` del modo.
  - Siguen al aparato, por la regla de T007 y T008.
- [ ] T022 [P] [US3] Antes de iniciar sesión: `front/src/features/landing/*`
  (`how-it-works-section.tsx` con tokens), `features/auth/*` y `pages/privacy-page.tsx`.
- [ ] T023 [US3] El mapa: `front/src/components/shared/map-base.ts` y sus usos.
  - `MAP_STYLE_URLS = { light: …/liberty, dark: …/dark }`, según el modo.
  - `map.setStyle()` al cambiar de modo; si el estilo oscuro falla, el claro.
  - Comprobar que los marcadores siguen.

## Fase 6: Historia 4, sin destellos al abrir (P2)

**Prueba independiente:** quickstart §3.1.

- [ ] T024 [US4] Revisar juntos T007 y T008:
  - `theme-boot.js` y el proveedor deciden lo mismo en cada caso (con sesión, sin ella, en las
    páginas de pacientes y con «Automático»);
  - el `FullPageLoader` sale oscuro desde el primer instante;
  - el `theme-color` cambia al cambiar de modo.

## Fase 7: La beta

- [ ] T025 Copia previa en el scratchpad (`beta-src-antes-019.tgz`). Después, en `beta/`:
  - los archivos del front de T003–T009 y T013–T024, adaptados a la beta;
  - el repositorio mock: `themeMode: "auto"` en sus cuentas de prueba, y `setThemeMode` que guarda y
    suma su entrada en la actividad simulada;
  - `beta/index.html` y `beta/public/theme-boot.js`.
- [ ] T026 `beta/`: `npm run build`, `npm run lint` y el recorrido corto del quickstart §4, en el
  3199, detenido por PID.

## Fase 8: Cierre

- [ ] T027 Revisión del barrido: `grep` de `bg-white`, `text-white`, `-black`, las paletas fijas sin
  `dark:` y los hex en `front/src`. Cada uno que quede es de los de la regla (QR, logo, WhatsApp,
  emails, impreso) o lleva un comentario con su motivo.
- [ ] T028 [P] READMEs del backend y del front: el modo de pantalla, `PUT /auth/theme-mode`,
  `theme-boot.js` y `npm run check:contrast`.
- [ ] T029 Comprobación:
  - `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`, todas las suites;
  - `front/`: `npm run build`, `npm run lint` y `npm run check:contrast`;
  - el recorrido del quickstart §3:
    - escritorio con Chromium y 390 px con WebKit, en los dos modos;
    - la API en el 4180, el preview en el 5199 y PostgreSQL en el 54400, detenidos por PID;
    - nunca los puertos 4000, 5173 ni 3000;
    - las capturas en el scratchpad.
- [ ] T030 Cierre:
  - `reporte.md`, con el mensaje para avisar a los negocios;
  - el estado de la spec;
  - los commits sin firma de IA.

## Dependencias

- T001 primero.
- T002 y T003 → T010, T011, T012 y T013.
- T004 → T005, T006, T009 y T020.
- T005, T006, T007 y T008 → las fases 4, 5 y 6.
- T013 → T014.
- Dentro de la fase 4, T015–T019 en paralelo; dentro de la fase 5, T021 y T022 en paralelo.
- T016 vuelve a correr `sync:shared` (appointment-status.ts es compartido).
- La beta (T025–T026) después del front.
- T027–T030 al final.

## En paralelo

- **El backend (T010–T012)** puede ir mientras se hacen los fundamentos del front (T004–T009).
- **El barrido** se reparte en seis frentes:
  - T015, componentes;
  - T016, panel;
  - T017, clínica;
  - T018, reportes;
  - T019, /admin;
  - T021 y T022, páginas públicas y portada.

## Estrategia

1. **MVP:** las fases 1–3 y los componentes base (T015). Con eso ya se elige el modo y el armazón del
   panel se ve oscuro.
2. **Después,** el resto del barrido (T016–T023) y la revisión del arranque (T024).
3. **Al final,** la beta y el cierre: no se publica nada a medias. La publicación va en una sola
   tanda, con la migración 044 primero.
