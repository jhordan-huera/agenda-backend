# Reporte final: El tablero de las citas

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-22

**Repos**: agenda-front y la beta · **Migración**: No

## Resumen

La Agenda tiene una cuarta vista, **Tablero**, junto a Día, Semana y Mes:
- **las columnas:** Por confirmar, Confirmadas, Atendidas y Pagadas, cada una con su cifra, más la columna
  plegada «No asistió / Canceladas»;
- **las tarjetas:** la fecha y la hora, el paciente, el servicio, el profesional y las marcas «Reserva
  online», «Confirmó que va», «Pagada» y «Comprobante recibido»;
- **el periodo:** Hoy, Semana o Mes, con las flechas y el filtro de profesional de la Agenda.

**Para mover una cita:**
- en el computador se arrastra la tarjeta;
- en el celular y con el teclado, se usa el botón «Mover a…».

Siempre pide confirmación, con «Avisar al paciente por email y WhatsApp», y usa las mismas acciones de la
cita: sus reglas, sus emails y su actividad. Lo prohibido vuelve a su sitio con el motivo.

El dueño del producto lo aprobó con las capturas el 2026-10-22.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La vista, el periodo, las flechas y el filtro | Cumple | Recorrido: Hoy, Semana y Mes, las flechas y el filtro de profesional; la vista se recuerda con `?view=board&range=` |
| RF-002 – Las tarjetas y sus marcas | Cumple, con un cambio | Recorrido y capturas. «Recordatorio enviado» no está: ver los cambios |
| RF-003 – Las mismas acciones, con confirmación | Cumple | Recorrido: confirmar, Atendidas con y sin aviso, Pagadas, quitar el pago, cada uno con su diálogo, su actividad y sus emails en la API local |
| RF-004 – «Mover a…» con el teclado y en el celular | Cumple | Recorrido con el teclado en Chromium y con el dedo en WebKit a 390 px |
| RF-005 – Permisos y alcance | Cumple | Recorrido como propietario, recepción y profesional («sólo sus pacientes»): cada uno ve lo de su Agenda |
| RF-006 – La beta | Cumple | Build, lint, `check:board` y `check:contrast`. Recorrido con la cuenta de demostración a 1440 px (Chromium) y 390 px (WebKit): confirma una cita y sale el aviso de WhatsApp de siempre |
| CE-001 – Comprobaciones y movimientos | Cumple | Front: build, lint, `check:contrast` y `check:board` sin errores. Recorrido: 95 de 95 |
| CE-002 – Computador, celular, claro y oscuro | Cumple | Capturas a 1440 y 390 px, en claro y oscuro, sin desplazamiento horizontal de la página |

## Cambios respecto a la spec

- **De «Por confirmar» se puede pasar directo a Atendidas o Pagadas,** como ya permite la ficha de la cita.
  Así no le llega al paciente un «tu cita está confirmada» de una cita que ya pasó.
- **«Avisar al paciente» sale también al confirmar,** marcada por defecto, como en la ficha. Marcar o
  quitar el pago no lleva la casilla, porque no envía avisos.
- **Sin la marca «Recordatorio enviado»:** ese dato no llega hoy al panel, y añadirlo pide tocar el backend.
- **Si otra persona ya cambió la cita,** el cambio se hace con `onlyIfOpen`: la API responde `conflict`, la
  tarjeta vuelve, se avisa y la Agenda se recarga.
- **En el tablero,** el selector del periodo ocupa el lugar de la leyenda de los estados, y el botón «Hoy»
  junto a las flechas no se muestra.
- **A 390 px,** las columnas se deslizan de lado dentro de su caja, con el aviso «Desliza para ver todas
  las columnas». Se ofreció mostrar una columna a la vez con pestañas, y el dueño lo aprobó como está.
- **El subtítulo de la Agenda** nombra el tablero: «…por día, semana, mes o en el tablero».

## Pendientes y riesgos

- **Sin la prueba negativa de permisos:** hoy todos los roles pueden gestionar citas, así que no hay nadie
  a quien ocultarle el arrastre. El código lo oculta sin `appointments.manage`.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-front | 8be9054 | Spec 034: el tablero de las citas en la Agenda (Por confirmar, Confirmadas, Atendidas, Pagadas y la columna plegada), con arrastre, «Mover a…» y confirmación |
| agenda-backend | (este) | Spec 034: tareas y reporte |

La beta no tiene git. Su respaldo previo está en
`~/Documentos/Proyectos/Betas/agenda-beta-respaldo-antes-de-tablero-034-2026-10-22.tar.gz`.

## Cómo publicarlo

1. **Sin migración ni backend.** El PR del front.
2. **Después:** abrir Agenda → Tablero en producción, en el computador y en el celular, y mover una cita de
   prueba.

## Texto para el PR

Spec 034: el tablero de las citas en la Agenda (Por confirmar, Confirmadas, Atendidas, Pagadas y la
plegada), con arrastre, «Mover a…» y confirmación, usando las acciones de siempre de la cita.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/034-tablero-citas/reporte.md
