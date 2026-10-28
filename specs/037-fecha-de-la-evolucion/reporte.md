# Reporte final: Elegir y corregir la fecha de una evolución

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-28

**Repos**: agenda-backend y agenda-front (y la beta) · **Migración**: Sí: `053_fecha_de_la_evolucion.sql`

## Resumen

En «Nueva evolución», el candado de la fecha pasa a ser el campo **«Fecha de la consulta»**:
- trae hoy y deja elegir hasta 30 días atrás, nunca una fecha futura;
- al elegir una cita, propone la fecha de esa cita si cabe en esos 30 días.

Cada evolución guardada tiene **«Cambiar fecha»**, junto a «Añadir aclaración». Admite el día en que se
registró o hasta 30 días antes. Cada cambio queda en la actividad, con la fecha anterior y la nueva.

La ficha, la impresión y la descarga muestran la **fecha de la consulta** y, aparte, **cuándo se registró**.
El contenido de la evolución y su fecha de registro siguen sin poder modificarse, tampoco con SQL directo.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Registrar una evolución de otro día | P1 | Hecha | |
| H2 – Corregir la fecha de una evolución guardada | P1 | Hecha | Elegir la misma fecha no deja otra entrada en la actividad |
| H3 – Ver las dos fechas | P1 | Hecha | |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Elegir la fecha al registrar | Cumple | Prueba del backend: sin fecha da hoy; ayer y hace 30 días se aceptan; hace 31 días, mañana o el 30/02 dan 400 con el motivo. Recorrido: el campo trae hoy con `min` y `max`; al elegir una cita toma su fecha, y «Sin cita» vuelve a hoy |
| RF-002 – Corregir la fecha guardada | Cumple | Prueba: dentro de la ventana, sí; 31 días antes o después del día de registro, 400. Una evolución registrada hace 40 días no pasa a hoy, pero sí a 10 días antes de su registro. Elena sin acceso clínico recibe 403 y, con acceso, sí puede |
| RF-003 – En la actividad | Cumple | Prueba: «del 28/10/2026 al 23/10/2026», a nombre de quien lo hizo; la misma fecha no deja otra entrada. Recorrido: el cambio aparece en la actividad |
| RF-004 – La base lo protege | Cumple | Prueba con SQL directo: fallan cambiar el contenido, cambiar la fecha de registro, una fecha fuera de la regla e insertar una fecha futura; una fecha dentro de la regla pasa |
| RF-005 – Las dos fechas | Cumple | Recorrido: la ficha y la impresión muestran la consulta y «Registrada el … por …». `check:data-export` comprueba la descarga |
| RF-006 – La constitución | Cumple | 1.30.0 en los dos repos, idénticas |
| RF-007 – La beta | Cumple | Recorrido en WebKit a 390 px, oscuro: 7 de 7 (registrar con otra fecha, cambiarla, la actividad y la página de formatos) |
| CE-001 – Las pruebas del backend | Cumple | `tests/clinical-note-date.test.ts`: 28 de 28. El modo soporte da 403 y no cambia ninguna fecha (`tests/clinical-support.test.ts`) |
| CE-002 – Las comprobaciones | Cumple | Backend: `typecheck` y `npm test` (69 de 69 suites). Front: build, lint, `check:contrast` y `check:data-export`. Beta: build y lint |
| CE-003 – Computador y celular | Cumple | Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro: 36 de 36, sin desbordes, con capturas |

## Cambios respecto al plan

- **El día de registro lo calcula la base** con `now()` en la zona del negocio, igual que el disparador. Así,
  una evolución guardada justo a medianoche no puede quedar un día por delante de su registro.
- **La prueba es `tests/clinical-note-date.test.ts`** (con el arnés de las pruebas en TypeScript), en vez de
  ampliar `tests/clinical*.test.mjs`.
- **La ficha ya mostraba la hora de registro.** Quedó como «Registrada el 28 oct 2026, 12:04 p. m. por
  Ricardo Paredes». El título sigue siendo la fecha de la consulta; para los lectores de pantalla dice
  «Consulta del…».
- **Se comprueba que la fecha exista** en el calendario: «2026-02-30» da 400 antes de llegar a la base.
- **Tres pruebas que ya existían se adaptaron:**
  - en `cedula.test.mjs`, una fecha de 2020 ahora se rechaza en vez de ignorarse;
  - `clinical-support.test.ts` incluye la ruta nueva;
  - `data-export.test.ts` usa el día del negocio en vez de `current_date`, que con el disparador podía caer
    en otro día por la zona horaria.
- **La política de privacidad** (sección 6) decía que las evoluciones no se pueden modificar. Ahora añade
  que sólo la fecha de la consulta se puede corregir, hasta 30 días antes del registro. Fecha de
  actualización: 28 de octubre de 2026.
- **`src/shared/types/index.ts`** trae también un tipo de la spec 035 (`AdminCalendarFilters`) que faltaba
  sincronizar. No cambia nada en la API.

## Pendientes y riesgos

- **La migración 053 va antes del backend.** Si el backend se publica sin ella, la base sigue bloqueando
  cualquier fecha que no sea la de hoy y «Cambiar fecha» falla.
- **Si un negocio cambia de zona horaria,** su día de registro se calcula con la nueva. Es un caso raro y
  cambia como mucho un día.
- **Cambio suelto en la misma publicación:** la migración 054 y la línea de ayuda de «Formatos de la
  plataforma» (commits `ffaae0c` y `48a0f85`). No son de esta spec.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 5b21514 | Spec 037: la fecha de la evolución se elige al registrarla (hoy por defecto, hasta 30 días atrás, nunca futura) y se corrige después dentro de los 30 días anteriores a su registro, con la actividad; la base lo comprueba (migración 053), ruta PATCH, pruebas y documentos; constitución 1.30.0 |
| agenda-front | 06224f9 | Spec 037: «Fecha de la consulta» en «Nueva evolución» (hoy, hasta 30 días atrás; la de la cita elegida si cabe), «Cambiar fecha» en cada evolución y, aparte, cuándo se registró en la ficha, la impresión y la descarga; privacidad al día y constitución 1.30.0 |

## Cómo publicarlo

1. **Las migraciones 053 y 054,** antes que nada: el dueño del producto ejecuta `npm run db:migrate` en
   agenda-backend.
2. **El PR `dev` → `main` del backend** (la ruta nueva y la fecha al registrar) y después el del front.
3. **Después, en producción:** abrir «Nueva evolución» y comprobar que aparece «Fecha de la consulta» con
   hoy. En una evolución, abrir «Cambiar fecha» y cancelar sin guardar.

## Texto para el PR

Spec 037: la fecha de cada evolución se elige al registrarla (hoy por defecto, hasta 30 días atrás) y se
puede corregir después, siempre dentro de los 30 días anteriores a su registro. Cada cambio queda en la
actividad. El contenido sigue sin poder modificarse. Lleva la migración 053.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/037-fecha-de-la-evolucion/reporte.md
