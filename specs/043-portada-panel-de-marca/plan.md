# Plan de implementación: Portada nueva «Panel de marca»

**Rama**: `dev` · **Fecha**: 2026-11-11 · **Spec**: [spec.md](./spec.md)

**Sin migración ni cambios en el backend.** Todo es del front: la portada, sus piezas, las páginas por especialidad
y las fuentes. La vista previa aprobada ([prototipo](./prototipo/panel-de-marca.html)) es la referencia de
medidas, colores y textos.

## Diseño

1. **Las fuentes:**
   - **Entra** una sola familia, Schibsted Grotesk (`@fontsource-variable/schibsted-grotesk`, en el propio sitio,
     sin pedirla a Google).
   - **Salen** Archivo, Geist Mono e Instrument Serif. Sólo las usan la portada y las páginas por especialidad.
   - `--font-display` reemplaza a `--font-wide`, `--font-tech` y `--font-accent` en `src/index.css`.
   - El panel no cambia: sigue con Sora.

2. **Los colores:** sólo los tokens de la marca que ya existen. Funcionan en claro y en oscuro, y los revisa
   `check:contrast`.
   - El panel tomate es `--ink`, con el texto en `--primary-foreground`.
   - El durazno de las citas confirmadas es `--accent`.
   - El fondo es `--wall`, y las tarjetas, `--card`.
   - **En oscuro:** el panel sigue tomate y el fondo es el gris oscuro del modo oscuro (spec 019).

3. **Las piezas comunes** (`src/features/landing/`):
   - **`landing-styles.ts`:**
     - el contenedor de la página (hasta 1280 px, centrado y con margen);
     - el panel tomate (esquinas de 32 px; en el celular, 26 px);
     - los títulos (Schibsted 800, apretados);
     - los botones redondeados: blanco sobre el panel; tomate o negro sobre el fondo; con borde.

     Salen `FRAME`, `TECH_LABEL` y `WIDE_HEADING`.
   - **`landing-ui.tsx`:**
     - `SectionHeading`, el título de cada sección con su párrafo;
     - `FeatureMark`, la raya tomate corta.

     Salen `Accent`, `SectionBar` y `SectionIntro`.
   - **`landing-motion.ts`:** queda `useActiveSection`, para marcar en la barra la sección en la que se está. Salen
     las apariciones al bajar.
   - **`landing.css`:** queda sólo la aparición de la agenda de la semana al cargar (un fundido corto, sin
     movimiento si el sistema pide menos). Se van la órbita, la cinta, la regla y los bucles de las
     ilustraciones.

4. **La portada** (`src/pages/landing-page.tsx`), en el orden de la spec:
   - **`landing-nav.tsx`:** el logo, Funciones, Especialidades, Preguntas, «Iniciar sesión» y «Crear mi agenda»
     (negro), sin mayúsculas. En el celular, el logo y el botón.
   - **`brand-panel.tsx`** (nuevo; reemplaza a `orbit-hero.tsx` y `orbit-card*.ts(x)`): el panel de marca con
     el título, el texto, los dos botones y la línea de «gratis».
     - **El botón principal** usa `SignupLink`: con el registro cerrado, «Quiero mi agenda» por WhatsApp (spec
       022).
     - **«Ver una página de reservas»** lleva a `DEMO_BOOKING_PATH`.
     - **`week-preview.tsx`** (nuevo): la agenda de la semana de ejemplo. Las citas confirmadas en durazno, las
       pendientes con borde y las reservas online en tomate, con su leyenda y «Ejemplo». En el celular, 3 días.
       Es una tabla para los lectores de pantalla («Semana de ejemplo»).
   - **`specialties-row.tsx`:** «Hecho para» con las tres especialidades como enlaces, sin mayúsculas. Es el
     destino de «Especialidades» en la barra (`#especialidades`, nueva).
   - **`features-section.tsx`:** «Lo que hace por ti mientras atiendes.», con las 8 funciones en dos columnas.
     - **Cada función:** su ilustración en un recuadro gris claro, sin bordes ni sombra, y debajo la raya tomate,
       el título y la explicación.
     - **Los textos** son los de hoy, sin las etiquetas en mayúsculas.
   - **`feature-visuals.tsx`:**
     - **Las mismas ilustraciones,** fijas y en su estado final.
     - **Sin** las etiquetas monoespaciadas en mayúsculas, **sin** los bucles y con «Ejemplo».
     - **Se siguen usando** en las páginas por especialidad.
   - **`data-section.tsx`:** «Tus datos», con las 3 promesas en una fila (una debajo de otra en el celular).
   - **`faq-section.tsx`:** las 7 preguntas, que se abren y se cierran, con sus mismas respuestas.
   - **`start-section.tsx`:** el cierre, un panel tomate más pequeño con el título y los dos botones.
   - **`landing-footer.tsx`:** las mismas columnas (también «Especialidades»), sin mayúsculas ni casillas.
   - **Salen** `feature-marquee.tsx`, `scroll-rail.tsx` y `orbit-*.ts(x)`.
   - **Las anclas** (`#funciones`, `#tus-datos`, `#preguntas`, `#empezar`) son las mismas de hoy. Los enlaces
     viejos siguen funcionando.

