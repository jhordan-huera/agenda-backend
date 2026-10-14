---

description: "Tareas de Sesiones con varios pacientes"
---

# Tareas: Sesiones con varios pacientes (fase 1)

**Entrada**: documentos de diseño en `specs/004-sesiones-varios-pacientes/`

**Requisitos previos**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md)

**Pruebas**:
- backend: `tests/multi-client-appointments.test.ts`, que es nuevo, más `npm test` y
  `npm run typecheck`;
- front y beta: `npm run build`, `npm run lint` y un recorrido con Playwright en la fase final.

## Formato: `[ID] [P?] [Historia] Descripción`

- **[P]**: en paralelo (otro archivo, sin depender de tareas pendientes).
- **[US0]…[US6]**: historia de la spec.
- **Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` =
  `~/Documentos/Proyectos/Betas/agenda-beta`.

---

## Fase 1: Preparación

- [x] T001 Comprobar que pasan antes de tocar nada: `npm run typecheck` y `npm test` en back/, `npm run build` y `npm run lint` en front/, `npm run build` en beta/
- [x] T002 Respaldo de la beta en `~/Documentos/Proyectos/Betas/agenda-beta-respaldo-antes-de-varios-pacientes-2026-10-13.tar.gz` (sin `node_modules` ni `dist`)

---

## Fase 2: Base (bloquea las historias)

- [x] T003 Crear `back/db/migrations/032_appointment_clients.sql` (data-model.md):
  - la columna `businesses.multi_client_appointments boolean not null default false`;
  - la tabla `appointment_clients (appointment_id → appointments on delete cascade, client_id → clients on delete cascade, business_id → businesses on delete cascade, created_at timestamptz default now(), primary key (appointment_id, client_id))`;
  - el índice `(client_id)` y `enable row level security`;
  - un trigger que rechace «más de 2 filas por cita», «un `client_id` igual a `appointments.client_id` de esa cita» y «un `business_id` distinto al de la cita o al del paciente».
- [x] T004 [P] En `front/src/types/index.ts`:
  - `Business.multiClientAppointments: boolean`, con el comentario «Lo activa el super admin para cada negocio»;
  - agregarlo a la lista que excluye `PublicBusiness`;
  - `Appointment.extraClientIds: string[]`.
- [x] T005 [P] En `front/src/lib/validations/appointment.ts`:
  - `extraClientIds: z.array(z.string().min(1)).max(2, "Una cita puede tener como máximo 3 pacientes.").optional()`;
  - un `refine` que rechace repetidos o el principal en la lista con «Ese paciente ya está en la cita.».
- [x] T006 [P] En `front/src/lib/format.ts`: `joinNames(names)` → «Ana», «Ana y Carlos», «Ana, Carlos y Luis».
- [x] T007 Copiar lo compartido con `npm run sync:shared` en back/ y comprobar que `back/src/shared` no se editó a mano
- [x] T008 En `back/src/db/columns.ts`:
  - `businessColumns` con `multiClientAppointments: "multi_client_appointments"`;
  - `appointmentColumns(alias)` que añade `coalesce((select array_agg(ac.client_id order by ac.created_at, ac.client_id) from appointment_clients ac where ac.appointment_id = <alias|appointments>.id), '{}') as "extraClientIds"`.
- [x] T009 Agregar `appointment_clients` a la lista `TABLES` de `back/src/db/seed.ts`. Aplicar la migración en la base local de pruebas.

**Punto de control**: typecheck y `npm test` pasan; las citas existentes devuelven `extraClientIds: []`.

---

## Fase 3: Historia 0 - El super admin decide qué negocios lo tienen (P1)

**Prueba independiente**: activar el interruptor en un negocio; el otro no lo tiene; el propietario
no puede cambiarlo; no sale en el perfil público; queda en la auditoría.

- [x] T010 [US0] En `back/src/services/admin-service.ts`: `setMultiClientAppointments(ctx, businessId, enabled)`.
  - Usa `authorizeSuperAdmin` y valida que `enabled` sea booleano.
  - Si el valor no cambia, devuelve el negocio sin más.
  - Si cambia, actualiza el negocio y deja la auditoría `platform.multi_client_appointments_changed`: entidad `business`, resumen «Activó / Desactivó las citas con varios pacientes en {negocio}» y el cambio No → Sí.
- [x] T011 [US0] En `back/src/routes/platform-routes.ts`: `PUT /admin/businesses/:businessId/multi-client-appointments` → `adminService.setMultiClientAppointments(req.ctx, id, req.body?.enabled)`
- [x] T012 [P] [US0] En `back/src/services/account-service.ts`, el PATCH del propietario ignora `multiClientAppointments`, como `clientRequiredFields`. En `back/src/services/public-booking-service.ts`, el perfil público lo quita.
- [x] T013 [P] [US0] Agregar `setMultiClientAppointments(businessId, enabled)` a `front/src/lib/data/repository.ts` y `front/src/lib/data/api-repository.ts` (PUT anterior), y `useSetMultiClientAppointments` a `front/src/hooks/queries/use-admin.ts`, que actualiza `admin.business(id)` y `business(id)` e invalida `admin.all`.
- [x] T014 [US0] Crear `front/src/features/admin/multi-client-appointments-card.tsx`:
  - `SettingsSection` + `SwitchField` «Citas con varios pacientes»;
  - texto: «Permite agregar hasta 3 pacientes a una cita (sesiones de pareja). Cada uno recibe sus avisos.»;
  - toast al guardar.

  Mostrarla en `front/src/pages/admin/admin-business-detail-page.tsx`, junto a `ClientRequiredFieldsCard`.

---

## Fase 4: Historias 1 y 2 - Agendar una sesión de pareja y avisar a todos (P1) 🎯 MVP

**Prueba independiente**: quickstart 1 (emails) y pasos 3–4 del panel.

- [x] T015 [US1] Crear `back/src/services/appointment-clients.ts`.
  - `resolveExtraClients(db, { businessId, scope, input, current })`:
    - aplica el interruptor: sin él, sólo se acepta quitar, con el error «Este negocio no tiene habilitadas las citas con varios pacientes.»;
    - valida máximo 2 adicionales, sin repetidos y sin el principal;
    - cada paciente nuevo debe existir, estar activo («{Nombre} está inactivo.») y estar en el alcance (`assertClientInScope`);
    - si `input` es `undefined`, devuelve los actuales.
  - `saveExtraClients(db, appointmentId, businessId, ids)`: borra los que salen e inserta los que entran.
  - `appointmentRecipients(db, appointment)`: principal y adicionales, con nombre y email, en orden.
- [x] T016 [US1] En `back/src/services/business-data-service.ts`:
  - `create` y `update` usan T015, guardan los adicionales en la misma transacción y vuelven a leer la cita;
  - si el principal pasa a ser alguien que estaba como adicional, sale de los adicionales;
  - `appointmentForAudit` y `describeAppointment` (`back/src/services/audit.ts`) nombran a todos con `joinNames`;
  - agregar `{ key: "extraClients", label: "Otros pacientes" }` a `back/src/services/audit-changes.ts`.
- [x] T017 [US2] En `back/src/services/notifications.ts`, `notifyAppointmentChange` compara los destinatarios de antes y de ahora:
  - **los que siguen** reciben el mensaje de hoy;
  - **los agregados a una cita activa** reciben el email del estado (confirmación o solicitud);
  - **los quitados de una cita activa** reciben la cancelación, si está activa en el negocio;
  - **sale un email por dirección**, con el `clientName` de cada destinatario;
  - **la copia al profesional** sale una vez si salió algún email, con `joinNames`;
  - `notifyProfessional` también usa `joinNames`.
- [x] T018 [US2] Recordatorios con una clave por paciente:
  - en `back/src/services/reminder-rules.ts`, el principal conserva la clave de hoy y el adicional usa la misma seguida de `:<client_id>`;
  - en `runReminderJob` de `back/src/services/notifications.ts`, las candidatas consideran a cada paciente, con un email por dirección;
  - en `back/src/services/mailer.ts:180`, el recordatorio sigue vigente si la clave es igual o empieza por la clave seguida de `:`.
- [x] T019 [P] [US2] Agenda del día (`runDailyAgendaJob`) con los nombres de todos. El resumen de emails del cron (`back/src/jobs/scheduled-tasks.ts`) nombra al destinatario de cada email, enmascarado como hoy.
- [x] T020 [US1] Crear `back/tests/multi-client-appointments.test.ts`, con los casos del quickstart 1: interruptor, reglas al guardar, emails, recordatorios, correo compartido, choque de horario y citas existentes.
- [x] T021 [P] [US1] En `front/src/features/appointments/appointment-utils.ts`:
  - `appointmentToInput` incluye `extraClientIds`;
  - `appointmentClientIds(appointment)` devuelve `[clientId, ...extraClientIds ?? []]`;
  - `getAppointmentClientNames(clientsById, appointment, { max })` devuelve «Ana Torres y Carlos Pérez» o «Ana Torres y 2 más».
- [x] T022 [US1] Crear `front/src/features/appointments/extra-clients-field.tsx`, la sección «Otros pacientes»:
  - un `ClientCombobox` por adicional, con botón para quitarlo;
  - «Agregar otro paciente» hasta completar 3;
  - crear uno nuevo con `ClientFormDialog`;
  - sin el interruptor, sólo se puede quitar;
  - no se ofrece el principal, los inactivos ni los ya elegidos.
- [x] T023 [US1] Integrarla en `front/src/features/appointments/appointment-form-dialog.tsx`:
  - estado `extraClientIds`;
  - visible si el negocio tiene el interruptor o la cita ya tiene adicionales;
  - la validación incluye el campo;
  - el `ClientFormDialog` del adicional se monta fuera del `<form>`, como el del principal.

**Punto de control**: con el interruptor activo se crea una cita de pareja y llegan los emails.

---

## Fase 5: Historia 3 - Ver la sesión como una sola cita (P1)

**Prueba independiente**: quickstart pasos 4 y 5 del panel.

- [x] T024 [P] [US3] Usar `getAppointmentClientNames` en `front/src/features/calendar/time-grid-view.tsx` (bloque y `aria-label`), `month-view.tsx` y `agenda-list-view.tsx`.
- [x] T025 [P] [US3] Usar `getAppointmentClientNames` en el inicio:
  - `front/src/pages/dashboard/dashboard-page.tsx`: toast y `clientName`;
  - `front/src/features/dashboard/next-up.tsx`: nombres, y WhatsApp por paciente;
  - `today-list.tsx`, `pending-bookings.tsx` y `day-ribbon.tsx`.
- [x] T026 [US3] En `front/src/features/appointments/appointment-details-sheet.tsx`:
  - la sección «Pacientes» muestra a todos, cada uno con WhatsApp, llamada, email, ficha e historia clínica según los permisos;
  - el título nombra a todos;
  - el cobro y la evolución clínica siguen como hoy.

---

## Fase 6: Historia 4 - Avisar por WhatsApp a cada uno (P2)

- [x] T027 [US4] En `front/src/features/appointments/whatsapp-notice.tsx` (y el contexto):
  - `PendingNotice` guarda la lista de pacientes con teléfono válido;
  - el diálogo muestra un mensaje y un botón «Abrir WhatsApp» por cada uno, con `buildAppointmentNotice` saludando a cada nombre;
  - cada envío registra `logWhatsAppNotice`;
  - título: «Avísales por WhatsApp» si son varios.

---

## Fase 7: Historia 5 - Ficha, historia clínica y reportes de cada paciente (P2)

- [x] T028 [US5] En `back/src/services/business-data-service.ts`:
  - `appointmentService.list` con `clientId` incluye las citas donde el paciente es adicional;
  - `clientService.activity` cuenta las participaciones, con `totalSpent` sólo como principal;
  - `clientService.remove` cuenta y avisa sólo las citas donde es el principal.
- [x] T029 [P] [US5] En `back/src/services/clinical-service.ts`, una evolución puede vincularse a una cita donde el paciente es adicional.
- [x] T030 [P] [US5] En `front/src/features/clients/client-summary.ts`, `summarizeByClient` recorre `appointmentClientIds`. En `front/src/pages/dashboard/client-detail-page.tsx`, el aviso de borrado cuenta sólo las citas donde el paciente es el principal.
- [x] T031 [P] [US5] En `front/src/features/reports/report-insights.ts`:
  - `rankClients` recorre a todos los pacientes, con el dinero sólo en el principal;
  - `summarizeClientVisits` (lo usa la beta) también recorre a todos.

  En `front/src/features/reports/report-stats.ts`, `getClientRetention` recorre a todos. Los canales y el resto siguen por cita.

---

## Fase 8: Historia 6 - Un profesional que sólo ve a sus pacientes (P2)

- [x] T032 [US6] En `back/src/services/agenda-scope.ts`, `ownClientCondition` también cuenta `exists (appointment_clients ac join appointments … where ac.client_id = c.id and professional_id = $p and not client_access_pending)`. Probarlo en T020: el profesional ve a los adicionales y otro profesional no.

---

## Fase 9: Beta

- [ ] T033 [P] En beta/, copiar desde front/ los archivos que son idénticos:
  - `types/index.ts` (sólo los dos campos, porque el archivo difiere), `lib/validations/appointment.ts` y `lib/format.ts`;
  - calendario, reportes, `client-summary.ts` y `appointment-utils.ts`;
  - `extra-clients-field.tsx`, `multi-client-appointments-card.tsx` y los archivos del inicio.

  Revisar con `diff` antes de copiar.
- [ ] T034 En `beta/src/lib/data/mock/`:
  - `store.ts` (`migrateData`): `extraClientIds ??= []` y `multiClientAppointments ??= false`;
  - `seed.ts` y `business-factory.ts`: el interruptor en `false`;
  - `business-data-repository.ts`: las mismas reglas que T015 al crear y editar, y al borrar un paciente se quita de los adicionales;
  - `helpers.ts`: `isClientInScope` cuenta las participaciones;
  - `notifications.ts`: un email por paciente, la copia una vez y los recordatorios por paciente;
  - `admin-repository.ts`: `setMultiClientAppointments` con auditoría;
  - `account-repository.ts`: no lo deja cambiar.
- [ ] T035 En la beta, a mano:
  - repositorio y `use-admin.ts`;
  - formulario, detalle y aviso de WhatsApp;
  - ficha del negocio del super admin.

---

## Fase 10: Cierre

- [ ] T036 Correr `npm run typecheck` y `npm test` en back/, `npm run build` y `npm run lint` en front/, y `npm run build` en beta/
- [ ] T037 Recorrido con Playwright en local (quickstart 2):
  - super admin, interruptor, crear una cita de pareja, agenda, arrastre con emails, detalle, WhatsApp, ficha, reportes y PDF;
  - con el interruptor apagado;
  - a 390 px de ancho.

  Repetirlo en la beta.
- [x] T038 [P] Documentar en `back/README.md` la tabla `appointment_clients`, el interruptor y la migración 032.
- [ ] T039 Commits en `dev` de back y front, sin firma de IA. Escribir `reporte.md` con `/speckit-reporte`. Sin push.

---

## Dependencias

- **Fase 1 → Fase 2 → historias.** T007 (sync) depende de T004–T006. T008 depende de T003.
- **US0** (T010–T014) va antes de probar US1, porque sin el interruptor no se puede agregar.
- **US1 y US2:** T015 → T016 → T017/T018 → T020. En el front, T021 → T022 → T023.
- **US3–US6** dependen de T021 (nombres). En el backend, T028 y T032 son independientes entre sí.
- **Beta** (T033–T035): después de terminar el front.
- **Cierre:** al final.

## En paralelo

- T004, T005 y T006 (archivos distintos del front).
- T012 y T013.
- T024 y T025 (vistas distintas).
- T029, T030 y T031.
- T038 con el recorrido.

## Estrategia

1. **MVP:** fases 1–4. Con el interruptor activo, una cita de pareja manda los emails a todos.
2. **Después:** las fases 5–8 completan cómo se ve, WhatsApp, fichas, reportes y alcance.
3. **Al final:** la beta y el cierre. Se publica sólo cuando el dueño del producto lo pida,
   aplicando antes la migración 032.
