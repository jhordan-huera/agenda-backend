# Reporte final: Lo que debe cada paciente

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-11-12, PR backend #76 y front #61) · **Fecha**: 2026-11-12

**Repos**: los dos · **Migración**: No

## Resumen

El panel ya dice cuánto debe cada paciente: sus sesiones atendidas sin marcar como pagadas desde el día en que se
publica la función.
- **En la ficha del paciente:** la tarjeta «Por cobrar», con el total, cada sesión, «Marcar como pagada», «Marcar
  todas como pagadas» y «Recordar el pago por WhatsApp».
- **En la lista de pacientes:** el filtro «Con pagos pendientes», del que más debe al que menos, y «Por cobrar $X»
  en cada uno.
- **En Inicio:** la tarjeta «Por cobrar», que lleva a esa lista.
- **En Reportes:** «Cobrado» pasa a «Ingresos de citas atendidas», con «Por cobrar» al lado.

Sin migración, sin emails automáticos y sin la beta.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Ver y cobrar lo que debe un paciente | P1 | Hecha | La tarjeta de la ficha; marcar una o todas, con una entrada en la actividad por cita |
| H2 – Ver a quién hay que cobrarle | P1 | Hecha | El filtro de la lista y la tarjeta de Inicio; el rol Profesional, sólo su agenda |
| H3 – Recordar el pago por WhatsApp | P2 | Hecha | Las sesiones, el total y las cuentas sin repetir; nunca «deuda» |
| H4 – Reportes sin confusión | P3 | Hecha | «Ingresos de citas atendidas» e «Ingresos», con «Por cobrar», también al imprimir |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Qué cuenta | Cumple | `pending-payments.test.ts`: cuentan las Completadas sin pagar desde la fecha de inicio; no la pagada, la gratis, la cancelada, «No asistió», las confirmadas ni la anterior. `check:pending-payments`, lo mismo en el front |
| RF-002 – La tarjeta de la ficha | Cumple | Recorrido: $75, 3 sesiones, «Comprobante por revisar» en la que lo tiene ([captura](./capturas/ficha-1440-claro.png)) |
| RF-003 – Marcar todas, con la actividad | Cumple | Prueba: marca sólo las pedidas que siguen por cobrar y deja una entrada `appointment.paid` por cita. Recorrido: la confirmación dice «¿Marcar las 2 sesiones como pagadas? Total: $40» ([captura](./capturas/confirmar-1440-claro.png)) |
| RF-004 – La lista | Cumple | Recorrido: «Con pagos pendientes» muestra a Patricia ($120) antes que a Marco ($75) y a nadie más ([captura](./capturas/lista-1440-claro.png)) |
| RF-005 – Inicio | Cumple | Recorrido: «Por cobrar $195, de 2 pacientes, 4 sesiones» lleva a la lista filtrada ([captura](./capturas/inicio-1440-claro.png)). Prueba: el total de Inicio y la suma del resumen por paciente son iguales |
| RF-006 – Quién lo ve | Cumple | Prueba: Recepción ve el total del propietario; el rol Profesional ve y marca sólo lo de su agenda; la dueña de otro negocio recibe 403 |
| RF-007 – El WhatsApp | Cumple | `check:pending-payments` y recorrido: las sesiones, «Total: $75», cada cuenta una vez, sin «deuda». No se envía nada solo |
| RF-008 – Reportes | Cumple | Recorrido: «Ingresos de citas atendidas» y «Por cobrar: $120», sin «Cobrado» ([captura](./capturas/reportes-1440-claro.png)); la versión para imprimir usa los mismos nombres |
| RF-009 – Lo demás igual | Cumple | El tablero, la ficha de la cita, los comprobantes, el informe mensual y la exportación no cambian (`check:board`, `check:data-export` y las suites de siempre) |
| RF-010 – La constitución | Cumple | 1.45.0 en los dos repos (principio III) |
| CE-001 – Las pruebas del backend | Cumple | `tests/pending-payments.test.ts`: 25 de 25 |
| CE-002 – Typecheck, pruebas, build, lint y comprobaciones | Cumple | Backend: `typecheck` y «74 de 74 suites pasaron». Front: build, lint y las 8 `check:*` |
| CE-003 – En el computador y en el celular | Cumple | Recorrido en Chromium a 1440 en claro y en WebKit a 390 en oscuro: 20 de 20 en cada uno, sin desplazamiento horizontal ni errores en la consola |
| CE-004 – Cobrar todo en menos de 30 segundos | Cumple | Desde la ficha: «Marcar todas como pagadas» y confirmar, dos toques, sin abrir ninguna cita |

## Cambios respecto al plan

- **Las dos rutas nuevas van en `back/src/services/pending-payments.ts`** y no en `payment-service.ts`, que ya es
  largo. Ahí está también la condición en SQL que comparte el resumen por paciente.
- **«Por cobrar» en la versión para imprimir** va en la línea de notas, debajo de las cifras («Por cobrar del
  periodo: $X»), y no como una cifra más: las 8 de arriba llenan dos filas de 4 y una novena quedaría sola.
- **En el celular, «Marcar como pagada» de cada sesión** muestra sólo el icono, con su nombre para el lector de
  pantalla y al pasar el ratón. El texto sale desde 640 px.

## Pendientes y riesgos

- **La fecha de inicio** (`PENDING_PAYMENTS_SINCE`) es el 2026-11-12, el mismo día en que se fusionaron los PR.
- **Los negocios que nunca marcan los pagos** verán crecer «Por cobrar» desde la publicación. «Marcar todas como
  pagadas» lo limpia por paciente.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 737c16a | Specs 046, 047 y 048, aprobadas |
| agenda-backend | b60c302 | Spec 046: plan de implementación |
| agenda-backend | (este commit) | Spec 046: lo por cobrar en el resumen por paciente, el total de Inicio y marcar varias como pagadas; constitución 1.45.0 |
| agenda-front | 4140a32 | Spec 046: la tarjeta de la ficha, el filtro de la lista, Inicio, el WhatsApp y Reportes; constitución 1.45.0 |

## Cómo publicarlo

1. **Sin migración ni variables.**
2. **Revisar la fecha de inicio** (`PENDING_PAYMENTS_SINCE`): debe ser el día en que se fusiona el PR a `main`.
3. **Los PR `dev` → `main`** de los dos repos, en verde («Comprobar»). Da igual el orden: el front sin el backend
   nuevo sólo no muestra la tarjeta de Inicio.

## Texto para el PR

Spec 046: lo que debe cada paciente.
- **En la ficha:** «Por cobrar», con «Marcar todas como pagadas» y el WhatsApp para recordar el pago.
- **En la lista:** el filtro «Con pagos pendientes». **En Inicio:** la tarjeta «Por cobrar».
- **En Reportes:** «Cobrado» pasa a «Ingresos de citas atendidas», con «Por cobrar» al lado.
- **Sin migración.**

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/046-por-cobrar/reporte.md