5. **Las páginas por especialidad** (`src/pages/specialty-page.tsx`, respuesta 1), con las mismas piezas:
   - **el encabezado:** el panel de marca con el título y el texto de la especialidad, «Crear mi agenda gratis» y
     «Escríbenos por WhatsApp», y la ilustración de su primera casilla en lugar de la semana;
   - **«Tu día a día»:** las 6 casillas como las funciones de la portada;
   - **«Cómo empezar»:** sus 3 pasos, con 1, 2 y 3 porque son una secuencia;
   - **«Preguntas»;**
   - **el cierre.**

   Los textos no cambian (`specialties.ts`). La parte del título que hoy va en cursiva (`AccentTitle`) se muestra
   con la misma letra que el resto, y los datos quedan iguales.

6. **La comprobación nueva `npm run check:landing`** (`scripts/check-landing.ts`), como `check:specialties`. Revisa
   las piezas de la portada:
   - sin precios, porcentajes, testimonios, la LOPDP ni funciones paradas;
   - sin los recursos que se quitan: mayúsculas espaciadas, monoespaciada y cursivas;
   - las 8 funciones, las 3 promesas y las 7 preguntas;
   - «Ejemplo» en la agenda de la semana.

7. **La constitución, 1.42.0, en los dos repos:**
   - la portada es el panel de marca (spec 043);
   - una sola familia de letra en la portada y las páginas por especialidad;
   - sin mayúsculas espaciadas, monoespaciadas ni palabras sueltas en cursiva;
   - un solo movimiento al cargar.

**No se hace:**
- la beta (respuesta 2);
- otros textos: la portada cambia de forma, no de contenido.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| III. Decisiones de la portada | Sí | Sin testimonios, cifras ni precios inventados; sin la LOPDP; sin funciones paradas. Lo comprueban `check:landing` y `check:specialties` |
| La marca, una sola gama | Sí | El tomate, el durazno y los grises de los tokens; el botón principal es el de la marca |
| VII. Diseño | Sí | Nada recortado por el borde, 320 px sin desbordes, claro y oscuro con contraste AA, foco visible y menos movimiento |
| Registro cerrado (2026-10-18) | Sí | Los botones siguen pasando por `SignupLink` y `useSignupContact` |
| Páginas por especialidad (spec 041) | Sí | Mismos textos, título y descripción para Google; `check:specialties` sigue en verde |

## Pruebas

- **Front:** build, lint, `check:contrast`, `check:specialties`, `check:data-export` y `check:landing` (nuevo).
- **El peso:**
  - **las letras:** se comparan los archivos de la portada antes y después; deben pesar menos;
  - **las piezas de la portada:** no deben pesar más.
- **Recorrido en el navegador:**
  - en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro;
  - la portada y las tres páginas por especialidad;
  - sin desbordes (también a 320 px) ni errores en la consola;
  - las anclas de la barra y del pie, también desde una página por especialidad;
  - «Crear mi agenda» al registro;
  - con el registro cerrado, «Quiero mi agenda» a WhatsApp;
  - «Ver una página de reservas» a la de ejemplo;
  - las preguntas se abren con el teclado;
  - con menos movimiento, nada se anima;
  - capturas de cada página para que el dueño del producto las apruebe antes de publicar.

## Riesgos

- **Es la tercera portada en pocos días.** Las capturas del recorrido van al dueño del producto antes de abrir
  el PR.
- **Las páginas por especialidad ya se compartieron:** la vista previa de WhatsApp guarda la versión que vio.
  Sólo cambia el diseño, no el título ni la descripción.
