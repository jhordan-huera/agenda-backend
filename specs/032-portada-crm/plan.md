# Plan de implementación: La portada al estilo de una plataforma de ventas

**Rama**: `dev` · **Fecha**: 2026-10-22 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **Los tokens** (`front/src/index.css`):
   - **`--cta` / `--cta-foreground`:** el naranja **#c2410c** con texto blanco (5,18:1). Al pasar el ratón,
     un tono más oscuro. En el oscuro, el mismo naranja, que contrasta con el fondo.
   - **Azul y azul marino:** los de la marca, `--ink` y `--shell`.
   - **`check:contrast`** suma el par del botón.
2. **Las secciones** (`front/src/features/landing/`). Se reutiliza lo de la spec 030 que sirve:
   - `LandingNavbar`, con los enlaces nuevos y el botón naranja;
   - `HeroSection`, centrado, con los sellos y los dos botones;
   - **la vista del panel:** se reutiliza la semana del acceso (`week-sample.tsx`, pasada a algo
     compartido) dentro de un marco de ventana, con el aviso de reserva;
   - `facts-band.tsx` (nueva): los cuatro hechos reales;
   - `appointment-flow-section.tsx` (nueva): las cuatro columnas con citas de ejemplo, en la gama azul con
     el verde de «confirmado», y las tres funciones al lado. En el celular, las columnas se deslizan dentro
     de su caja;
   - `HighlightsSection`, como las seis funciones en cuadrícula;
   - `automation-section.tsx` (nueva): lo automático, con la vista del email de recordatorio;
   - `integrations-section.tsx` (nueva): las cinco, con iconos de `lucide-react`;
   - `testimonial-section.tsx` (nueva): lee una constante `TESTIMONIAL` (`null` hasta tener el permiso) y,
     sin ella, no se dibuja;
   - `FaqSection` y `CtaSection` (azul marino, con el botón naranja);
   - `LandingFooter`, con los sellos.

   Se quitan los componentes que queden sin uso.
3. **`SignupLink`** sigue igual: con el registro cerrado, «Quiero mi agenda».
4. **La beta:** la misma portada, con la copia de `src` antes, como en la 030.

**Migración:** ninguna. **Backend:** nada.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| III. Decisiones | Sí | Sin cifras, testimonios ni precios inventados. El naranja es una decisión nueva del dueño, que se anota en la constitución, 1.27.0 en los dos repos |
| VII. Diseño | Sí | Tokens, contraste 4,5:1, 390 px sin desplazamiento horizontal, foco y movimiento reducido |

## Pruebas

- **Front:** build, lint y `check:contrast`.
- **El recorrido,** en Chromium a 1440 px y WebKit a 390 px, en claro y oscuro:
  - cada sección;
  - los enlaces de alta, el de la página de reservas de ejemplo, el de iniciar sesión y el de privacidad;
  - el contacto con `?ref=` y con el registro cerrado;
  - el testimonio oculto;
  - sin desplazamiento horizontal.
- **Capturas** para que el dueño las apruebe.
- **La beta:** build y capturas.

## Publicación

Sólo el front y, aparte, la beta. Sin migración.
