# Plan de implementación: Sesiones con varios pacientes (fase 1)

**Rama**: `dev` · **Fecha**: 2026-10-13 · **Spec**: [spec.md](./spec.md) (aprobada 2026-10-13)

**Documentos**: [research.md](./research.md) (decisiones) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

Una cita podrá tener hasta 2 pacientes adicionales, además del principal, sólo en los negocios que
el super admin habilite.

- **Datos:** el paciente principal sigue donde está. Los adicionales van en una tabla nueva
  (`appointment_clients`). El interruptor es una columna nueva del negocio
  (`multi_client_appointments`, apagada). Son las dos cosas de la **migración 032**.
- **API:** la cita trae y recibe `extraClientIds`. El super admin tiene una ruta nueva para el
  interruptor.
- **Avisos:**
  - cada paciente recibe sus emails y su recordatorio;
  - la copia al profesional sale una vez y nombra a todos;
  - el aviso de WhatsApp tiene un botón por persona.
- **Lo que no cambia:** la protección contra cruces, la reserva online y las citas existentes.
- **Front y beta:**
  - «Otros pacientes» en el formulario de cita;
  - un solo bloque con los nombres en la agenda y el inicio;
  - los pacientes en el detalle, en la ficha de cada uno y en los reportes por paciente;
  - el interruptor en la ficha del negocio del super admin.

## Contexto técnico

**Lenguaje/versión**: TypeScript. Backend con Node, que ejecuta `.ts` directamente; front con
React 19.

**Dependencias principales**: Express 5 y PostgreSQL (backend); React, TanStack Query, Tailwind v4
y shadcn/Radix (front). **Ninguna dependencia nueva.**

**Almacenamiento**: PostgreSQL (Supabase en producción). Migración 032: tabla `appointment_clients`
y columna `businesses.multi_client_appointments`. En la beta, su base en el navegador
(`localStorage`).

**Pruebas**:
- backend: `npm test` (PostgreSQL desechable) y `npm run typecheck`;
- front: `npm run build` y `npm run lint`;
- recorrido con Playwright en local, contra la API y la base de demostración, también a 390 px;
- beta: `npm run build` y un recorrido con Playwright.

**Plataforma**: web (panel en escritorio y celular).

**Tipo de proyecto**: aplicación web en dos repos (agenda-backend y agenda-front), más la beta.

**Objetivos de rendimiento**:
- abrir la agenda no se nota más lento: la lista de adicionales sale en la misma consulta;
- un cambio de cita con 3 pacientes encola a lo sumo 4 emails.

**Restricciones**:
- privacidad: ningún email muestra el contacto de otro paciente, y los logs no llevan datos
  personales;
- Vercel Hobby: los recordatorios siguen en el cron de GitHub;
- topes de emails a terceros: sin cambios.

**Escala**: unos 20 archivos del backend, unos 25 del front y los mismos de la beta.

## Comprobación contra la constitución (1.2.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Interfaz, mensajes de error, emails, auditoría, specs y commits en español. |
| II. Privacidad | Sí | Cada paciente recibe sólo su email y sin el contacto de los demás. La auditoría guarda sólo nombres. El cron y ntfy siguen enmascarando. El interruptor no sale en el perfil público. |
| III. Decisiones | Sí | Ver la lista después de esta tabla. |
| IV. Local | Sí | Pruebas, recorridos y migración en la base local. Nada en Vercel ni en Supabase. |
| V. Compartido | Sí | Tipos, validación y `joinNames` se editan en el front y se copian con `npm run sync:shared`. Nada se edita en `agenda-backend/src/shared`. |
| VI. Barato | Sí | Sin servicios ni dependencias nuevas. La lista de pacientes sale en la misma consulta de la cita. Los recordatorios siguen en el cron. |
| VII. Diseño | Sí | Usa los componentes y tokens actuales (`ClientCombobox`, `SwitchField`, tarjetas). Primero el celular, sin desplazamiento a 390 px. Cada campo con su etiqueta. |

**Decisiones de producto vigentes (principio III) que se respetan:**
- cédula única por paciente: los adicionales son pacientes normales;
- copia al profesional de cada email al paciente, que sale una sola vez;
- la historia clínica sigue siendo individual;
- la reserva online no cambia;
- la nueva decisión del 2026-10-13 (máximo 3, sólo con el interruptor del super admin) ya está en
  la constitución 1.2.0 de los dos repos.

