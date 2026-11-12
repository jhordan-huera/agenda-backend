# Especificación: Portada nueva «Panel de marca»

**Carpeta**: `specs/043-portada-panel-de-marca` (rama de trabajo: `dev`) · **Creada**: 2026-11-11

**Estado**: Implementada (2026-11-11), falta el visto bueno de las capturas. Aprobada el 2026-11-11, «acepto todo lo recomendado»

**Repos**:
- **agenda-front:** la portada, sus piezas, las fuentes y las páginas por especialidad (respuesta 1).
- **agenda-backend:** sólo esta spec y la constitución.
- **La beta:** no cambia (respuesta 2).

## Pedido

El dueño del producto, el 2026-11-11:

> no me gustó el landing page, podemos cambiar a uno más moderno y utilizando las skills que tenemos instaladas
> para el diseño

Se le mostraron tres vistas previas, hechas con la guía de diseño instalada (`frontend-design`):
- **A. Producto al frente;**
- **B. Panel de marca;**
- **C. Del WhatsApp a la cita.**

Eligió «la opción B que tú me recomiendas» ([computador](./prototipo/panel-de-marca-computador.png) ·
[celular](./prototipo/panel-de-marca-celular.png)).

**Lo que se va de la portada actual** (editorial al estilo getartcraft, publicada el 2026-11-10 con el PR del
front #54): la órbita del encabezado, la cinta de funciones en mayúsculas, la regla de la derecha, las barras
«01 / Funciones», las etiquetas monoespaciadas en mayúsculas y las palabras sueltas en cursiva. Son los recursos
que hacen que una página se vea «hecha por IA».

**Para qué sirve:** una portada más moderna y más clara, que muestre en el primer vistazo lo que el profesional
compra (su agenda ordenada) y que se vea igual de cuidada en el celular, por donde llegan los enlaces de WhatsApp.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Un profesional entiende Agenda360 en el primer vistazo (Prioridad: P1)

**Por qué esta prioridad:** es la portada en sí; sin esto no hay función.

**Prueba independiente:** al abrir la portada en el computador y en el celular, lo primero que se ve es el panel
tomate con el título, los dos botones y la agenda de la semana de ejemplo, sin nada cortado por el borde.

1. **Dado** la portada, **cuando** se abre, **entonces** lo primero es la barra (el logo, Funciones,
   Especialidades, Preguntas, «Iniciar sesión» y «Crear mi agenda») y, debajo, el **panel de marca**: un bloque
   tomate con las esquinas redondeadas, dentro del ancho de la página. Lleva:
   - el título en blanco «Tu consulta, ordenada desde la primera reserva.» (respuesta 3);
   - el texto «Tus pacientes eligen su hora en tu página, reciben su recordatorio y confirman que van. Tú ves la
     semana entera de un vistazo.»;
   - los botones **«Crear mi agenda gratis»** (blanco) y **«Ver una página de reservas»** (con borde blanco, a la
     página de reservas de ejemplo);
   - la línea «Gratis para empezar, sin tarjeta. Tus pacientes no crean cuenta.»;
   - **la agenda de la semana de ejemplo:** citas que confirmó el paciente, pendientes y reservas online, cada
     una con su aspecto, su leyenda y la marca «Ejemplo».
2. **Dado** el celular, **entonces** el panel ocupa el ancho con un margen, los botones van uno debajo del otro y
   la agenda muestra menos días para que se lea, sin salirse de la pantalla.
3. **Dado** el registro cerrado (spec 022), **entonces** cada «Crear mi agenda» pasa a «Quiero mi agenda» por
   WhatsApp, como hoy.

### Historia 2 - El resto de la portada con el mismo estilo (Prioridad: P1)

**Por qué esta prioridad:** un encabezado nuevo con el resto viejo se vería a medias.

**Prueba independiente:** al bajar por la portada, todas las secciones tienen el mismo estilo y los mismos
contenidos de hoy.

1. **Dado** la portada, **entonces** después del panel siguen, en este orden y con el mismo estilo:
   - **la fila «Hecho para»** psicólogos, fisioterapeutas y odontólogos (spec 041);
   - **«Lo que hace por ti mientras atiendes»:** las 8 funciones de hoy, cada una con su raya tomate corta, su
     título, su explicación y su ilustración de ejemplo rehecha en el estilo nuevo:
     - tu página de reservas;
     - los recordatorios antes de cada cita;
     - cada cita, de la reserva al cobro;
     - día, semana y mes;
     - una historia clínica que sólo ves tú;
     - el cobro por transferencia;
     - tus citas en el calendario de tu celular;
     - las clínicas con varias agendas.
   - **«Tus datos»:** las 3 promesas de hoy (descargas todo, historia clínica privada, sin cuentas para tus
     pacientes);
   - **«Preguntas»:** las 7 preguntas de hoy, que se abren y se cierran;
   - **el cierre:** un panel tomate más pequeño con los dos botones;
   - **el pie,** con sus columnas de hoy (también «Especialidades»).
2. **Dado** un enlace de la barra o del pie a una sección, **entonces** baja hasta ella, también desde otra
   página.

### Historia 3 - Las páginas por especialidad con el mismo estilo (Prioridad: P2)

**Por qué esta prioridad:** comparten las piezas de la portada; si no cambian, se ven distintas.

**Prueba independiente:** /psicologos, /fisioterapeutas y /odontologos se ven con el estilo nuevo y con sus
mismos textos.

1. **Dado** una página por especialidad, **entonces** usa la barra, el panel de marca, las secciones y el pie del
   estilo nuevo, con sus propios textos (spec 041) (respuesta 1).

### Casos límite

- **El modo oscuro:** el panel sigue tomate y el fondo de la página es gris muy oscuro. Los textos se leen con
  contraste AA.
- **Menos movimiento:** si el sistema lo pide, nada se anima.
- **Pantallas muy anchas:** el contenido no pasa de un ancho cómodo de leer y queda centrado.
- **Pantallas angostas (320 px):** nada se sale ni se corta; la agenda muestra menos días.
- **Sin WhatsApp de soporte:** con el registro cerrado y sin WhatsApp configurado, la portada se comporta como
  hoy.
- **Enlaces viejos:** las anclas de hoy (`/#funciones` y las demás) siguen llevando a su sección.

## Requisitos *(obligatorio)*

- **RF-001**: La portada DEBE abrir con el panel de marca de la vista previa aprobada: el título, el texto, los
  dos botones, la línea de «gratis» y la agenda de la semana de ejemplo, sin salirse del ancho de la página.
- **RF-002**: La portada DEBE tener, en este orden, la fila «Hecho para», «Lo que hace por ti» (las 8 funciones
  con sus ilustraciones), «Tus datos» (3 promesas), «Preguntas» (7), el cierre y el pie, todos con el mismo
  estilo.
- **RF-003**: Los textos de cada sección DEBEN conservarse, salvo lo que el diseño nuevo necesite ajustar, con
  las mismas reglas:
  - sin testimonios, cifras ni precios inventados;
  - la LOPDP sólo en /privacidad;
  - sin funciones paradas (la sincronización con Google y la suscripción de iPhone/iPad);
  - las ilustraciones dicen «Ejemplo» o «datos de ejemplo».
- **RF-004**: NO DEBEN quedar los recursos de la portada actual que se quitan: la órbita, la cinta en
  mayúsculas, la regla de la derecha, las barras numeradas, las etiquetas en mayúsculas espaciadas y las palabras
  sueltas en cursiva.
- **RF-005**: DEBE usar una sola gama (el tomate de la marca, el durazno y los grises) y una sola familia de
  letra.
- **RF-006**: DEBE verse bien en el celular (desde 320 px) y en el computador, en claro y en oscuro, con
  contraste AA, foco visible con el teclado y sin animaciones si el sistema pide menos movimiento. El único
  movimiento al cargar es la aparición de la agenda de la semana.
- **RF-007**: Con el registro cerrado, los botones DEBEN llevar a «Quiero mi agenda» por WhatsApp (spec 022).
- **RF-008**: El título y la descripción para Google y para compartir NO DEBEN cambiar.
- **RF-009**: La portada NO DEBE cargar más que hoy en el celular: una sola familia de letra en vez de tres y las
  ilustraciones sin imágenes pesadas.
- **RF-010**: Las páginas por especialidad DEBEN pasar al estilo nuevo con sus mismos textos (respuesta 1). La
  beta no cambia (respuesta 2).
- **RF-011**: La constitución DEBE recoger la portada nueva y sus reglas de diseño.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Un recorrido con capturas, en el computador (1440 px, claro) y en el celular (390 px, oscuro):
  - la portada y las tres páginas por especialidad;
  - sin nada que se salga de la pantalla ni errores;
  - los enlaces de la barra y del pie llevan a su sección;
  - los botones llevan al registro (o a WhatsApp con el registro cerrado) y a la página de reservas de ejemplo.
- **CE-002**: Las comprobaciones del front sin errores: build, lint, `check:contrast`, `check:specialties` y una
  comprobación de los textos de la portada (sin precios, testimonios, la LOPDP ni funciones paradas).
- **CE-003**: La portada pesa en el celular lo mismo o menos que la actual (letras e ilustraciones).
- **CE-004**: El dueño del producto ve las capturas y aprueba la portada antes de publicarla.

## Supuestos

- **Los textos de hoy se conservan:** la portada cambia de forma, no de contenido. Si algún texto queda largo
  para el diseño nuevo, se acorta sin cambiar lo que dice.
- **La página de reservas de ejemplo** sigue siendo la del negocio de demostración.
- **No hace falta migración ni cambios en el backend.**
- **Las ilustraciones** se rehacen con piezas de la propia página, no con capturas: así se ven bien en claro y en
  oscuro y no pesan.

## Respuestas del dueño del producto (2026-11-11)

«Acepto todo lo recomendado»:

1. **Las páginas por especialidad pasan al estilo nuevo,** con sus mismos textos.
2. **La beta no cambia.**
3. **El título del panel:** «Tu consulta, ordenada desde la primera reserva.»
