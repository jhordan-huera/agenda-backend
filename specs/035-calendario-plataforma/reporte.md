# Reporte final: El calendario de la plataforma, sólo con cifras

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-22

**Repos**: agenda-backend y agenda-front · **Migración**: No

## Resumen

El /admin tiene la página **Calendario**, después de «Analítica»:
- **Mes:** cada día con sus citas sin cancelar, en cuántos negocios y las que siguen «sin cerrar», con un
  fondo más intenso cuantas más citas hay.
- **Semana:** un mapa de horas por días, con los totales de cada día y de cada hora.
- **El panel de un día o de una hora:** cada negocio con sus citas por estado, con los nombres del tablero
  (spec 034), las online, las sin cerrar, las de cada agenda y el enlace a su ficha.
- **Filtros:** por tipo de negocio y por negocio. Sólo cuentan los negocios activos.

**Nunca lleva** al paciente, el servicio, las notas ni la cita suelta. La constitución lo dice desde la
1.29.0: las citas de un negocio se ven en modo soporte, para darle asistencia.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La página, Mes y Semana, flechas, «Hoy» y filtros | Cumple | Recorrido: el menú, las dos vistas, las flechas, «Hoy», y los dos filtros, que van en la dirección |
| RF-002 – Activos, sin canceladas y «sin cerrar» | Cumple | Prueba del backend con un caso conocido y un suspendido. En el recorrido, el total del mes (271), el de la semana (68) y una hora coinciden con consultas aparte a la base local |
| RF-003 – El panel por negocio | Cumple | Prueba del backend: estados, online, sin cerrar y agendas, por día y por hora. En el recorrido, el panel de una hora coincide con la base |
| RF-004 – Nada del paciente ni de la cita suelta | Cumple | Prueba del backend: la respuesta no contiene el nombre, el email, el teléfono ni la cédula del paciente, el servicio, las notas ni los id de las citas, y sólo lleva los campos de cifras. En el recorrido, ninguno de los 11 pacientes ni de los 9 servicios del día aparece en el panel |
| RF-005 – Sólo el super admin; no va a la actividad | Cumple | Prueba: un propietario recibe 403, sin sesión 401, y mirarlo no añade filas a la actividad. La verificación en dos pasos la pide `requireSuperAdminTwoFactor`, como en todo el /admin |
| RF-006 – La constitución | Cumple | 1.29.0 en los dos repos, idénticas |
| CE-001 – La prueba del backend | Cumple | `tests/admin-calendar.test.ts`: 36 de 36 |
| CE-002 – Las comprobaciones | Cumple | Front: build, lint, `check:contrast`, `check:admin-calendar` (15) y `check:board`. Backend: `typecheck` y `npm test` (68 de 68 suites) |
| CE-003 – Computador y celular, claro y oscuro | Cumple | Recorrido en Chromium a 1440 px y WebKit a 390 px, en claro y oscuro: 66 de 66. El mes y la semana caben en 7 columnas sin desplazamiento ni cortes, y el contraste de cada texto es de 4,5:1 o más |

## Cambios respecto al plan

- **El esquema de la consulta** vive en el servicio del backend, como el de la Analítica, y no en lo
  compartido: el front no tiene formulario.
- **`calendar-figures.ts`** en lugar de `calendar-intensity.ts`: además de la intensidad, lleva las horas de
  la semana y el total del mes, con su prueba.
- **Sobre el fondo de color, el texto va en el color del texto.** El gris y la marca daban 3,1–3,6:1 en los
  días más llenos. «Sin cerrar» se distingue por un punto de la marca. Los días de los meses de al lado
  pasaron de 3,09 a 4,5 o más.
- **Las marcas de las columnas del tablero** pasaron a `board-columns.ts` (`BOARD_COLUMN_MARK`) para
  compartirlas con el panel del día.
- **Un negocio con sólo canceladas ese día** sale en el panel, pero «en N negocios» cuenta como la casilla
  del día: sólo los que tienen citas sin cancelar.
- **Al cerrar el panel,** el foco vuelve al día o a la hora que lo abrió.

## Pendientes y riesgos

- **La beta no lo lleva,** como se propuso en la spec: su /admin tampoco tiene la Analítica.
- **Con muchos negocios,** el filtro «Negocio» es una lista simple. Con decenas convendría un buscador.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-front | 744416d | Spec 035: el calendario de la plataforma en /admin, sólo con cifras (mes, semana por horas y el panel de cada día u hora por negocio, estado y agenda; sin pacientes ni servicios); constitución 1.29.0 |
| agenda-backend | COMMIT_BACKEND | Spec 035: el calendario de la plataforma, sólo con cifras (endpoints, prueba y documentos); constitución 1.29.0 |

## Cómo publicarlo

1. **Sin migración.** El PR del backend, con los dos endpoints, y después el del front.
2. **Después:** abrir /admin → Calendario en producción, en el computador y en el celular, y tocar un día.

## Texto para el PR

Spec 035: el calendario de la plataforma en /admin, sólo con cifras: cuántas citas hay cada día y cada
hora, en qué negocios, en qué estado y de qué agenda, sin pacientes ni servicios.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/035-calendario-plataforma/reporte.md