**Sin excepciones**: la tabla de complejidad no aplica.

## Diseño

1. **Datos** ([data-model.md](./data-model.md)). La migración 032 trae:
   - la columna del negocio, apagada por defecto;
   - la tabla `appointment_clients` con clave `(appointment_id, client_id)`, borrado en cascada,
     índice por paciente y RLS;
   - un trigger que impide más de 2 adicionales, repetir al principal o mezclar negocios.
2. **Lectura de citas.** `appointmentColumns()` agrega `extraClientIds` con una subconsulta, así
   todas las lecturas la traen.
3. **Guardado de citas** (`buildAppointmentFields`, `create`, `update`):
   - valida el interruptor (sin él, sólo se puede quitar), el máximo, los repetidos, que cada
     paciente nuevo esté activo y el alcance;
   - guarda las diferencias en la tabla y vuelve a leer la cita;
   - un cuerpo sin `extraClientIds` conserva los que había (D3, D4).
4. **Avisos** (`notifications.ts`, D5):
   - `loadAppointmentContext` devuelve la lista de destinatarios;
   - `notifyAppointmentChange` decide el email de cada uno: los que siguen, los agregados y los
     quitados;
   - sale un solo email por dirección;
   - la copia, el aviso de cita nueva y la agenda del día salen una vez y nombran a todos con
     `joinNames`.
5. **Recordatorios** (D6): una clave por paciente, que conserva la del principal. La búsqueda de
   candidatas y el envío aceptan las dos formas.
6. **Alcance y clínica** (D7): `ownClientCondition` cuenta las participaciones. Una evolución
   puede vincularse a una cita donde el paciente es adicional.
7. **Historial y actividad** (D8):
   - `?clientId=` incluye las participaciones;
   - la actividad cuenta participaciones y el precio sólo del principal;
   - el aviso de borrado cuenta sólo las citas como principal.
8. **Interruptor** (D2):
   - ruta `PUT /admin/businesses/:id/multi-client-appointments` y método del servicio de admin, con
     auditoría;
   - el PATCH del propietario lo ignora y el perfil público lo quita.
9. **Panel:**
   - **Formulario:** «Otros pacientes» con un `ClientCombobox` por adicional, crear uno nuevo ahí
     mismo, quitar, y el botón «Agregar otro paciente» hasta 3. Sin interruptor sólo se puede
     quitar.
   - **Arrastre:** `appointmentToInput` lleva la lista, así arrastrar en la agenda no la pierde.
   - **Nombres:** `getAppointmentClientNames` se usa en la agenda, el inicio, los avisos (toast) y
     el detalle.
   - **WhatsApp:** un mensaje y un botón por paciente.
   - **Ficha:** `summarizeByClient` cuenta las participaciones.
   - **Reportes por paciente:** recorren a todos (`appointmentClientIds`).
10. **Super admin:** tarjeta «Citas con varios pacientes» con un `SwitchField` en la ficha del
    negocio, igual que la tarjeta de datos obligatorios del paciente.
11. **Beta** (D11): los mismos cambios sobre su repositorio de prueba y su base en el navegador.
    Los archivos idénticos al front se copian y los distintos se editan a mano.

## Estructura

### Documentación (esta función)

```text
specs/004-sesiones-varios-pacientes/
├── spec.md          aprobada
├── plan.md          este archivo
├── research.md      decisiones D1–D12
├── data-model.md    migración 032, tipos y ciclo de vida
├── contracts/api.md cambios de la API y de los emails
├── quickstart.md    cómo comprobarlo en local
├── checklists/requirements.md
└── tasks.md         (lo crea /speckit-tasks)
```

### agenda-backend

