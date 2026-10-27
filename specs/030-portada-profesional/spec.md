# Especificación: Una portada más profesional

**Carpeta**: `specs/030-portada-profesional` (rama de trabajo: `dev`) · **Creada**: 2026-10-21

**Estado**: Publicada (2026-10-22, PR backend #54 y front #40)

**Repos**:
- **agenda-front:** la portada (`/`).
- **La beta:** la misma portada (aprobado por el dueño del producto).
- **agenda-backend:** no se toca. No hay migración.

## Pedido

El dueño del producto, el 2026-10-21: «quiero cambiar el estilo de la landing page para que se vea más
profesional, utilizando las dos skills que tenemos (UI UX Pro Max e interface-design)». Aprobó la
dirección propuesta («sí me gusta esta dirección, y sí, la beta lleva la misma portada»).

**Qué le resta profesionalismo hoy:**
- los degradados morados del título y del bloque final, que UI UX Pro Max marca para evitar;
- seis tarjetas iguales en «Qué hace» y tres iguales en «Cómo empezar», sin nada que destaque;
- una franja de cifras que dice poco;
- y no aparecen las funciones que distinguen a Agenda360: la historia clínica que ni el soporte ve, los
  cuestionarios con su gráfico, «Confirmo que voy», las citas en el calendario del celular, el cobro por
  transferencia y la descarga de los datos.

**La dirección aprobada:**
- **La idea:** el orden de un consultorio bien llevado.
- **El color:**
  - fondos claros y cálidos;
  - **un solo acento, el azul de la marca**;
  - el verde, sólo para «confirmado»;
  - el lila, como detalle mínimo;
  - **sin degradados decorativos**.
- **La letra:** Sora, con la jerarquía por peso y tamaño. Títulos en tinta sólida.
- **El elemento propio:** la franja de «Tu día» con las citas llegando, unida a la tarjeta de WhatsApp
  donde el paciente elige su hora.
- **Claro y oscuro,** con contraste 4,5:1 y sin desplazamiento horizontal a 390 px.
- **Sin precios, sin testimonios y sin cifras inventadas** (decisiones vigentes). El testimonio de una
  clienta se puede añadir más adelante, sólo con su permiso.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Un profesional entiende en segundos qué es y por qué confiar (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** la portada, **entonces** arriba se ve:
   - «Tus pacientes eligen su hora. Tú solo atiendes.», en tinta sólida;
   - «Crear mi agenda gratis» y «Probar una página de reservas»;
   - la línea de confianza: «Hecho en Ecuador · Tus pacientes no crean cuenta · Datos protegidos
     según la LOPDP»;
   - la franja de «Tu día» con la tarjeta de WhatsApp.
2. **Dado** la portada, **entonces** sigue:
   - **para quién:** psicología, odontología, nutrición, fisioterapia, estética y más;
   - **cómo funciona:** comparte → reservan → atiendes, en tres pasos alternados con trozos reales de la
     app;
   - **lo que distingue a Agenda360,** en bloques de distinto tamaño:
     - grande: la historia clínica privada, con el candado y el gráfico del PHQ-9;
     - medianos: «Confirmo que voy» y los recordatorios; las citas en el calendario del celular;
     - pequeños: el cobro por transferencia, las clínicas con varias agendas y la descarga de los
       datos;
   - **las preguntas frecuentes,** con «¿Cuánto cuesta?» → «Escríbenos», sin precios;
   - **la llamada final,** sobria, sobre el azul de la marca;
   - **el pie de página.**
3. **Dado** cualquier enlace o botón de antes (crear la agenda, la página de reservas de ejemplo, iniciar
   sesión, la política de privacidad, el contacto por WhatsApp o email con su código de referido),
   **entonces** sigue funcionando igual.

### Casos límite

- **A 390 px:** todo se lee, sin desplazamiento horizontal. La franja y la tarjeta se apilan.
- **En modo oscuro:** los mismos contrastes. Si la portada no seguía el modo de la cuenta, sigue el
  del sistema.
- **Con «prefers-reduced-motion»:** sin animaciones de movimiento.
- **Con el teclado:** cada enlace y botón con su foco visible.
- **El enlace de referido (`?ref=`)** y el contacto de alta siguen igual.

## Requisitos *(obligatorio)*

- **RF-001**: La portada DEBE seguir la dirección aprobada: un solo acento, sin degradados decorativos,
  títulos en tinta sólida y la franja de «Tu día» como elemento propio.
- **RF-002**: DEBE contar las funciones que distinguen a Agenda360, sin precios, testimonios ni cifras
  inventadas.
- **RF-003**: DEBE verse bien en claro y oscuro, a 1440 y 390 px, con contraste 4,5:1, foco visible y
  movimiento reducido.
- **RF-004**: Todo lo que hacía la portada (enlaces, contacto, referidos) DEBE seguir funcionando.
- **RF-005**: La beta DEBE llevar la misma portada.

## Criterios de éxito *(obligatorio)*

- **CE-001**: La revisión de diseño (interface-design: design-review) y la lista de UI UX Pro Max pasan
  sin problemas graves.
- **CE-002**: Build, lint y la revisión de contraste pasan, y el recorrido no encuentra desplazamiento
  horizontal ni enlaces rotos.

## Ampliación: el acceso con el mismo estilo (2026-10-21)

El dueño del producto, después de ver la portada nueva: «¿podemos rediseñar el login?».

### Historia 2 - Iniciar sesión y registrarse, con el mismo estilo (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** «Iniciar sesión», «Crear cuenta» y los demás pasos del acceso, como la verificación en dos
   pasos, **entonces** usan el estilo «Panel de marca» (como Calendly o Cal.com):
   - el formulario en blanco, sin tarjeta, con el logotipo arriba;
   - en el computador, a la derecha, un panel azul marino sólido a toda altura, sin degradados: el
     mensaje de la portada, la semana de la Agenda entera dentro del panel, con el aviso de la reserva
     nueva, y la línea de confianza;
   - la semana, en una sola gama (el azul de la marca y grises), sin los colores pastel de cada estado:
     lo atendido en gris, lo confirmado en azul claro, lo pendiente con borde punteado y la reserva nueva
     en azul lleno;
   - un solo acento azul y títulos en tinta sólida;
   - en el celular, sólo el formulario.

   **Por qué este estilo:** la primera versión (la hoja de papel con la franja de «Tu día» al lado) no
   le gustó al dueño del producto: «dame un diseño más profesional». Eligió «Panel de marca» entre tres
   propuestas (2026-10-21). Al verlo pidió que la agenda no se saliera de la pantalla y «colores profesionales,
   que no parezcan colores que usa la IA».
2. **Dado** el acceso, **entonces** todo funciona igual:
   - el email y la contraseña, «Recordarme» y los errores junto a su campo;
   - la verificación en dos pasos del super admin;
   - el registro con su CAPTCHA, y el contacto por WhatsApp si el registro está cerrado, con el
     código de referido;
   - los enlaces a la portada y a la política de privacidad.
3. **Dado** claro y oscuro, a 1440 y 390 px, **entonces** contraste 4,5:1, foco visible y sin
   desplazamiento horizontal.

- **RF-006**: El acceso DEBE seguir el estilo de la portada sin cambiar lo que hace.
