# Reporte final: Las citas, como invitaciones de calendario

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-19, PR backend #52 y front #38) · **Fecha**: 2026-10-19

**Repos**: los dos (la beta no lo lleva) · **Migración**: Sí: `048_calendar_invites.sql`

## Resumen

Cada agenda tiene el interruptor «Recibir mis citas en mi calendario (Google, iPhone, Outlook)»,
apagado al principio:
- **Plan Pro:** en «Tu agenda».
- **Plan Business:** en Profesionales y, para el rol Profesional, en su Perfil.

Con el interruptor activado, cada cita de los próximos 14 días le llega al profesional como una
invitación de calendario, con el paciente a medias y el enlace «Ver en Agenda360»:
- **si la cita cambia,** llega la versión nueva del mismo evento y el calendario la mueve sin
  duplicarla;
- **si se cancela,** llega la cancelación y el calendario la quita;
- **las citas más lejanas** las envía el cron cuando entran en la ventana.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El interruptor por agenda | Cumple | `calendar-invites`: el propietario y el profesional lo cambian, la recepción no, y va a la actividad. Recorrido: «Tu agenda», Profesionales (deshabilitado sin email) y el rol Profesional, en claro y oscuro, a 1440 y 390 px |
| RF-002 – La invitación de cada cita | Cumple | `calendar-invites`: REQUEST con SEQUENCE 0 al email de avisos de la agenda |
| RF-003 – Los cambios y la cancelación | Cumple | `calendar-invites`: 0 → 1 → CANCEL 2 → 3, la confirmación de una reserva (TENTATIVE → CONFIRMED) y el cambio de agenda. **Prueba real del dueño** (Gmail y su calendario): la cita se añadió, se movió sin duplicarse y se quitó al cancelarla |
| RF-004 – El contenido, a medias | Cumple | `calendar-invites`: sin cédula, email, teléfono, notas ni datos clínicos |
| RF-005 – La ventana en el cron | Cumple | `calendar-invites`: la cita llevada de 20 a 10 días la envía el cron una sola vez |
| RF-006 – Al activarlo | Cumple | `calendar-invites` y recorrido: salen las de los próximos 14 días |
| RF-007 – Completadas y «No asistió» | Cumple | `calendar-invites`: no envían nada |
| RF-008 – Los topes y el registro | Cumple | `email-quota` y `cron`: cuentan como emails del negocio; el registro sólo lleva la cifra |
| CE-001 y CE-002 | Cumple | La prueba real del dueño |
| CE-003 | Cumple | `calendar-invites`: una serie de 24 semanales sólo envía las de los 14 días |
| CE-004 y CE-005 | Cumple | Las pruebas y el recorrido |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test` con 65 de 65 suites
  (2840 ✓, 0 ✗). Después se corrieron otra vez las afectadas por el último ajuste.
- **Front:** build, lint y `check:contrast` sin errores.

## Cambios respecto al plan

- **La huella no lleva el enlace,** porque la API y el cron pueden tener orígenes distintos y reenviaban
  todo.
- **`PARTSTAT=ACCEPTED`,** para que el calendario no pregunte «¿Asistirás?» en cada cita.
- **Un endpoint propio para el interruptor,** porque el rol Profesional no tenía cómo cambiar su
  agenda. Con varias agendas, su Perfil tiene la tarjeta «Tus citas en tu calendario».
- **Al eliminar un paciente** se cancelan antes sus eventos, y **al unir una reserva «Por
  verificar»** se actualiza el nombre del evento.
- **En desarrollo** (`EMAIL_REDIRECT_TO`), la invitación pasa a nombre de la cuenta de pruebas. Si no,
  Gmail no la trata como propia. Así se hizo la prueba real.

## Pendientes y riesgos

- **Gmail añade la invitación sola** sólo si la persona lo tiene configurado así. Si no, la primera vez
  hay que tocar «Añadir al calendario». La explicación del interruptor lo dice.
- **Si se borra un negocio,** no salen cancelaciones: todo se borra en cascada.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 88ad3cf | Spec 027: las citas, como invitaciones de calendario (spec, plan, tareas, constitución 1.23.0, migración 048 y backend) |
| agenda-backend | 792fc04 | Spec 027: en desarrollo, la invitación desviada va a nombre de la cuenta de pruebas |
| agenda-front | 0fb2f8a | Spec 027: el interruptor de las invitaciones de calendario de cada agenda (y constitución 1.23.0) |

## Cómo publicarlo

1. **La migración 048, como paso aparte,** antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.**
3. **Después:** activar el interruptor de una agenda propia y crear, mover y cancelar una cita.

## Texto para el PR

Spec 027: las citas, como invitaciones de calendario.
- **El interruptor:** cada agenda tiene «Recibir mis citas en mi calendario», apagado al principio.
- **Las invitaciones:** cada cita de los próximos 14 días le llega al profesional por email como
  invitación, con el paciente a medias. Google, Apple y Outlook la añaden, la mueven si cambia y la
  quitan si se cancela, siempre con el mismo evento.
- **Constitución 1.23.0.**

**Migración:** `048_calendar_invites.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/027-invitaciones-calendario/reporte.md
