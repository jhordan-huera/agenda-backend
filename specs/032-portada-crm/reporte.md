# Reporte final: La portada al estilo de una plataforma de ventas

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-22, PR backend #54 y front #40) · **Fecha**: 2026-10-22

**Repos**: agenda-front y la beta · **Migración**: No

## Resumen

La portada sigue la estructura del ejemplo que eligió el dueño del producto (uupm.cc, sales-crm-platform,
leído con REA), adaptada a Agenda360:
- barra flotante y encabezado centrado con tres sellos reales;
- la vista del panel y una franja de hechos reales;
- «Cada cita, de la reserva al cobro», en cuatro columnas;
- las seis funciones y «Lo repetitivo, en automático», en lugar de la IA, que Agenda360 no tiene;
- «Funciona con lo que ya usas», con las cinco integraciones reales y sin logos de marcas;
- las preguntas frecuentes, el cierre y el pie.

El testimonio está listo, pero no se muestra hasta tener el permiso de la clienta (`TESTIMONIAL = null` en
`landing-constants.ts`). No hay cifras, sellos ni testimonios inventados.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La estructura del ejemplo, adaptada | Cumple | Recorrido: el orden de las secciones y sus títulos, a 1440 y 390 px, claro y oscuro |
| RF-002 – Nada inventado | Cumple | Revisión de los textos: sellos, hechos e integraciones reales; el tablero dice «Ilustración… Datos de ejemplo» |
| RF-003 – El testimonio, sólo autorizado | Cumple | Recorrido: sin testimonio ni su enlace. Con uno de prueba en una copia temporal, aparece con su enlace en el pie |
| RF-004 – Lo de antes funciona igual | Cumple | Recorrido: alta, página de reservas de ejemplo, iniciar sesión, privacidad y «¿Cuánto cuesta?». Con el registro cerrado por email y por WhatsApp, con `?ref=` |
| RF-005 – Claro, oscuro, 390 px, foco y movimiento | Cumple | Sin desplazamiento horizontal de 320 a 1440 px; foco visible; con «reducir movimiento», sin animación; `check:contrast` |
| RF-006 – La beta | Cumple | Copiada (diferencias previas sólo en comentarios), build, lint y contraste, y recorrido: portada, login y entrada con una cuenta de demostración |
| CE-001 – Build, lint, contraste y recorrido | Cumple | Front: los tres sin errores y el recorrido con 57 de 57 |
| CE-002 – Aprobada por el dueño | Cumple | La aprobó con las capturas el 2026-10-22, con el tomate de la spec 033 |

## Cambios respecto al plan

- **El botón naranja aparte desaparece:** con la spec 033 toda la marca pasó al tomate, y el botón usa el principal.
- **El fondo de la página es `--canvas`,** el del panel, y no `--wall`, que sigue usando el login.
- **Los enlaces de la barra salen desde 1280 px.** En el celular el botón dice «Crear mi agenda» para que quepa.
- **Google Calendar, el Calendario del iPhone y Outlook** van juntos en una tarjeta, «Tus citas, en tu calendario», con la nota «son marcas de sus dueños».
- **La semana del panel** pasó a `components/shared/week-sample.tsx`, compartida con el login, que quedó idéntico píxel a píxel.

- **Sin la LOPDP en la portada** (a pedido del dueño, el mismo día): los sellos quedan en dos, la franja de hechos cambia «LOPDP» por «Gratis · Para empezar», y el pie y la respuesta sobre los datos ya no la nombran. La política de privacidad sigue citándola. Commit del front `257663d`.

## Pendientes y riesgos

- **El testimonio:** cuando la clienta lo autorice, rellenar `TESTIMONIAL` con su texto, nombre y especialidad.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-front | 713d0b2 | Specs 032 y 033: la portada al estilo de una plataforma de ventas y la marca de Agenda360 en tomate (iconos, colores, emails; constitución 1.28.0) |
| agenda-backend | 18befa7 | Specs 032, 033 y 034: documentos y reportes; constitución 1.28.0 |

La beta no tiene git. Su respaldo previo está en
`~/Documentos/Proyectos/Betas/agenda-beta-respaldo-antes-de-portada-032-2026-10-22.tar.gz`.

## Cómo publicarlo

1. **Sin migración.** El PR del front, que lleva también la spec 033.
2. **Después:** mirar la portada en producción, en el computador y en el celular.

## Texto para el PR

Spec 032: la portada al estilo de una plataforma de ventas, sin datos inventados: los sellos reales, «Cada
cita, de la reserva al cobro», las funciones, lo automático, «Funciona con» y las preguntas.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/032-portada-crm/reporte.md
