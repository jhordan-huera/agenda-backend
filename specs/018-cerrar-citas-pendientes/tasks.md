---

description: "Tareas de «Cerrar las citas pendientes de días anteriores»"
---

# Tareas: Cerrar las citas pendientes de días anteriores

**Entrada**: `specs/018-cerrar-citas-pendientes/`. El dueño del producto aprobó la spec y el plan el
2026-10-15, con sus decisiones.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` =
`~/Documentos/Proyectos/Betas/agenda-beta`.

- [x] T001 Constitución 1.15.0 en `back/` y `front/`.
- [ ] T002 `front/src/types/index.ts` (y `npm run sync:shared`): `AppointmentsToClose`
  (`{ appointments, overdue, today, nextCursor }`) y la validación de `close-all`.
- [ ] T003 [US1] `back/`, en las rutas del negocio:
  - `GET …/appointments/to-close` y `…/to-close/count`, con `agendaScope`, de la más vieja a la más
    nueva, en tandas de 50 y en la zona del negocio;
  - `POST …/appointments/close-all`, en una transacción, sólo las de su alcance que siguen sin cerrar,
    con una entrada en la actividad por cita y `notify` falso por defecto (con `notify`, los emails de
    la spec 008 en el cupo de la spec 015).

  El cierre de una cita usa `PATCH …/status` con `notify`.
- [ ] T004 [US1] `front/`:
  - el botón «Por cerrar (N)» en la agenda;
  - la lista (`features/appointments/to-close/`), con «Completada», «No asistió», «Cancelada» y «Marcar
    todas como completadas» (con confirmación);
  - la casilla «Avisar a los pacientes», apagada;
  - «Todo al día» cuando no queda nada;
  - en el celular, en un `Sheet`.
- [ ] T005 [US2] `front/src/components/layout/dashboard-layout.tsx`:
  - con `overdue > 0` y sin un «Más tarde» de menos de 4 horas (`localStorage`, con `try/catch`), la
    pantalla «Antes de seguir, cierra tus citas pendientes» en lugar del panel;
  - con «Más tarde», la franja;
  - en modo soporte, sólo la franja.

  El contador se pide junto con la campana: al entrar, al volver a la pestaña y cada 3 minutos con la
  pestaña visible.
- [ ] T006 `back/tests/close-appointments.test.ts` (nueva): lo de «Pruebas» del plan.
- [ ] T007 Comprobación:
  - `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`;
  - `front/`: `npm run build` y `npm run lint`;
  - el recorrido del plan, en escritorio y a 390 px.

  Y los READMEs.
- [ ] T008 Beta (copia previa `beta-src-antes-018.tgz`):
  - la lista y el bloqueo con su repositorio mock;
  - cerrar no escribe en la bandeja simulada salvo con la casilla;
  - build, lint y recorrido en el 3199.
- [ ] T009 Cierre: `reporte.md`, el estado de la spec, los commits sin firma de IA y el mensaje
  sugerido para avisar a los negocios.
