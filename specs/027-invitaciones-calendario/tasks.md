---

description: "Tareas de «Las citas, como invitaciones de calendario»"
---

# Tareas: Las citas, como invitaciones de calendario

**Entrada**: `specs/027-invitaciones-calendario/`. El dueño del producto aprobó la spec («si está
aprobado», con los tres valores por defecto) y el plan («procede por favor») el 2026-10-19.

**Rutas:** `back/` = agenda-backend y `front/` = agenda-front. La beta no lo lleva.

## Fase 1: Base

- [x] T001 Constitución 1.23.0, igual en los dos repos (la decisión vigente de las invitaciones).
- [x] T002 `back/db/migrations/048_calendar_invites.sql`:
  - `professionals.calendar_invites boolean not null default false`;
  - la tabla `calendar_invites`, con `appointment_id` y `professional_id` (FK `on delete cascade`),
    `email`, `sequence int not null default 0`, `fingerprint text not null`, `cancelled boolean not
    null default false` y `updated_at`, clave primaria `(appointment_id, professional_id)` y RLS como
    las demás;
  - `notifications.calendar text`.

  Además, la tabla en `TABLES` de `back/src/db/seed.ts` si hace falta, y en `TABLE_INFO` de
  `database-stats-service.ts`.
- [x] T003 Código compartido (`front/src`, luego `npm run sync:shared` en `back/`):
  - `calendarInvites` en el tipo `Professional` y en las validaciones de la agenda y de «Tu agenda»;
  - `calendar_invite` en `EmailType`, con su nombre en palabras donde se listan los tipos.

## Fase 2: Historias 2 y 3, las invitaciones (P1)

- [x] T004 [US2] `back/src/services/calendar-invites.ts` (nuevo): `buildInviteIcs` (RFC 5545, según
  el plan), el contenido del evento con el paciente a medias, la huella y
  `syncCalendarInvites(db, appointmentIds)`, con la ventana de 14 días y `REQUEST` o `CANCEL` según lo
  enviado.
- [x] T005 [US2] `back/src/services/mailer.ts` y `gmail-transport.ts`: el email `calendar_invite` con
  `icalEvent: { method, content }`. `email-limits.ts`: `calendar_invite` cuenta como `business`.
- [x] T006 [US2] Llamar a `syncCalendarInvites` en todo lo que crea o cambia una cita: crear, editar,
  cambiar el estado (con o sin aviso), reactivar, la reserva por la página, la serie y la cancelación
  desde «Tu cita». Revisar con `grep` cada `insert into appointments` y `update appointments`.
- [x] T007 [US3] `back/src/jobs/scheduled-tasks.ts`: sincronizar en cada pasada las citas de las
  agendas con el interruptor que empiezan en los próximos 14 días. En el registro, sólo la cifra.

## Fase 3: Historia 1, el interruptor (P1)

- [x] T008 [US1] API: el cambio de la agenda (Profesionales) y el de «Tu agenda» aceptan
  `calendarInvites`, con los permisos de siempre. Al activarlo, sincroniza enseguida. Va a la
  actividad.
- [x] T009 [US1] Front: el `SwitchField` en `professional-form-dialog.tsx` y en `own-agenda-card.tsx`,
  con la explicación, a qué email llegan y deshabilitado si la agenda no tiene email.

## Fase 4: Comprobación

- [x] T010 Pruebas: `back/tests/calendar-invites.test.ts` (nueva, según el plan), la del transporte
  de Gmail, `database-stats` y la del cron. `npm run typecheck` y la suite completa.
- [x] T011 Front: build, lint, `check:contrast` y el recorrido del interruptor en los dos modos y a
  390 px. (Build, lint y `check:contrast` pasan el 2026-10-19; falta el recorrido en el navegador.)
- [x] T012 La comprobación real con el dueño (Gmail y un iPhone), el `reporte.md` y los commits en
  `dev`.
