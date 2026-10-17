# Reporte final: Modo oscuro en todo el sistema, con los colores de cada negocio

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-16

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `044_theme_mode.sql`

## Resumen

**Cómo se elige el modo:**
- Cada persona lo elige en Configuración → Perfil, y el super admin en la Configuración de /admin.
- Hay tres opciones: «Claro», «Oscuro» y «Automático», que sigue al celular o la computadora. Todos
  empiezan en «Automático».
- La elección se guarda en la cuenta, se ve igual en cualquier equipo y queda en la actividad.

**Qué se ve en oscuro:**
- Todo el sistema: el panel, /admin, las páginas de los pacientes, la portada y el login.
- Con los mismos colores de cada negocio, ajustados solos para que todo se lea.
- Las páginas de los pacientes siguen al celular del paciente.
- No hay destello blanco al abrir.

**Lo que sigue claro:** los emails, lo impreso, el QR y la placa del logo.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Elegir el modo en la cuenta | P1 | Hecha | En Perfil y en /admin → Configuración; optimista, vuelve atrás si falla |
| H2 – Todo el sistema en oscuro, con los colores del negocio | P1 | Hecha | Paleta oscura calculada de los mismos dos colores; vista previa en los dos modos |
| H3 – Pacientes y pantallas antes de iniciar sesión | P1 | Hecha | Reservas, pago y cita siguen al aparato; el mapa, en su estilo oscuro |
| H4 – Sin destellos al abrir | P2 | Hecha | `theme-boot.js` antes de pintar; la pantalla de carga y el `theme-color`, oscuros |

## Comprobación

Todo en local: las bases desechables de `npm test` y bases de prueba con los datos demo. Todo
ficticio.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Elegir el modo en Perfil, guardado en la cuenta | Cumple | `theme-mode` (27 comprobaciones). Recorrido final: «Oscuro» se ve en 42 ms y `GET /auth/session` lo devuelve |
| RF-002 – Todos empiezan en «Automático» | Cumple | `theme-mode`: una cuenta de los datos demo, la 044 aplicada de nuevo sobre ellas y una cuenta nueva |
| RF-003 – Al instante y en el otro aparato | Cumple | Recorrido: otra sesión en WebKit, con el aparato en claro, ve el panel oscuro |
| RF-004 – En la actividad, con el modo anterior y el nuevo | Cumple | `theme-mode` y recorrido: «Cambió el modo de pantalla de «Automático» a «Oscuro»». El negocio, en su actividad; el super admin, en la de la plataforma (alcance «Todo») |
| RF-005 – Todas las pantallas oscuras | Cumple | 3 recorridos por área (158, 192 y 164+ capturas) y el final con la API real (36 de 36 pantallas, 242 capturas): sin zonas blancas de sobra ni textos ilegibles |
| RF-006 – Los mismos colores, ajustados solos | Cumple | Recorrido con Rosa, Coral, Eucalipto y `#111111`: con Coral, el tono es el mismo (11°) en el principal y en los gráficos |
| RF-007 – Contraste en los dos modos | Cumple | `npm run check:contrast`: 12 paletas en claro y en oscuro, todas sobre 4,5:1 en textos y 3:1 en lo demás |
| RF-008 – Estados, avisos y colores de profesionales distinguibles | Cumple | Las capturas de los estados lado a lado. Los 8 colores de los profesionales, sobre 3:1 en los dos modos (de 3,31 a 5,37) |
| RF-009 – La vista previa en los dos modos | Cumple | Recorrido: en Colores y en «Colores del panel» |
| RF-010 – Pacientes y antes de iniciar sesión | Cumple | Recorrido: 92 de 92 en reservas reales, pago y cita, también con el modo contrario guardado en el aparato |
| RF-011 – Sin destello y el color de la barra | Cumple | 32 de 32. Capturas desde los 20 ms sin blanco; `theme-color` `#15181f` antes de la app |
| RF-012 – El modo soporte | Cumple | 13 de 13: el super admin en oscuro ve Centro Profesional oscuro con sus colores |
| RF-013 – La beta | Cumple | Build, lint, contraste y su recorrido: arranque 28/28, modo 23/23 y pantallas 86/88. Las 2 que fallaron son la vista previa clara, que es blanca a propósito |
| CE-001 – Contraste medido en las pantallas principales | Cumple | `check:contrast` y las capturas de cada pantalla con las paletas y los extremos |
| CE-002 – Ninguna zona blanca ni texto ilegible | Cumple | Revisión a ojo de todas las capturas en oscuro |
| CE-003 – El cambio, en menos de un segundo | Cumple (medido: 42 a 65 ms) | Recorrido del front y de la beta |
| CE-004 – Sin destello blanco | Cumple | Capturas tempranas a los 20, 80 y 600 ms |
| CE-005 – Pruebas y 390 px | Cumple | Ver abajo. A 390 px no hay desplazamiento horizontal en ninguna captura, en los dos modos |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test`: 58 de 58 suites,
  con 2457 comprobaciones y ninguna fallida. La suite `theme-mode` es nueva, con 27.
- **Front:** `npm run build` y `npm run lint` sin errores ni avisos. `npm run check:contrast`, con
  código 0.
- **Consola del navegador:** 0 errores de JavaScript en todo el recorrido final.

## Cambios respecto al plan

- **El formato de la actividad.** `changes` usa `{ label, before, after }`, el formato que ya lee la
  actividad. Además, el modo anterior se lee dentro de la transacción con `for update`, para que dos
  cambios a la vez queden bien registrados.
- **`setThemeMode` va en el servicio de autenticación del front,** junto a `changePassword`. La
  sesión vive en `SessionProvider`, que tiene un `updateSession` nuevo.
- **Tokens nuevos `--hero`, `--hero-end` y `--hero-foreground`** para los degradados con texto:
  login, portada, la tarjeta «Tu siguiente cita» y la ficha del negocio en /admin. En el claro son
  idénticos a lo de antes.
- **Ajustes de la paleta oscura:**
  - el resaltado también llega a 3:1 con el principal, por la hora actual de la agenda;
  - el principal se ajusta contra lo activo del menú;
  - el croma tiene un tope, para que un color chillón no brille.
- **La variante `dark`** es sólo de pantalla y no se aplica dentro de un contenedor `.light`, el de la
  vista previa clara.
- **`professionalColor(color, mode)`** recibe el hex guardado, no un índice, porque así se guarda el
  color de cada profesional.
- **En las páginas de los pacientes,** el fondo es `bg-canvas` en el oscuro, para que las tarjetas no
  se vean hundidas.
- **El mapa:** `useMapTheme` cambia sólo el estilo y mantiene el pin y la vista. Si el estilo oscuro
  falla, vuelve al claro.
- **Errores que se encontraron y se arreglaron de paso:**
  - el QR descargado desde el oscuro salía ilegible, y ahora usa siempre la paleta clara;
  - la ficha de la cita no marcaba el estado actual en oscuro;
  - a 390 px desaparecían los puntos de «Cambiar estado», también en el claro;
  - la fila de botones de la impresión clínica se salía 9 px a 390 px.
- **La beta** no tenía el rediseño SaaS del front, así que se llevó el modo oscuro adaptado a su
  diseño, con su menú en «bruma». No se llevaron 17 archivos de funciones que la beta no tiene.
- **Un cambio mínimo en el claro:** el pie de la portada, la cifra de hoy en «Esta semana» y el
  logo `inverse` pasan de `#fff` a `#eef1f8`.

