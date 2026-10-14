# Plan de implementación: Servicios en pareja o familia y su reserva online (fase 2)

**Rama**: `dev` · **Fecha**: 2026-10-13 · **Spec**: [spec.md](./spec.md) (aprobada 2026-10-13)

**Documentos**: [research.md](./research.md) (decisiones D1–D16) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

Cada servicio podrá ser para 1, 2 o 3 personas, sólo en los negocios que el super admin habilite.
Si es para 2 o 3, la página de reservas pide los datos de cada persona y crea una sola cita con
todas.

- **Datos (migración 033):**
  - `services.people_per_session`, de 1 a 3, por defecto 1;
  - una marca de acceso pendiente por cada otra persona de la cita
    (`appointment_clients.client_access_pending`), con su trigger.
- **Reserva pública:**
  - el cuerpo gana `extraPatients`;
  - cada persona se reconoce por su cédula con la regla de hoy, y las que no existen se registran;
  - todo en una transacción, con los límites por persona y el reintento.
- **Avisos:**
  - cada persona recibe su email, y el de las otras dice quién reservó;
  - los datos de pago van sólo al principal, también en las citas del panel;
  - el aviso por ntfy nombra a todos.
- **Privacidad:** una persona que llega como «otra paciente» de una reserva online no abre su ficha
  a un profesional con «sólo sus pacientes» hasta que el negocio gestione la cita. Es el mismo
  cierre de la migración 028.
- **Front:**
  - «Personas por sesión» en el formulario de servicios;
  - en la página, el bloque de la otra persona y los nombres en la confirmación y en la pantalla
    final;
  - en el formulario de cita, los espacios que se abren solos y un aviso que no bloquea.
- **Beta:** lo mismo.
- **Constitución 1.3.0** en los dos repos (D16).

**Decisiones del dueño del producto que se toman como aprobadas** (pidió seguir con el plan sin
objetarlas):
1. en el panel, un aviso y no un bloqueo;
2. se puede compartir email o teléfono;
3. los datos de pago van sólo al paciente principal, también en las citas del panel.

## Contexto técnico

**Lenguaje/versión**: TypeScript. Backend con Node, que ejecuta `.ts` directamente; front con
React 19.

**Dependencias principales**: Express 5 y PostgreSQL (backend); React, TanStack Query, Tailwind v4
y shadcn/Radix (front). **Ninguna dependencia nueva.**

**Almacenamiento**: PostgreSQL (Supabase en producción). La migración 033 trae una columna en
`services` y una columna con su trigger en `appointment_clients`. En la beta, su base en el
navegador (`localStorage`).

**Pruebas**:
- backend: `npm test` (PostgreSQL desechable, con `tests/couple-booking.test.ts` nueva) y
  `npm run typecheck`;
- front: `npm run build` y `npm run lint`;
- recorrido con Playwright en local, también a 390 px;
- beta: `npm run build`, `npm run lint` y un recorrido.

**Plataforma**: web. La página de reservas es pública y se usa sobre todo desde el celular.

**Tipo de proyecto**: aplicación web en dos repos, más la beta.

**Objetivos de rendimiento**:
- una reserva en pareja hace, como mucho, el triple de búsquedas de paciente que una individual,
  dentro de la misma transacción, y se nota igual de rápida;
- encola a lo sumo 3 emails a pacientes, 1 copia y 1 aviso al negocio.

**Restricciones**:
- privacidad: la página nunca muestra ni completa datos de una ficha; los mensajes nombran a la
  persona como la escribió quien reserva; ntfy va enmascarado;
- los límites de hoy no se debilitan;
- un front anterior en caché no rompe nada: sin el campo, el servicio conserva su valor; con un
  servicio en pareja, la reserva pide recargar.

**Escala**: unos 10 archivos del backend, unos 15 del front y los mismos de la beta.

