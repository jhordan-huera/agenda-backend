# Reporte final: Recordatorio de control

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev (sólo `dev`, para probarla esta semana; sin PR a `main`) · **Fecha**: 2026-11-15

**Repos**: los dos · **Migración**: Sí: `058_recordatorio_de_control.sql`

## Resumen

Cada servicio puede tener «Volver en», por ejemplo la limpieza en 6 meses.

- **La Agenda tiene la hoja «Controles».** Muestra a quién ya le toca volver y a quién le toca en los próximos 30
  días, con el WhatsApp ya escrito, «Agendar» y «Quitar».
- **La ficha del paciente dice su próximo control.**
- **Con el interruptor encendido,** el día que le toca, el paciente recibe «Te toca tu control» con el botón para
  reservar. Nunca se les escribe de golpe a quienes ya les tocaba antes.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El consultorio ve a quién le toca volver | P1 | Hecha | La hoja, «Agendar», «Quitar» y la ficha |
| H2 – Al paciente le llega el aviso | P1 | Hecha | El email, la reserva con el servicio elegido y la baja |
| H3 – El negocio lo configura | P2 | Hecha | «Volver en» en el servicio y el interruptor |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – «Volver en» en el servicio | Cumple | control-reminders.test.ts (la lista, 45 rechazado, la actividad, un panel anterior lo conserva); recorrido |
| RF-002 – El control y su fecha | Cumple | La fecha de la última cita Atendida + los días; una por paciente y servicio; sólo el principal |
| RF-003 – La hoja «Controles» | Cumple | Los vencidos y los de 30 días, en orden, sin quien tiene una cita por delante (también como otra persona) ni desactivados; recorrido a 1440 y 390 |
| RF-004 – «Quitar» | Cumple | Sale de la lista, con la actividad, dos veces no repite, una cita nueva trae otro control |
| RF-005 – El rol Profesional | Cumple | Sólo su agenda; no quita los de otra (404); otro negocio, 403 |
| RF-006 – La ficha | Cumple | «Control vencido hace 10 días: Limpieza dental» y «Próximo control: Limpieza dental, …» (recorrido) |
| RF-007 – El interruptor | Cumple | Recepción 403, el propietario lo enciende, la actividad y la fecha; apagado, sin fecha |
| RF-008 – El email | Cumple | Desde las 10:00, una vez, hasta 30 días (a los 29 sí, a los 31 no), dos controles en un email; sin email, con la marca, con una cita por delante o quitado, no |
| RF-009 – Nada por lo ya vencido | Cumple | Ni por lo vencido al encenderlo ni antes de poner «Volver en» en el servicio |
| RF-010 – El contenido del email | Cumple | «Reservar mi control» con el servicio y el profesional, el enlace para no recibir más, sin copia; la página de reservas abre con el servicio elegido (recorrido) |
| RF-011 – No recibir más | Cumple | Sin sesión, con un botón para confirmar, la actividad una vez; la página no muestra datos del paciente |
| RF-012 – Apagado, todo igual | Cumple | Sin «Volver en» no sale el botón ni la hoja; con el interruptor apagado no sale ningún email |
| RF-013 – La constitución | Cumple | 1.49.0 en los dos repos |
| CE-001 – Las pruebas del backend | Cumple | `tests/control-reminders.test.ts` |
| CE-002 – Todo pasa | Cumple | Backend 77 de 77 suites; front: compilación, lint y 12 de 12 `check:*` |
| CE-003 – El recorrido | Cumple | Playwright: Chromium 1440 en claro y WebKit 390 en oscuro, sin desplazamiento horizontal ni errores; capturas en [capturas/](./capturas/) |
| CE-004 – A quién escribir en menos de 30 s | Cumple | Desde la Agenda, un toque abre la hoja y otro el WhatsApp con el mensaje escrito |
| CE-005 – Una prueba real del email | Sin comprobar | El email se armó y se miró a 390 px ([capturas/email-390.png](./capturas/email-390.png)); el envío real lo prueba el dueño con `dev:local` (abajo) |

**Pruebas automáticas**:
- **Backend:** `npm run typecheck` sin errores; `npm test` 77 de 77 suites. `cron.test.mjs` se repitió después de sumar «controles: N» a su patrón del registro.
- **Front:** `npm run build` y `npm run lint` sin errores, y las 12 `check:*` en «Todo bien», también la nueva
  `check:control-reminders`.

## Cambios respecto al plan

- **`cron.test.mjs`:** su patrón del registro del cron ahora incluye «controles: N».

## Pendientes y riesgos

- **La prueba real del email** (CE-005) la hace el dueño en local (ver abajo).
- **El control lo calcula una consulta** sobre las citas Atendidas del negocio cada vez que se abre la Agenda. Con
  los volúmenes de hoy es instantáneo; con decenas de miles de citas por negocio habría que guardarlo.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 61b22e7 | El recordatorio de control: la migración, la API, el envío y las pruebas |
| agenda-front | 15b63b0 | El recordatorio de control: el servicio, la hoja, la ficha, el interruptor, la reserva y la página de la baja |

## Cómo probarlo esta semana (sólo en local)

1. **Arranca la API con** `npm run dev:local -- --recordatorios`.
   - Aplica sola la migración 058 en tu base local.
   - Con `--recordatorios` corre el envío automático cada 5 minutos. Todos los emails van a tu propio correo
     (LOCAL_TEST_INBOX), con el destinatario original en el asunto.
2. **Pon «Volver en: 1 semana»** en un servicio y enciende el recordatorio en Configuración → Notificaciones.
3. **Crea una cita de hace 7 días** para un paciente sin citas por delante y márcala como Atendida. Su control vence
   hoy: después de las 10:00, en la siguiente pasada, te llega «Te toca tu control».
4. **Agenda → Controles:** ahí está, con el WhatsApp, «Agendar» y «Quitar».

No se prueba con `dev:prod`: con la base de producción se escribiría a pacientes reales.

## Cómo publicarlo (cuando el dueño lo pida)

1. **El dueño aplica la migración 058** en producción con `npm run db:migrate`.
2. **Después, el PR `dev` → `main`** del backend y el del front.
3. **Después de publicar,** sólo leyendo: que el cron diga «controles: N» en su registro.

## Texto para el PR

Spec 051: recordatorio de control. «Volver en» en cada servicio, la hoja «Controles» en la Agenda (WhatsApp, Agendar
y Quitar), el próximo control en la ficha y, si el propietario lo enciende, el email «Te toca tu control» el día que le
toca, con el botón para reservar. Con migración (058, antes del backend).

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/051-recordatorio-de-control/reporte.md
