# Plan de implementación: Páginas por especialidad

**Rama**: `dev` · **Fecha**: 2026-11-10 · **Spec**: [spec.md](./spec.md) · **Prototipo**: [prototipo/](./prototipo/)

**Sólo el front.** Sin cambios en el backend ni migración.

## Diseño

1. **Una página para las tres especialidades** (`src/pages/specialty-page.tsx`), con la estructura del prototipo que
   aprobó el dueño del producto:
   - **El encabezado:**
     - la etiqueta «Agenda360 · Para psicólogos»;
     - el título grande con su palabra en cursiva;
     - el párrafo;
     - los botones **«Crear mi agenda gratis»** (o «Quiero mi agenda» con el registro cerrado, spec 022) y
       **«Escríbenos por WhatsApp»**;
     - «También para…», con las otras dos especialidades.
   - **01 / Tu día a día:** 6 casillas como las de la portada, con las ilustraciones de siempre (marcadas «datos de
     ejemplo») y el texto de esa profesión.
   - **02 / Cómo empezar:** 3 pasos.
   - **03 / Preguntas:** de 4 a 6 preguntas de esa profesión.
   - **El cierre «Empieza a agendar»** y el pie, los de la portada.
   - **La barra de arriba:** la de la portada, pero con las secciones de esta página. `LandingNav` recibe la lista de
     secciones; la portada sigue con la suya.

2. **Los textos, en un solo archivo** (`src/features/landing/specialties.ts`): por cada especialidad, la dirección,
   el título para Google y para compartir, la descripción, el encabezado, las 6 casillas (con qué ilustración), los
   pasos, las preguntas y el mensaje de WhatsApp. Con lo que ya existe en Agenda360:

   | Página | Las 6 casillas |
   |---|---|
   | **/psicologos** | Reservas por enlace · recordatorios y «Confirmo que voy» · sesiones semanales, presenciales u online · historia clínica con formatos de psicología · el comprobante antes de la sesión · las sesiones en el calendario del celular. En las preguntas: las sesiones en pareja o en familia (hasta 3 pacientes) |
   | **/fisioterapeutas** | Visitas a domicilio con la dirección y el mapa · planes de sesiones (citas que se repiten) · historia clínica con evoluciones y archivos · varias agendas, una por fisioterapeuta · recordatorios · pago por transferencia |
   | **/odontologos** | Historia clínica con radiografías · varias agendas (odontólogos o sillones) · recordatorios y confirmación · la página de reservas con el mapa · el equipo con roles (recepción, profesional) · pago por transferencia |

   **Las ilustraciones** son las de la portada (reservas, recordatorio, semana, historia clínica, pago, calendario,
   equipo, tablero). Para las visitas a domicilio se hace una nueva, con datos de ejemplo, en el mismo estilo.

3. **«Escríbenos por WhatsApp»:** el WhatsApp de soporte de la plataforma (el de «Quiero mi agenda»), con el mensaje
   ya escrito, por ejemplo «Hola, soy psicólogo/a y quiero saber más de Agenda360». Sin WhatsApp de soporte
   configurado, el botón no sale.

4. **Las direcciones** (`router.tsx`): `/psicologos`, `/fisioterapeutas` y `/odontologos`. Las que tienen tilde
   (`/psicólogos`, `/odontólogos`) llevan a la correcta. Las mayúsculas ya dan igual.

5. **Para Google y para compartir.** WhatsApp y las redes no ejecutan la página: leen el HTML tal cual llega.
   - **Al compilar,** un paso del build crea un HTML por especialidad (`dist/especialidades/<nombre>.html`). Es la
     página de siempre, con su título, su descripción y las etiquetas para compartir (`og:title`,
     `og:description`, `og:url`) propias.
   - **En Vercel,** `vercel.json` sirve cada dirección con su HTML, antes de la regla general. El resto de la web no
     cambia.
   - **En el navegador,** la página pone el mismo título, como las demás (`PageTitle`).
   - **El mapa del sitio:** `public/sitemap.xml`, con la portada, las tres páginas y /privacidad, y
     `public/robots.txt` que lo indica. Las páginas privadas no entran: /pago y /cita ya piden no guardarse.

6. **Los enlaces:**
   - **En la portada:** una fila «Hecho para psicólogos · fisioterapeutas · odontólogos» debajo de la cinta de
     funciones.
   - **En el pie:** una columna «Especialidades» con las tres páginas.
   - **Cada página** enlaza a las otras dos y a la portada.

7. **Las reglas, comprobadas solas** (`scripts/check-specialties.ts`, `npm run check:specialties`). Falla si:
   - una página nombra la LOPDP, un precio (`$`), «testimonio», la sincronización con Google o la suscripción de
     iPhone/iPad;
   - le falta el título, la descripción o el mensaje de WhatsApp;
   - el mapa del sitio no tiene las tres páginas, o tiene alguna privada.

8. **La constitución, en los dos repos:** las páginas por especialidad tienen las mismas reglas que la portada. Si
   la 040 se publica antes, va en la 1.37.0.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | Son páginas públicas sin datos de nadie. La analítica de Vercel recibe sólo la ruta |
| III. Decisiones | Sí | Sin planes ni precios, sin testimonios ni cifras inventadas, sin la LOPDP y sin funciones paradas. Lo comprueba `check:specialties` |
| Costo de Vercel | Sí | Son archivos estáticos: no gastan CPU de la API |
| VII. Diseño | Sí | Las piezas de la portada nueva, con la gama de la marca y los grises, a 390 px sin desbordes, en claro y en oscuro |

## Pruebas

- **Front:** build, lint, `check:contrast`, `check:data-export` y el nuevo `check:specialties`.
- **Las etiquetas para compartir:** en el resultado del build, cada HTML de especialidad tiene su título, su
  descripción y su `og:url`, y el `index.html` general no cambia.
- **El recorrido,** en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro, con capturas:
  - las tres páginas se abren completas, sin desbordes ni errores en la consola;
  - «Crear mi agenda gratis» lleva al registro, y con el registro cerrado dice «Quiero mi agenda»;
  - «Escríbenos por WhatsApp» abre WhatsApp con el mensaje de esa especialidad;
  - los enlaces entre páginas, desde la portada y desde el pie;
  - `/psicólogos` lleva a `/psicologos`, y `/abogados` da «No encontrada».
- **El texto:** el dueño del producto revisa las capturas de las tres páginas antes de publicar.
- **Después de publicar:** se pega el enlace de una página en WhatsApp y la vista previa muestra su título.

## Riesgos

- **La vista previa de WhatsApp** guarda la primera versión que ve de cada enlace. Hay que probarla después de
  publicar, no antes.
- **El HTML de cada especialidad** se crea a partir del `index.html` del build. Si un día cambia su estructura, el
  paso del build falla en vez de publicar una página rota.
- **Google tarda** días o semanas en mostrar páginas nuevas: no es un resultado inmediato.