## Pendientes y riesgos

- **Al publicarse,** quien tenga su aparato en modo oscuro verá el sistema oscuro sin haberlo pedido.
  Conviene avisar a los negocios con el mensaje de abajo.
- **Sin comprobar:**
  - un celular real y la barra de la app instalada (sólo se comprobó el `theme-color`);
  - el CAPTCHA con las claves reales;
  - la CSP real de Vercel (se simuló en el preview y no hubo ninguna violación);
  - cómo se ve un email en un cliente de correo en modo oscuro.
- **Android:** al abrir la app instalada puede verse un instante blanco, porque el
  `background_color` del manifiesto es fijo y no depende del modo.
- **En /admin → Actividad,** el cambio de modo del super admin sale en «Todo» y no en «Super
  admin». Pasa igual con los avisos al celular (spec 013).
- **Problemas que ya existían, también en el claro, y que no se tocaron:**
  - «Ver comprobante» se sale de la ficha de la cita a 390 px (`appointment-payment.tsx:94`);
  - un logo ancho se recorta a un cuadrado en la cabecera del reporte impreso y en la ficha del
    negocio de /admin;
  - en Horarios, los campos de hora salen cortados en Chromium en inglés;
  - el botón «Descargar para imprimir (PNG)» del QR se sale un poco a 1440 px;
  - con la paleta Rosa, «Enviados» y «Fallidos» del gráfico de emails tienen casi el mismo tono.

## Mensaje sugerido para los negocios

> Agenda360 ya tiene modo oscuro. Si tu celular o tu computadora están en modo oscuro, verás el
> panel oscuro, con los colores de tu negocio. Puedes elegir cómo verlo en Configuración → Perfil →
> «Modo de pantalla»: Claro, Oscuro o Automático (como tu aparato). Tus pacientes verán tu página de
> reservas como tengan su celular. Si tienen alguna duda, escríbanme y con gusto les ayudo.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | b27a2cf | Spec 019: modo oscuro (spec, plan, tareas y constitución 1.16.0) |
| agenda-front | c6a9a66 | Constitución 1.16.0: el modo oscuro (spec 019) |
| agenda-backend | (el de esta entrega) | Spec 019: modo oscuro (backend) y reporte |
| agenda-front | (el de esta entrega) | Spec 019: modo oscuro (front) |

La beta queda actualizada en su carpeta, con la copia previa `beta-src-antes-019.tgz`.

## Cómo publicarlo

1. **La migración 044, como paso aparte,** antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.** El front toma como «Automático» una sesión
   que no trae el modo, así que el orden no rompe nada. Entra también el cambio de los emails a 30
   días, que ya estaba en `dev`.
3. **Después:**
   - comprobar que `/api/health` responde `"ok":true`;
   - abrir el panel con el aparato en oscuro y ver que se ve oscuro;
   - mandar el mensaje a los negocios.

## Texto para el PR

Spec 019: modo oscuro en todo el sistema, con los colores de cada negocio.
- Cada persona elige «Claro», «Oscuro» o «Automático» en Configuración → Perfil. Se guarda en la
  cuenta (`PUT /auth/theme-mode`) y queda en la actividad. Todos empiezan en «Automático».
- Las páginas de los pacientes siguen a su aparato.
- La paleta oscura sale de los mismos colores del negocio, con contraste AA medido
  (`npm run check:contrast`).
- No hay destello al abrir.
- Siguen claros los emails, lo impreso y el QR.

**Migración:** `044_theme_mode.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/019-modo-oscuro/reporte.md
