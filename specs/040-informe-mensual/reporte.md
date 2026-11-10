# Reporte final: Informe mensual para el negocio

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada (2026-11-10) · **Fecha**: 2026-11-10

**Repos**: agenda-backend y agenda-front · **Migración**: No

## Resumen

El día 1 de cada mes, desde las 8:00 de su hora, el **propietario** de cada negocio activo con citas el mes
anterior recibe por email **«Tu mes de octubre en Agenda360»** (con el mes que corresponda). Lleva:
- las cifras del mes que no están en 0: citas gestionadas, reservas por la página, recordatorios enviados,
  pacientes que confirmaron que van, cancelaciones con tiempo, pacientes nuevos, comprobantes de pago recibidos e
  ingresos estimados;
- la comparación con el mes anterior;
- el botón «Ver mis reportes», su enlace de recomendación y la nota para apagarlo.

Sale una sola vez por mes, hasta el día 7 si el cron no pudo pasar el 1, y lo envía el cron de GitHub.
El propietario lo apaga o lo enciende en **Configuración → Notificaciones → Tu informe mensual**. Viene encendido y
nadie más lo cambia.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El propietario recibe el resumen de su mes | P1 | Hecha | Con los ingresos estimados (respuesta 1) |
| H2 – El propietario decide si lo recibe | P2 | Hecha | Una sección propia en Notificaciones |
| H3 – El informe dentro del panel | — | No se hace | Sólo por email (respuesta 2) |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El día 1 desde las 8:00 | Cumple | `monthly-report`: nada a las 7:59, sale a las 8:00 |
| RF-002 – Cifras reales del mes, sin líneas en 0 | Cumple | `monthly-report`: cada cifra contada a mano, el mes en la hora del negocio (lo de las 22:00 del día 31 de Ecuador cuenta en ese mes) y las líneas en 0 que no salen |
| RF-003 – Sin datos de pacientes, planes, precios ni LOPDP | Cumple | `monthly-report`: el email no lleva nombres, emails ni teléfonos de pacientes, ni planes, precios o la LOPDP |
| RF-004 – El botón a Reportes y el enlace de referidos | Cumple | `monthly-report` y la prueba real |
| RF-005 – Una vez por mes, hasta el día 7 | Cumple | `monthly-report`: varias pasadas el mismo día y los siguientes no lo repiten; sale el día 4 si no salió antes; nada desde el día 8 |
| RF-006 – En el historial de emails, no en la actividad | Cumple | Va en la cola con el tipo «Informe mensual», que sale en el historial del negocio |
| RF-007 – El interruptor del propietario | Cumple | `monthly-report`: encendido sin el campo guardado; el propietario lo apaga y queda en la actividad; si lo manda una administradora o el super admin en modo soporte, se ignora. Recorrido: lo ve el propietario y no una administradora |
| RF-008 – Suspendidos, sin propietario o sin citas | Cumple | `monthly-report`: ninguno recibe informe |
| RF-009 – Fuera de Vercel | Cumple | Lo calcula y lo envía el cron de GitHub (`queueMonthlyReports`). La API sólo guarda el interruptor |
| RF-010 – Los ingresos estimados | Cumple | `monthly-report`: 30 + 20 + 10 de las completadas |
| RF-011 – Sólo por email | Cumple | Ni el panel ni la beta cambian |
| RF-012 – La constitución | Cumple | 1.36.0, igual en los dos repos |
| CE-001 – Las pruebas del backend | Cumple | `tests/monthly-report.test.ts`, 29 comprobaciones |
| CE-002 – Las comprobaciones | Cumple | Backend: `typecheck` y `npm test`, 72 de 72 suites. Front: build, lint, `check:contrast` y `check:data-export` |
| CE-003 – Computador y celular | Cumple | El interruptor en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro, sin desbordes ni errores ([capturas](./capturas/)) |
| CE-004 – La prueba real | Cumple | Un informe de octubre real al buzón de pruebas (enviado). Se lee bien en el celular ([captura del email](./capturas/email-celular.png)) |

## Cambios respecto al plan

- **El interruptor va en su propia sección,** «Tu informe mensual», y no dentro de «Emails a tus clientes»: ese
  bloque es de los emails a los pacientes.
- **El enlace de referidos se llama «Tu enlace de recomendación»** en vez de mostrar la dirección. En la versión de
  texto del email salía repetida.
- **La prueba del cron** (`tests/cron.test.mjs`) ahora espera «informes mensuales: N» en el registro.

## Pendientes y riesgos

- **El primer día 1 después de publicar** salen los informes de todos los negocios con citas de golpe. Son pocos para
  el cupo de Gmail y van en el nivel más bajo: si no caben, esperan.
- **Un negocio que no quiera el informe** lo recibe la primera vez, hasta que lo apague.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | ccedf8c | Specs 040 y 041, aprobadas |
| agenda-backend | 4ed2509 | Specs 040 y 041: planes de implementación |
| agenda-backend | fa0d500 | Spec 040: informe mensual para el negocio |
| agenda-front | 53a5de1 | Spec 040: informe mensual para el negocio |

## Cómo publicarlo

1. **Sin migración.**
2. **Los PR `dev` → `main`** del backend y del front, en cualquier orden.
3. **Después:** el primer informe sale el 1 de diciembre desde las 8:00. Ese día, en el historial de emails de un
   negocio con citas en noviembre, sale «Informe mensual».

## Texto para el PR

Spec 040: el día 1 de cada mes, el propietario recibe por email el resumen de su mes anterior (citas, reservas
online, recordatorios, confirmaciones, cancelaciones con tiempo, pacientes nuevos, comprobantes, ingresos estimados y
la comparación). Lo envía el cron de GitHub y se apaga en Configuración → Notificaciones. Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/040-informe-mensual/reporte.md