## Comprobación contra la constitución (1.3.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Interfaz, mensajes, emails, specs y commits en español. |
| II. Privacidad | Sí | Cada persona se reconoce con la regla de hoy (cédula y email o teléfono), sin mostrar datos de su ficha. D7 cierra el acceso de un profesional con «sólo sus pacientes» a la otra persona. ntfy va enmascarado. «Recordar mis datos» guarda sólo a quien reserva. |
| III. Decisiones | Sí | Ver la lista después de esta tabla. |
| IV. Local | Sí | Pruebas, migración y recorridos en la base local. Nada en Vercel ni en Supabase. |
| V. Compartido | Sí | `Service`, `serviceSchema`, `publicBookingSchema` y `AppointmentEmailData` se editan en el front y se copian con `npm run sync:shared`. |
| VI. Barato | Sí | Sin servicios ni dependencias nuevas. Todo pasa en la petición de la reserva, como hoy. |
| VII. Diseño | Sí | `FormField`, los botones de «Modalidad» y el aviso ámbar que ya existen. Primero el celular, cada campo con su etiqueta y sin desplazamiento a 390 px. |

**Decisiones de producto vigentes (principio III) que se respetan:**
- **Cédula:** los pacientes se identifican por cédula dentro del negocio. La reserva online no
  muestra datos de nadie y siempre pide nombre, email y teléfono, ahora de cada persona.
- **Máximo 3 pacientes por cita**, sólo con el interruptor del super admin. El negocio no lo cambia.
- **Copia al profesional:** sale una vez, también la de los recordatorios desde el 2026-10-13.
- **Historia clínica individual.**

**Cambio de la constitución (D16, versión 1.3.0, en los dos repos):**
- se corrige la línea de la copia, que ahora incluye los recordatorios;
- se agrega la decisión de esta fase.

Se hace al aprobar este plan.

**Sin excepciones**: la tabla de complejidad no aplica.

## Diseño

1. **Datos** ([data-model.md](./data-model.md)). La migración 033 trae:
   - `services.people_per_session` (1–3, por defecto 1);
   - `appointment_clients.client_access_pending`, con su trigger de inserción y su índice.
2. **Servicios** (D1, D2):
   - `serviceColumns` lee el nuevo campo;
   - crear y editar aceptan `peoplePerSession` sólo con el interruptor; si no llega, se conserva el
     guardado;
   - un ayudante `peopleFor(business, service)` da el valor efectivo;
   - `toPublicService` manda ese valor efectivo.
3. **Reserva pública** (`public-booking-service.ts`, D3–D6, D11):
   - se valida el número de personas contra `peopleFor`;
   - se saca `resolveBookingClient()` (la regla de hoy) y se llama para cada persona;
   - `assertClientDailyLimit` cuenta participaciones y nombra a la persona;
   - se inserta la cita, después `saveExtraClients` y después los avisos;
   - `findRepeatedBooking` compara también las cédulas de las otras personas.
4. **Privacidad** (`agenda-scope.ts`, D7): `ownClientCondition`, `pendingClientCondition` y
   `releaseClientAccess` tienen en cuenta la marca de cada otra persona.
5. **Avisos** (`notifications.ts`, `email-limits.ts`, plantillas, D8–D10):
   - `bookedBy` en la solicitud de las otras personas;
   - `payment: null` para quien no es el principal;
   - el tope de emails a pacientes nuevos cuenta a todas las personas.
6. **ntfy** (`booking-alerts.ts`, D12): una línea por persona.
7. **Página de reservas** (front, D13):
   - «Para N personas» en la tarjeta y en el resumen;
   - el bloque de cada otra persona en «Tus datos», con validación por persona y cédulas distintas;
   - las personas en la confirmación y en la pantalla final.
8. **Panel** (front, D14):
   - «Personas por sesión» en el formulario de servicios;
   - los espacios que se abren solos y el aviso ámbar en el formulario de cita.
9. **Beta** (D15): los mismos cambios sobre su repositorio de prueba, con un respaldo antes.

## Estructura

### Documentación (esta función)

```text
specs/005-servicios-en-pareja/
├── spec.md          aprobada
├── plan.md          este archivo
├── research.md      decisiones D1–D16
├── data-model.md    migración 033 y tipos
├── contracts/api.md cambios de la API, errores y emails
├── quickstart.md    cómo comprobarlo en local
├── checklists/requirements.md
└── tasks.md         (lo crea /speckit-tasks)
```

### agenda-backend

