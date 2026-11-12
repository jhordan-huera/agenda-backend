# Reporte final: Detalle de las tarjetas de «Crecimiento del mes»

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-11-11, PR backend #72 y front #56) · **Fecha**: 2026-11-11

**Repos**: agenda-backend y agenda-front · **Migración**: No

## Resumen

En el Resumen de /admin, cada tarjeta de «Crecimiento del mes» se puede pulsar y abre un panel con su cifra por
negocio:
- **Citas agendadas y reservas online:** cada negocio con lo que va del mes y, al lado, lo de los mismos días del
  mes pasado («Antes»), de más a menos. La suma es la cifra de la tarjeta.
- **Pacientes nuevos:** lo mismo, y debajo de cada negocio «Por la página N · Desde el panel N».
- **Negocios nuevos:** cada uno con su fecha de alta, su plan y su estado.

Cada negocio abre su ficha en /admin. Los suspendidos llevan su marca, porque la tarjeta también los cuenta.

**Sólo cifras:** sin pacientes ni citas sueltas (respuestas 1 y 2). El panel lo dice al pie: quiénes son se ve
en el modo soporte.

**Dónde sale el panel:** a la derecha en el computador y desde abajo en el celular, como el panel del día del
calendario de /admin. El menú no cambia.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El super admin ve de qué negocios es cada cifra | P1 | Hecha | Las cuatro tarjetas, con el mes pasado al lado de cada negocio |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Las tarjetas se pulsan, sin menú nuevo | Cumple | Recorrido: la primera con el ratón y las demás con el teclado (foco y Enter); el menú no cambia |
| RF-002 – Los mismos criterios y periodos | Cumple | `admin-overview`: los mismos periodos y cada lista suma la cifra de su tarjeta en los dos periodos. Recorrido: la suma de cada panel es la de su tarjeta |
| RF-003 – Cada negocio con este mes y el pasado, de más a menos, sin ceros | Cumple | `admin-overview`: el desglose de la Clínica Dental contado a mano (+2 y +2 citas, +1 y +1 reservas, +2 y +1 pacientes), sin la cancelada ni la de fuera del periodo; sin negocios en 0 y de más a menos |
| RF-004 – Pacientes nuevos por origen, sin datos de pacientes | Cumple | `admin-overview`: uno por la página de reservas suma en «Por la página» y uno importado no cuenta. Recorrido: la línea de origen en cada negocio con pacientes este mes |
| RF-005 – Negocios nuevos con fecha, plan y estado | Cumple | `admin-overview` y recorrido: los de la tarjeta, cada uno con «Alta el…», su plan y su estado |
| RF-006 – Cada negocio abre su ficha | Cumple | Recorrido: una fila abre `/admin/businesses/<id>` |
| RF-007 – El estado de los suspendidos | Cumple | `admin-overview`: un negocio suspendido sigue contando, con su estado. Recorrido: la marca «Suspendido» ([captura](./capturas/citas-390-oscuro.png)) |
| RF-008 – Sólo el super admin | Cumple | `admin-overview`: un propietario recibe 403 y alguien sin sesión, 401. Leer no va a la actividad |
| RF-009 – Se calcula al abrir un panel | Cumple | Recorrido: cargar el Resumen no pide el detalle, y las cuatro tarjetas lo piden una sola vez |
| RF-010 – Celular y computador, claro y oscuro, Escape y foco | Cumple | Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro: sin desbordes ni errores; Escape cierra y el foco vuelve a la tarjeta. `check:contrast` |
| RF-011 – Sólo cifras por negocio | Cumple | `admin-overview`: la respuesta no lleva nombres ni emails de pacientes, ni campos de citas. Recorrido: el panel no muestra pacientes |
| RF-012 – La constitución | Cumple | 1.40.0, igual en los dos repos |
| CE-001 – Las pruebas del backend | Cumple | `tests/admin-overview.test.ts`, sección «Detalle de las tarjetas (spec 042)», 12 comprobaciones nuevas |
| CE-002 – Las comprobaciones | Cumple | Backend: `typecheck` y `npm test`, 72 de 72 suites. Front: build, lint y `check:contrast` |
| CE-003 – Recorrido con capturas | Cumple | 2 × 33 comprobaciones, todas bien ([capturas](./capturas/)) |
| CE-004 – Saber de qué negocios son las cifras sin modo soporte | Cumple | Un clic en la tarjeta da la lista por negocio |

## Cambios respecto al plan

- **Si el detalle y las tarjetas no cuadran,** se vuelve a pedir lo más viejo de los dos: las cifras del
  Resumen o el detalle. El plan decía que se volvían a pedir las cifras del Resumen cada vez que se abre un
  panel. Así sólo se pide algo cuando hace falta, y se gasta menos CPU de Vercel.
- **Las etiquetas de los periodos** («del 1 al 11 de noviembre», «lo del 1–11 de octubre») pasaron a
  `growth-labels.ts`, para usarlas en las tarjetas y en el panel.
- **Los nombres largos** de negocio se parten en dos líneas en vez de cortarse, y la marca «Suspendido» baja
  si no cabe.

## Pendientes y riesgos

- **Sin pendientes.**
- **Con muchos negocios,** la lista se desplaza dentro del panel. Sigue siendo una consulta agrupada por negocio.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | bde2450 | Spec 042, aprobada |
| agenda-backend | d290a0a | Spec 042: plan de implementación |
| agenda-backend | 3fb9b79 | Spec 042: `GET /admin/growth`, pruebas y constitución 1.40.0 |
| agenda-front | 4bbdc5a | Spec 042: las tarjetas y el panel del detalle, y constitución 1.40.0 |

## Cómo publicarlo

1. **Sin migración.**
2. **Los PR `dev` → `main`:** primero el del backend (la ruta nueva) y después el del front.
3. **Después:** en /admin, pulsar cada tarjeta de «Crecimiento del mes» y comprobar que la suma cuadra.

## Texto para el PR

Spec 042: en el Resumen de /admin, cada tarjeta de «Crecimiento del mes» abre un panel con su cifra por negocio:
- citas agendadas, reservas online y pacientes nuevos (estos, también por origen), con lo de los mismos días
  del mes pasado al lado;
- los negocios nuevos con su fecha de alta, su plan y su estado.

Cada negocio abre su ficha. Sólo cifras: sin pacientes ni citas sueltas. Se calcula al abrir el primer panel.
Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/042-detalle-crecimiento/reporte.md
