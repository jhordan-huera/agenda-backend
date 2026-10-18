# Especificación: «Hecho con Agenda360» en las páginas de los pacientes

**Carpeta**: `specs/022-hecho-con-agenda360` (rama de trabajo: `dev`) · **Creada**: 2026-10-18

**Estado**: Publicada (2026-10-18, PR backend #47 y front #35)

**Repos**:
- **agenda-front:** casi todo.
- **agenda-backend:** sólo el texto compartido, si hace falta.
- **La beta:** sí.

## Pedido

El dueño del producto quiere conseguir más clientes (2026-10-18). Cada paciente que reserva ve la
página de un profesional, pero hoy esa página no dice que es de Agenda360. Si lo dijera, cada reserva
llegaría a profesionales que podrían querer lo mismo.

**Además,** el botón principal de la portada lleva a «Crear cuenta», pero el registro público está
cerrado. Quien lo pulsa ve «El registro está cerrado» y se pierde.

**Decisiones del dueño del producto (2026-10-18):**
1. **El enlace lleva a la portada,** con un botón «Quiero mi agenda» que abre un WhatsApp al dueño ya
   escrito. El registro sigue cerrado: el dueño crea cada negocio.
2. **Siempre visible:** ningún negocio puede ocultarlo.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El paciente ve «Hecho con Agenda360» (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** la página de reservas de un negocio (en todos sus pasos y en «¡Cita reservada!»), la de
   pago y la de la cita, **entonces** al final, discreto, se lee «Agenda online con Agenda360 ·
   ¿Eres profesional? Crea tu agenda».
2. **Dado** que se toca, **entonces** se abre la portada de Agenda360 en otra pestaña, sabiendo de qué
   negocio venía.
3. **Dado** cualquier negocio, en cualquier plan, **entonces** se ve. No hay forma de ocultarlo.

### Historia 2 - Escribirle al dueño desde la portada (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** la portada con el registro público cerrado, **entonces** sus botones de «Crear cuenta»
   pasan a «Quiero mi agenda» y abren un WhatsApp al teléfono de soporte, ya escrito: «Hola, quiero mi
   agenda en Agenda360».
2. **Dado** que se llegó desde la página de un negocio, **entonces** el mensaje dice «Hola, vi la página
   de reservas de <negocio> y quiero mi agenda en Agenda360».
3. **Dado** que no hay teléfono de soporte configurado, **entonces** el botón abre un email al email de
   soporte con el mismo texto.
4. **Dado** que el registro público está abierto, **entonces** los botones siguen llevando a «Crear
   cuenta», como hoy.

### Casos límite

- **El enlace** no debe distraer de reservar: va al final, en letra pequeña, y se abre en otra pestaña.
- **La página de un negocio suspendido o que no existe** también lo lleva.
- **Los emails a los pacientes** no cambian en esta spec.

## Requisitos *(obligatorio)*

- **RF-001**: Las páginas de reservas, pago y cita DEBEN mostrar al final «Agenda online con
  Agenda360 · ¿Eres profesional? Crea tu agenda», siempre y en todos los planes.
- **RF-002**: El enlace DEBE abrir la portada en otra pestaña, con el negocio de origen en la
  dirección.
- **RF-003**: Con el registro cerrado, los botones de la portada DEBEN abrir un WhatsApp al teléfono
  de soporte (o, sin teléfono, un email al de soporte) con el mensaje ya escrito, que nombra el negocio
  de origen si lo hay.
- **RF-004**: Con el registro abierto, los botones DEBEN seguir llevando a «Crear cuenta».
- **RF-005**: Se DEBE ver bien en los dos modos y a 390 px. La beta lo lleva.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Desde la página de reservas, en dos toques se llega a un WhatsApp al dueño con el nombre
  del negocio de origen.
- **CE-002**: Ningún botón de la portada lleva a «El registro está cerrado».
- **CE-003**: El build y el lint pasan, y el recorrido funciona en los dos modos y a 390 px.

## Supuestos

- **El dueño pone su teléfono** en /admin → Configuración → Teléfono de soporte. Hoy está vacío.
- **No se cuentan visitas** ni clics: no hacen falta para empezar. El mensaje de WhatsApp ya dice de qué
  negocio vino.
- **La constitución sube** con una línea en el principio III: «Hecho con Agenda360», siempre visible.
