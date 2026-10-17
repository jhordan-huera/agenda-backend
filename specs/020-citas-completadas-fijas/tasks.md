---

description: "Tareas de «Las citas completadas quedan fijas»"
---

# Tareas: Las citas completadas quedan fijas

**Entrada**: `specs/020-citas-completadas-fijas/`. El dueño del producto aprobó la spec y el plan el
2026-10-16 («si»).

**Rutas:**
- `back/` = agenda-backend;
- `front/` = la copia de trabajo del front para esta spec, un worktree en la rama `spec-020`, porque en
  la carpeta del front trabaja a la vez el rediseño de «Comparar»;
- `beta/` = ~/Documentos/Proyectos/Betas/agenda-beta.

## Fase 1: Base

- [x] T001 Constitución 1.17.0 en los dos repos: una línea en el principio III.
- [x] T002 `front/src/lib/constants/appointment-status.ts`:
  - `LOCKED_STATUS = "completed"`;
  - `canChangeStatus(from, to)`:
    - desde «Completada», nada;
    - a «Pendiente», sólo desde «Pendiente»;
    - lo demás, sí;
  - `CORRECTABLE_FROM_COMPLETED = ["confirmed", "no_show", "cancelled"]`.

  Y `appointmentCorrectionSchema` (`{ status, reason (10–300), notify }`) en
  `front/src/lib/validations/appointment.ts`. Después, `sync:shared` en `back/`, con
  `FRONTEND_DIR=<front>`.

## Fase 2: Historias 1 y 2, el bloqueo y «sólo avanza» (P1)

- [x] T003 [US1] `back/src/services/business-data-service.ts`:
  - **`changeAppointmentStatus`** comprueba `canChangeStatus` y, si no se puede, responde `conflict`
    con los mensajes del plan;
  - **`update`:**
    - si la cita está completada, sólo acepta cambios en `notes`; cualquier otro campo distinto
      responde `conflict`;
    - si cambia el estado, aplica `canChangeStatus`.
- [x] T004 [US1] `front/`:
  - **La ficha** (`appointment-details-sheet.tsx`):
    - una cita completada muestra «Completada · ya no se puede cambiar» en lugar de los botones;
    - una cita confirmada lleva «Pendiente» deshabilitado, con su ayuda.
  - **El formulario** (`appointment-form-dialog.tsx`):
    - si está completada, sólo se editan las notas, con el aviso arriba;
    - la lista de estados sólo trae los permitidos.

## Fase 3: Historia 3, la corrección del propietario (P1)

- [x] T005 [US3] `back/`: `POST /businesses/:id/appointments/:appointmentId/correct-status` en
  `business-routes.ts` y su servicio:
  - sólo para `actor.role === "owner"`, que incluye el modo soporte; si no, `forbidden`;
  - sólo desde «Completada» y hacia un estado de `CORRECTABLE_FROM_COMPLETED`;
  - con el motivo obligatorio;
  - deja en la actividad `appointment.status_corrected`, con el summary del plan y «Estado» en los
    cambios;
  - `notify`, falso por defecto.
- [x] T006 [US3] `front/`:
  - `correctAppointmentStatus` en el repositorio y su mutación;
  - el botón «Corregir estado» en la ficha, sólo para el propietario, con su diálogo: el estado, el
    motivo con su contador y la casilla «Avisar al paciente», apagada.

## Fase 4: Pruebas, beta y cierre

- [x] T007 `back/tests/completed-appointments.test.ts`, nueva, con lo de «Pruebas» del plan. Ajustar
  las suites que ya existen y que cambiaban citas completadas.
- [x] T008 `beta/`: los mismos archivos del front (T002, T004 y T006) y el bloqueo y la corrección en
  su repositorio simulado. Antes, una copia en `beta-src-antes-020.tgz`.
- [x] T009 READMEs del backend y del front: la regla y la ruta nueva.
- [x] T010 Comprobación:
  - `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`;
  - `front/`: `npm run build` y `npm run lint`;
  - la beta: build y lint;
  - un recorrido en los dos modos, a 1440 y a 390 px.
- [x] T011 Cierre: `reporte.md`, el estado de la spec y los commits sin firma de IA. El `front/` se
  fusiona en `dev`.
