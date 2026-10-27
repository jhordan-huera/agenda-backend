# Reporte final: La marca de Agenda360 en tomate

**Spec**: [spec.md](./spec.md)

**Estado**: Publicada (2026-10-22, PR backend #54 y front #40) · **Fecha**: 2026-10-22

**Repos**: agenda-front, agenda-backend (sólo lo compartido) y la beta · **Migración**: No

## Resumen

Los colores de Agenda360 pasan del azul al **tomate #c2410c**, con el **durazno #fcd9c2** de resaltado. De
ellos salen, con la fórmula de siempre (`brand-theme.ts`), el claro y el oscuro de todo el sistema.

**Cambian:**
- la portada, ya de un solo color;
- el login y el panel de los negocios y del super admin;
- los emails, el QR y los gráficos;
- el icono en todos sus tamaños.

Las paletas listas suman «Azul clásico». Los negocios con colores propios no cambian.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Los colores y la fórmula | Cumple | `check:contrast`: 47 tokens claros y 21 oscuros iguales a la fórmula, y todo legible en las 13 paletas. Lo más justo, el principal sobre el lienzo de la portada: 4,62 |
| RF-002 – Iconos, barra del navegador y emails | Cumple | Iconos rehechos desde el SVG a su tamaño exacto (32, 180, 192 y 512 px, y el maskable en la zona segura). Emails renderizados con la plantilla del backend |
| RF-003 – La portada de un solo color | Cumple | Sin los tokens `--cta`; el botón usa el principal. Al pasar el ratón: 7,82:1 en claro y 6,64:1 en oscuro |
| RF-004 – Colores propios sin cambio | Cumple | Recorrido: `/book/dental-sonrisa` en tomate; `/book/estudio-bella` con Eucalipto, sin cambio |
| RF-005 – «Azul clásico» | Cumple | Está en las paletas del negocio y del super admin |
| RF-006 – La beta | Cumple | Build, lint y `check:contrast` (47 y 23 tokens, 0 distintos). Respaldo previo |
| CE-001 – Las comprobaciones | Cumple | Front y beta sin errores; backend con `tsc` y 67 de 67 suites |
| CE-002 – Sin restos del azul | Cumple | En `dist`, `4a6cb0` sólo queda en el primer color de los profesionales, que no es de la marca y cambiarlo pediría una migración, y en «Azul clásico» |

## Cambios respecto a la spec

- **El croma base de la fórmula** (`BASE_PRIMARY_CHROMA`) no se tocó: cambiarlo movería las paletas de los negocios con colores propios.
- **Los gráficos del super admin:** «Fallidos» se confundía con el tomate. Ahora prueba rojo, luego ámbar y luego magenta. Arregla también la paleta Coral.
- **`check:contrast` coteja más cosas con la fórmula:**
  - los tokens claros;
  - los gráficos en claro;
  - la pantalla de carga, el `theme-color` y el manifiesto;
  - los colores de los emails.
- **El icono de los avisos** (`icon-badge-96.png`) no cambia: es una silueta blanca, sin color.

## Pendientes y riesgos

- **Al publicar,** pasan al tomate los 3 negocios de producción que usan los colores de Agenda360, también en
  su página de reservas. El que tiene colores propios no cambia.
- **El rojo de los errores** (`#b4453c`) tiene un tono parecido al tomate: se lee bien, pero se distingue
  menos.
- **En el oscuro,** el oscurecido general de los botones al pasar el ratón da unos 3,4:1 en todas las
  paletas, como antes. Sólo se arregló en el botón principal de la portada.
- **Los navegadores y la app instalada** pueden tardar en mostrar el icono nuevo. `ICON_VERSION` pasa a
  `tomate-1` para que se renueve.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-front | 713d0b2 | Specs 032 y 033: la portada al estilo de una plataforma de ventas y la marca de Agenda360 en tomate (iconos, colores, emails; constitución 1.28.0) |
| agenda-backend | 18befa7 | Specs 032, 033 y 034: documentos y reportes; constitución 1.28.0 |

La beta no tiene git. Su respaldo está en `~/Documentos/Proyectos/Betas/agenda-beta-respaldo-antes-de-marca-tomate-2026-10-22.tar.gz`.

## Cómo publicarlo

1. **Sin migración.** El PR del backend, con la copia compartida de los emails, y el del front.
2. **Después:** mirar la portada, el login, un panel y una página de reservas en producción.

## Texto para el PR

Spec 033: la marca de Agenda360 en tomate (#c2410c con durazno): la portada, el login, el panel, los emails y
el icono. «Azul clásico» queda en las paletas, y los negocios con colores propios no cambian.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/033-marca-tomate/reporte.md