```text
db/migrations/032_appointment_clients.sql        NUEVO: tabla, columna y trigger
src/db/columns.ts                                 businessColumns + appointmentColumns (extraClientIds)
src/db/seed.ts                                    appointment_clients en la lista de tablas
src/services/appointment-clients.ts               NUEVO: validar, guardar y leer adicionales; destinatarios
src/services/business-data-service.ts            guardar citas, ?clientId=, actividad, borrar paciente, auditoría
src/services/agenda-scope.ts                      ownClientCondition con participaciones
src/services/clinical-service.ts                  evolución vinculada a la cita de un adicional
src/services/notifications.ts                     avisos por paciente, copia una vez, recordatorios, agenda del día
src/services/reminder-rules.ts                    clave del recordatorio por paciente
src/services/mailer.ts                            recordatorio vigente con las dos formas de clave
src/services/audit.ts, src/services/audit-changes.ts   nombres de todos los pacientes y «Otros pacientes»
src/services/admin-service.ts, src/routes/platform-routes.ts   interruptor del super admin
src/services/account-service.ts                   el PATCH del propietario lo ignora
src/services/public-booking-service.ts            el perfil público no lo muestra
src/jobs/scheduled-tasks.ts                       el resumen de emails nombra a cada destinatario
src/shared/**                                     sólo con npm run sync:shared
tests/multi-client-appointments.test.ts           NUEVO
README.md                                         tabla nueva y el interruptor
```

### agenda-front

```text
src/types/index.ts                                Business.multiClientAppointments, Appointment.extraClientIds (compartido)
src/lib/validations/appointment.ts                extraClientIds (compartido)
src/lib/format.ts                                 joinNames (compartido)
src/lib/data/repository.ts, src/lib/data/api-repository.ts   setMultiClientAppointments
src/hooks/queries/use-admin.ts                    useSetMultiClientAppointments
src/features/admin/multi-client-appointments-card.tsx       NUEVO
src/pages/admin/admin-business-detail-page.tsx    la tarjeta junto a «Datos obligatorios»
src/features/appointments/appointment-utils.ts   appointmentToInput, appointmentClientIds, getAppointmentClientNames
src/features/appointments/extra-clients-field.tsx NUEVO: «Otros pacientes»
src/features/appointments/appointment-form-dialog.tsx
src/features/appointments/appointment-details-sheet.tsx
src/features/appointments/whatsapp-notice.tsx (+ whatsapp-notice-context.ts)
src/features/calendar/time-grid-view.tsx, month-view.tsx, agenda-list-view.tsx
src/pages/dashboard/dashboard-page.tsx
src/features/dashboard/next-up.tsx, today-list.tsx, pending-bookings.tsx, day-ribbon.tsx
src/features/clients/client-summary.ts, src/pages/dashboard/client-detail-page.tsx
src/features/reports/report-insights.ts, report-stats.ts
```

### agenda-beta (sin git; respaldo antes de empezar)

- **Los mismos archivos de tipos, validación, `format.ts`, calendario, inicio y reportes** que el
  front, copiados donde son idénticos.
- **`src/lib/data/mock/`:**
  - `store.ts`: `migrateData` con `extraClientIds ??= []` y `multiClientAppointments ??= false`;
  - `seed.ts` y `business-factory.ts`;
  - `business-data-repository.ts`: reglas al guardar y al borrar un paciente;
  - `helpers.ts`: alcance;
  - `notifications.ts`: un email por paciente y recordatorios;
  - `admin-repository.ts`: interruptor y auditoría.
- **`src/lib/data/repository.ts` y `use-admin.ts`.**
- **Formulario, detalle y ficha del super admin:** se editan a mano porque tienen diferencias con
  el front.

## Publicación

1. **Migración primero.** La aplica el dueño del producto en Supabase, como paso aparte y antes de
   publicar el backend:
   ```
   npm run db:migrate
   ```
2. **PR `dev` → `main` de agenda-backend**, con el enlace a `reporte.md` y el aviso de la
   migración 032.
3. **PR `dev` → `main` de agenda-front.** Si el front sale antes que el backend, funciona igual:
   trata la lista como vacía y no muestra la opción.
4. **Después:** el super admin activa el interruptor sólo en el negocio que lo pidió.

## Riesgos

- **Recordatorios ya en cola al publicar.** Conservan su clave y siguen valiendo, porque la del
  principal no cambia. Lo cubre una prueba.
- **Precio en la ficha.** «Lo que te ha pagado» queda sólo en el paciente principal (D8), que es
  quien paga.
- **Asistencia por persona.** No hay forma de marcar que sólo uno de los dos faltó: está fuera de
  esta fase, según los supuestos de la spec.
