---

description: "Tareas de Servicios en pareja o familia y su reserva online"
---

# Tareas: Servicios en pareja o familia y su reserva online (fase 2)

**Entrada**: documentos de diseño en `specs/005-servicios-en-pareja/`

**Requisitos previos**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md)

**Pruebas**:
- backend: `tests/couple-booking.test.ts` (nueva) y `tests/booking-alert.test.ts` (ampliada), más
  `npm test` y `npm run typecheck`;
- front y beta: `npm run build`, `npm run lint` y un recorrido con Playwright en la fase final.

## Formato: `[ID] [P?] [Historia] Descripción`

- **[P]**: en paralelo (otro archivo, sin depender de tareas pendientes).
- **[US1]…[US5]**: historia de la spec.
- **Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` =
  `~/Documentos/Proyectos/Betas/agenda-beta`.

---

## Fase 1: Preparación

- [x] T001 Comprobar que pasan antes de tocar nada: `npm run typecheck` y `npm test` en back/ (la falla previa de `cron.test.mjs` por el aviso de Gmail ya se conoce), `npm run build` y `npm run lint` en front/
- [x] T002 Respaldo de la beta en `~/Documentos/Proyectos/Betas/agenda-beta-respaldo-antes-de-servicios-en-pareja-2026-10-13.tar.gz`, sin `node_modules` ni `dist`

---

## Fase 2: Base (bloquea las historias)

- [x] T003 Crear `back/db/migrations/033_people_per_session.sql` (data-model.md):
  - `alter table services add column people_per_session smallint not null default 1 check (people_per_session between 1 and 3)`;
  - `alter table appointment_clients add column client_access_pending boolean not null default false`;
  - la función y el trigger `appointment_clients_booking_access` (`before insert`, por fila). Pone `true` cuando:
    - la cita es de `source = 'booking_page'` y `created_at = transaction_timestamp()`;
    - el paciente no se creó en esta transacción;
    - el paciente no lo registró el usuario del profesional;
    - no tiene con ese profesional otra cita que ya dé acceso, como principal sin marca o como otro paciente sin marca;
  - el índice `(client_id) where client_access_pending`;
  - comentarios en español, como en la 028 y la 032.
- [x] T004 [P] En `front/src/types/index.ts`: `Service.peoplePerSession: number`, con el comentario «Personas por sesión (1, 2 o 3). Sólo vale si el negocio tiene multiClientAppointments».
- [x] T005 [P] En `front/src/lib/validations/service.ts`: `peoplePerSession: z.number().int().min(1).max(3).optional()`, sin valor por defecto: si no llega, el backend conserva el guardado.
- [x] T006 [P] En `front/src/lib/validations/booking.ts`:
  - `bookingPersonSchema` con `documentId`, `name`, `email` y `phone` y los mismos validadores de hoy (el nombre: «Su nombre»);
  - `extraPatients: z.array(bookingPersonSchema).max(2).default([])` en `publicBookingSchema`;
  - un refine que rechace una cédula repetida (también la de quien reserva) con «Cada persona debe tener su propia cédula.», en la ruta `extraPatients.<i>.documentId`.
- [x] T007 [P] En `front/src/lib/email/templates.ts`:
  - `AppointmentEmailData.bookedBy?: string`;
  - en `bookingCreated`, con `bookedBy`, el texto «{bookedBy} reservó para ti una cita en {negocio}.» en lugar del de hoy.
- [x] T008 Copiar lo compartido con `npm run sync:shared` en back/ y comprobar que `back/src/shared` no se editó a mano
- [x] T009 En `back/src/db/columns.ts`: `serviceColumns` con `peoplePerSession: "people_per_session"`. Aplicar la migración 033 en la base local de pruebas.
- [x] T010 En `back/src/services/business-data-service.ts`: exportar `peopleFor(business, service)` → `business.multiClientAppointments ? service.peoplePerSession : 1`.

**Punto de control**: typecheck y `npm test` pasan; los servicios existentes devuelven `peoplePerSession: 1`.

---

## Fase 3: Historia 1 - El negocio marca un servicio como «en pareja» (P1)

**Objetivo**: con el interruptor, el negocio guarda 1, 2 o 3 personas por servicio. Sin él, todo es
individual y el dato se conserva.

**Prueba independiente**: en un negocio habilitado, guardar 2 en un servicio; apagar el
interruptor y ver que la página recibe 1 y que el servicio conserva 2.

- [x] T011 [US1] En `back/src/services/business-data-service.ts`, al crear y editar servicios:
  - con el interruptor y el campo, guardar `people_per_session`;
  - sin el campo o sin el interruptor, crear con 1 o conservar el valor al editar (D2);
  - revisar también la creación del onboarding (`account-service.ts`), que usa el mismo camino.
- [x] T012 [US1] En `back/src/services/public-booking-service.ts`: que `toPublicService` reciba el negocio y mande `peoplePerSession` con el valor efectivo de `peopleFor` en el perfil público.
- [x] T013 [P] [US1] En `front/src/features/services/service-form-dialog.tsx`:
  - «Personas por sesión», con tres botones («1 · Individual», «2 · Pareja», «3 · Familia») con el estilo de «Modalidad»;
  - sólo si `useCurrentBusiness().data?.multiClientAppointments`;
  - el valor inicial, del servicio o 1;
  - mandar el campo sólo si se muestra.
- [x] T014 [P] [US1] En `front/src/pages/dashboard/services-page.tsx`: comprobar que activar o desactivar un servicio no pierde `peoplePerSession` (si vuelve a enviar todos los campos, incluirlo).

**Punto de control**: escenarios 1.1 a 1.3 de la spec.

---

## Fase 4: Historia 2 - Reservar una sesión de pareja por la página (P1)

**Objetivo**: una reserva de un servicio de N personas crea una sola cita pendiente con todas.
Reconoce a las que existen por su cédula y registra a las nuevas, y cada una recibe su email.

**Prueba independiente**: reservar con una persona existente y otra nueva, y comprobar la cita,
los pacientes y los emails.

- [x] T015 [US2] En `back/src/services/public-booking-service.ts`, sacar de `book()` la función `resolveBookingClient(db, business, person, { label, homeVisit })` con la regla de hoy (cédula, `sameContact`, ficha antigua sin cédula, paciente nuevo con `assertOnlineNewClientLimit` y `assertClientLimit`), sin cambiar el comportamiento con quien reserva.
- [x] T016 [US2] En `book()`:
  - validar el número de personas con `peopleFor` (contracts/api.md: faltan → 400 que pide recargar; sobran o negocio sin habilitar → 400);
  - `documentIdError` en cada cédula;
  - resolver al principal y después a cada otra persona con `resolveBookingClient`;
  - con las otras personas, los mensajes de D4 con su nombre escrito;
  - insertar la cita y llamar a `saveExtraClients(db, appointment, ids, [])` antes de `notifyAppointmentChange`;
  - la auditoría nombra a todos.
- [x] T017 [US2] En `back/src/services/notifications.ts`, en `notifyAppointmentChange`:
  - a cada destinatario que no es el principal, `payment: null` (D9; también en las citas del panel);
  - con `origin === "booking_page"` y sin `before`, `bookedBy` con el nombre del principal en el email de cada otra persona (D8).
- [x] T018 [US2] En `back/src/services/email-limits.ts`: `newPatientEmailHold` cuenta los emails de solicitud y confirmación de las citas con algún paciente nuevo de la página, sea principal u otro paciente (D10).
- [x] T019 [US2] En `back/src/services/public-booking-service.ts`: `findRepeatedBooking` recibe las cédulas de las otras personas y sólo reconoce la reserva si la lista coincide sin importar el orden; vacía en una individual (D11).
- [x] T020 [P] [US2] En `front/src/features/booking/service-step.tsx` y `booking-summary.tsx`: «Para 2 personas» o «Para 3 personas» (ícono `Users`) cuando `peoplePerSession > 1`.
- [x] T021 [US2] En `front/src/features/booking/contact.ts`: `extraPatients` en `ContactValues` y en `EMPTY_CONTACT` (`[]`). En `booking-flow.tsx`:
  - ajustar el largo de `extraPatients` a `peoplePerSession - 1` del servicio elegido;
  - enviarlo en la reserva;
  - pasar los nombres a la pantalla final;
  - `saveContact` sigue guardando sólo a quien reserva.
- [x] T022 [US2] En `front/src/features/booking/details-step.tsx`, un bloque por cada otra persona («Datos de la otra persona», o «Persona 2» y «Persona 3»), con:
  - cédula, nombre, email y teléfono, con los mismos componentes;
  - `FormField` con etiqueta propia;
  - errores por ruta `extraPatients.<i>.*`;
  - `documentIdError` en cada cédula.

  Lugar, dirección y notas, una sola vez.
- [x] T023 [P] [US2] En `front/src/features/booking/confirm-step.tsx`, los datos de cada persona. En `booking-success.tsx`, los nombres de todas («Sesión para Ana Torres y Carlos Pérez»).

**Punto de control**: escenarios 2.1 a 2.8 de la spec, con la API local.

---

## Fase 5: Historia 3 - La página protege los datos de cada persona (P1)

**Objetivo**: nadie averigua ni usa los datos de otra persona, y un profesional con «sólo sus
pacientes» no abre la ficha de la otra persona de una reserva online.

**Prueba independiente**: la reserva con la cédula de otro paciente y otro contacto se rechaza
sin datos. El ataque del profesional no le da acceso hasta que el negocio gestione la cita.

- [x] T024 [US3] En `back/src/services/agenda-scope.ts` (D7):
  - en `ownClientCondition`, la parte de `appointment_clients` exige también `not ownextra.client_access_pending`;
  - `pendingClientCondition` incluye a los otros pacientes con marca;
  - `releaseClientAccess` también pone `client_access_pending = false` en las filas de `appointment_clients` de la cita, con las mismas condiciones (quien actúa no es el profesional de la cita y la cita no está cancelada);
  - actualizar los comentarios.
- [x] T025 [US3] Revisar que ninguna respuesta de la reserva pública devuelve datos de la ficha de una persona: el `clientEmail` de la confirmación sigue siendo sólo el de quien reserva, con `shownEmail`.

**Punto de control**: escenarios 3.1 a 3.4 de la spec.

---

## Fase 6: Historia 4 - Los límites de la página siguen funcionando (P1)

**Objetivo**: los límites por persona, por día y del plan, el reintento y ntfy funcionan con
varias personas.

**Prueba independiente**: con una persona que ya tiene una cita ese día, la reserva se rechaza
con su nombre y sin crear nada.

- [x] T026 [US4] En `back/src/services/public-booking-service.ts`, en `assertClientDailyLimit`:
  - contar las citas del día donde la persona es principal **o** está en `appointment_clients`;
  - aplicarlo a cada persona;
  - con las otras personas, el mensaje de D4.
- [x] T027 [US4] En `back/src/services/booking-alerts.ts` (D12):
  - `OnlineBooking.clients`, una lista con el principal primero, cada uno con `newClient`;
  - la consulta junta `appointment_clients`;
  - una línea por persona en `onlineBookingNotice`;
  - ajustar `tests/booking-alert.test.ts` y agregar un caso con dos personas.

**Punto de control**: escenarios 4.1 a 4.5 de la spec.

---

## Fase 7: Historia 5 - En el panel, el servicio en pareja abre los espacios solo (P2)

**Objetivo**: al elegir un servicio de 2 o 3 personas en el formulario de cita, se abren los
espacios. Si faltan pacientes, se avisa sin bloquear.

**Prueba independiente**: elegir «Terapia de pareja» en una cita nueva, ver «Paciente 2» abierto,
dejarlo vacío y guardar con el aviso.

- [x] T028 [US5] En `front/src/features/appointments/appointment-form-dialog.tsx`:
  - al cambiar de servicio, si `canAddClients` y el servicio es para N > 1, completar `extraClientIds` con `""` hasta N − 1;
  - si los pacientes elegidos son menos que N, mostrar el aviso ámbar del formulario: «Este servicio es para N personas: falta un paciente (o faltan N pacientes). Puedes guardar igual.»;
  - no bloquear el guardado.

**Punto de control**: escenarios 5.1 a 5.3 de la spec.

---

## Fase 8: Pruebas, beta y cierre

- [x] T029 Crear `back/tests/couple-booking.test.ts` con los casos de quickstart.md §1: servicio, reserva en pareja, datos, límites, reintento, emails, pago en el panel, privacidad, ntfy y tope de emails.
- [x] T030 Pasar `npm run typecheck` y `npm test` en back/, y `npm run build` y `npm run lint` en front/
- [x] T031 Recorrido con Playwright en local (quickstart.md §2), en escritorio y a 390 px, con capturas
- [x] T032 Beta (D15), sobre el respaldo de T002:
  - los mismos cambios en tipos, validaciones, plantillas y pantallas;
  - en `src/lib/data/mock/`: `store.ts`, `public-booking-repository.ts`, `business-data-repository.ts`, `helpers.ts` y `notifications.ts`;
  - `services-page.tsx`;
  - `npm run build`, `npm run lint` y un recorrido.
- [x] T033 [P] `back/README.md`: servicios en pareja, la migración 033 y la marca de acceso de cada otra persona
- [x] T034 Commits en back/ y front/ (sin firma de IA). Después, `/speckit-reporte`.

---

## Dependencias

- **Fase 1 → Fase 2 → historias.** La migración, los tipos y la copia compartida bloquean todo.
- **US1** (servicio) va antes que US2 y US5, que leen `peoplePerSession`.
- **US2** (reserva) va antes que US3 y US4, que prueban la reserva en pareja.
- **US5** sólo depende de US1.
- **Fase 8:** T029 cubre US1–US4; T032 (beta) va al final, sobre el front ya terminado.

## En paralelo

- **Fase 2:** T004, T005, T006 y T007 (archivos distintos del front).
- **US1:** T013 y T014 (front), mientras se hacen T011 y T012 (back).
- **US2:** T020 y T023 (front), mientras se hace el backend (T015–T019).
- **US5 (T028):** en cuanto termina US1.

## Estrategia

1. **MVP:** US1 + US2. El negocio marca el servicio y la página reserva en pareja.
2. **US3 y US4 antes de publicar.** Son privacidad y límites (principio II): no se publica sin
   ellas.
3. **US5:** comodidad del panel.
4. **Cierre:** pruebas, recorrido, beta, reporte y commits.