```text
db/migrations/033_people_per_session.sql        NUEVO: columna del servicio, marca por persona y trigger
src/db/columns.ts                                serviceColumns (peoplePerSession)
src/services/business-data-service.ts           guardar servicios sin pisar el campo; peopleFor
src/services/public-booking-service.ts          extraPatients, resolveBookingClient, límite por persona, reintento, perfil público
src/services/agenda-scope.ts                     acceso pendiente de cada otra persona
src/services/notifications.ts                    bookedBy y pago sólo al principal
src/services/email-limits.ts                     tope de emails a todas las personas nuevas
src/services/booking-alerts.ts                   ntfy con una línea por persona
src/services/audit.ts (si hace falta)            el resumen de la reserva nombra a todos
src/shared/**                                    sólo con npm run sync:shared
tests/couple-booking.test.ts                     NUEVO
tests/booking-alert.test.ts                      el aviso con varias personas
README.md                                        servicios en pareja y la migración 033
.specify/memory/constitution.md                  1.3.0
```

### agenda-front

```text
src/types/index.ts                               Service.peoplePerSession (compartido)
src/lib/validations/service.ts                   peoplePerSession opcional (compartido)
src/lib/validations/booking.ts                   extraPatients y cédulas distintas (compartido)
src/lib/email/templates.ts                       bookedBy en la solicitud (compartido)
src/features/services/service-form-dialog.tsx    «Personas por sesión»
src/features/booking/service-step.tsx, booking-summary.tsx   «Para N personas»
src/features/booking/contact.ts                  extraPatients en el estado del formulario
src/features/booking/details-step.tsx            bloque de cada otra persona
src/features/booking/confirm-step.tsx            datos de cada persona
src/features/booking/booking-success.tsx         nombres de todos
src/features/booking/booking-flow.tsx            pasa las personas al enviar y a la pantalla final
src/features/appointments/appointment-form-dialog.tsx   espacios que se abren solos y el aviso
.specify/memory/constitution.md                  1.3.0
```

### agenda-beta (sin git; respaldo antes de empezar)

- **Los archivos compartidos y de la página de reservas:** se copian del front donde son
  idénticos. Los que tienen diferencias se editan a mano.
- **`src/lib/data/mock/`:**
  - `store.ts`: `migrateData` con `peoplePerSession ??= 1`;
  - `public-booking-repository.ts`: las otras personas, los límites y el acceso pendiente por
    persona;
  - `business-data-repository.ts`: guardar el servicio sin pisar el campo;
  - `helpers.ts`: alcance;
  - `notifications.ts`: el pago sólo al principal y `bookedBy`.
- **`src/pages/dashboard/services-page.tsx`:** `toggleActive` manda el campo.

## Publicación

1. **Migración primero.** La aplica el dueño del producto en Supabase, como paso aparte y antes de
   publicar el backend:
   ```
   npm run db:migrate
   ```
2. **PR `dev` → `main` de agenda-backend.** Incluye:
   - el enlace a `reporte.md` y el aviso de la migración 033;
   - la copia de los recordatorios (`acef223`), si aún no se publicó.
3. **PR `dev` → `main` de agenda-front.** Si el backend sale primero, nada se rompe:
   - el panel no muestra el campo;
   - la página manda reservas individuales;
   - un servicio en pareja no existe hasta que el negocio lo marque, y para eso necesita el front
     nuevo.
4. **Después:** en el negocio habilitado, el profesional marca sus servicios en pareja o familia.

## Riesgos

- **Front anterior en caché con un servicio en pareja.** La reserva responde 400 y pide recargar.
  El front ya se recarga solo cuando hay una versión nueva.
- **Datos de pago en las citas del panel.** Las personas que no son la principal dejan de
  recibirlos (decisión 3). Es un cambio respecto a la fase 1 y queda en el reporte.
- **Un profesional que confirma su propia reserva online.** Como hoy, eso no le da acceso a las
  fichas: lo tiene que gestionar alguien más del negocio.
- **Límite por persona.** Ahora también cuenta las citas en las que la persona es otra paciente.
  Alguien que ya tiene una sesión de pareja ese día no puede reservar otra individual por la
  página (si el límite es 1).
