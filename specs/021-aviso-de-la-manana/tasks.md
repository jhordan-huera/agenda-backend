---

description: "Tareas de «El aviso de la mañana y el cierre obligatorio del mes»"
---

# Tareas: El aviso de la mañana y el cierre obligatorio del mes

**Entrada**: `specs/021-aviso-de-la-manana/`. El dueño del producto aprobó la spec y el plan, con sus
tres historias, el 2026-10-17 («si»).

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front y `beta/` =
~/Documentos/Proyectos/Betas/agenda-beta.

## Fase 1: Base

- [x] T001 Constitución 1.19.0 en los dos repos, en el principio III: el aviso de la mañana, el
  aviso al super admin y el bloqueo del mes.
- [ ] T002 `back/db/migrations/045_morning_summary.sql`: `panel_notices` acepta `morning_summary` (del
  negocio, como `evening_summary`) y `reminders_sent` (de la plataforma, con su título, su texto y su
  enlace).
  - Hay que rehacer el `check` de la columna `kind` y el `check` de la tabla que separa los del
    negocio y los de la plataforma.
  - Sus nombres se buscan en `pg_constraint`, porque se crearon sin nombre en la 041.
- [ ] T003 El código compartido en `front/src`:
  - **`lib/constants/push.ts`:**
    - `morning_summary` en `OWNER_PUSH_KINDS` y `AGENDA_PUSH_KINDS`;
    - `reminders_sent` en `PLATFORM_PUSH_KINDS`;
    - sus etiquetas y descripciones: «Resumen al empezar el día» y «Recordatorios de citas por
      cerrar enviados».
  - **`lib/constants/notices.ts`:** sus audiencias.
  - **`lib/notices.ts`:** el texto de cada uno, y `morning_summary` abre la lista «Por cerrar».

  Después, `sync:shared` en `back/`.

## Fase 2: Historia 1, el aviso de la mañana (P1)

- [ ] T004 [US1] `back/src/services/push-notices.ts`: `queueMorningSummaries(since, until, tally)`, según
  el plan. Para cada agenda:
  - la hora de inicio de hoy sale de `schedules` (`day_of_week`, `is_active` y el primer `start` de
    `intervals`), en la zona del negocio;
  - no hay aviso si un bloqueo de día completo cubre hoy, sea de la agenda o del negocio;
  - el aviso sale en la ventana del cron o en las 2 horas siguientes;
  - cuenta las citas `pending` o `confirmed` de fecha anterior a hoy;
  - va a la campana y al celular (`userOf`), con la clave `manana:<agenda>:<fecha>`.

  Para el propietario:
  - la hora es la de la primera agenda que abre hoy;
  - la cifra es la del negocio, con la clave `manana:<negocio>:<fecha>`;
  - si también tiene agenda, no recibe además el de su agenda.

  Se llama desde `back/src/jobs/scheduled-tasks.ts`, junto al resumen de las 8. La línea del registro
  de `back/scripts/cron.ts` suma la cifra.

## Fase 3: Historia 2, el cierre obligatorio del mes (P1)

- [ ] T005 [US2] `back/src/services/appointments-to-close.ts`: el contador suma `previousMonth`, las
  citas sin cerrar anteriores al primer día del mes en curso, en la zona del negocio y con el alcance
  por rol.
- [ ] T006 [US2] `front/`, en el tipo del contador, `use-to-close.ts`, `dashboard-layout.tsx`,
  `to-close-screen.tsx` y `close-later.ts`:
  - con `previousMonth > 0`, la pantalla sale sin «Más tarde», aunque haya uno guardado, con «Empezó un
    nuevo mes: cierra las citas del mes anterior para seguir»;
  - en modo soporte, sólo la franja;
  - si falta `previousMonth`, cuenta como 0.

## Fase 4: Historia 3, el aviso al super admin (P2)

- [ ] T007 [US3] `back/`:
  - `queueMorningSummaries` y el resumen de las 8 devuelven a qué negocios avisaron y con cuántas
    citas;
  - al final de la pasada, si salió alguno, un solo aviso `reminders_sent` a la campana de /admin y al
    celular del super admin, con la clave por tanda y ventana:
    - título: «Recordatorios de citas por cerrar enviados»;
    - texto: «Mañana · N negocios: A (6 citas), B (6), …» o «Noche · …»;
    - como mucho 10 negocios, los de más citas, y del resto «y N negocios más»;
  - el mismo aviso por ntfy desde `scripts/cron.ts`, con el título sin negocios;
  - la línea del registro, sólo con cifras.

## Fase 5: Pruebas, beta y cierre

- [ ] T008 Pruebas del backend: las del plan, en una suite nueva, `tests/morning-summary.test.ts`, o
  en `push-notices`, y en `close-appointments` para `previousMonth`. Incluyen la migración 045.
- [ ] T009 `beta/`:
  - antes, una copia en `beta-src-antes-021.tgz`;
  - los archivos compartidos y del front de T003 y T006;
  - en el repositorio simulado, `previousMonth` en el contador, una cita de prueba de un mes anterior
    sin cerrar y un aviso de ejemplo `morning_summary` en la campana.
- [ ] T010 READMEs del backend y del front.
- [ ] T011 Comprobación:
  - `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`;
  - `front/`: build, lint y `check:contrast`;
  - la beta: build y lint;
  - el recorrido del bloqueo del mes y del interruptor, en los dos modos, a 1440 y a 390 px.
- [ ] T012 Cierre: `reporte.md`, con el mensaje para los negocios; el estado de la spec y los commits
  sin firma de IA.
