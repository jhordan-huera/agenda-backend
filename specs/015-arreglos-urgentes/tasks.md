---

description: "Tareas de «Arreglos urgentes de la plataforma»"
---

# Tareas: Arreglos urgentes de la plataforma

**Entrada**: `specs/015-arreglos-urgentes/`. El dueño del producto aprobó el plan el 2026-10-15
(«procede»), con el alcance reducido: la copia de los archivos y los términos quedan aplazados.

**Pruebas:**
- **Backend:**
  - suite nueva: `tests/email-quota.test.ts`;
  - suites que se actualizan: las que miraban el tope de 400 (`public-abuse` y otras), las del admin
    y `cron`.
- **Front:** build, lint y el recorrido del quickstart §2.
- **Beta:** build y lint.

**Rutas:**
- `back/` = agenda-backend;
- `front/` = agenda-front;
- `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta`.

Las decisiones R1–R7 están en `research.md`.

## Fase 1: Base

- [x] T001 Constitución 1.12.0 en `back/` y `front/`:
  - la copia al profesional puede esperar, pero nunca se descarta;
  - el cupo de Gmail con tres niveles, en las restricciones.
- [ ] T002 `back/db/migrations/042_plan_since.sql`: `subscriptions.plan_since timestamptz not null`,
  rellenada con `coalesce(current_period_end - interval '30 days', <alta del negocio>)` (data-model).
- [ ] T003 [P] `back/src/config.ts`: `EMAIL_DAILY_QUOTA` (500), `EMAIL_TEAM_RESERVE` (20) y
  `EMAIL_PATIENT_RESERVE` (100), validadas: enteros, con las reservas menores que el cupo. Y en
  `.env.example`.

## Fase 2: Historia 1 - Los recordatorios no se pierden por el tope de Gmail (P1)

- [ ] T004 [US1] `back/src/services/email-limits.ts`:
  - `EMAIL_PRIORITY`: el nivel (`team`, `patient` o `business`) de cada `EmailType`, con la tabla de
    R2;
  - quitar `thirdPartyEmailHold` (el tope de 400 que marcaba `failed`) y `config.thirdPartyEmailsPerDay`;
  - dejar como están `publicEmailHold` (spec 009) y `newPatientEmailHold`.
- [ ] T005 [US1] `back/src/services/notifications.ts`: `queueEmail`, sin el tope de 400. Las defensas
  de la spec 009 siguen donde estaban.
- [ ] T006 [US1] `back/src/services/mailer.ts`:
  - **`claimBatch`:** cuenta los `sent` de las últimas 24 h y toma por nivel, con sus límites (equipo:
    el cupo; paciente: el cupo menos la reserva del equipo; negocio: el cupo menos la reserva del
    paciente), y dentro de cada nivel los más antiguos.
  - **Lo que no cabe:** `next_attempt_at = now() + 30 min`, sin sumar el intento.
  - **Recordatorios tardíos:** el de una cita que ya empezó se descarta («La cita ya pasó»).
  - **Al llegar al límite del paciente:** «Agenda360: se llegó al cupo de Gmail», una vez al día con
    `alertOnce`, sólo con cifras.
- [ ] T007 [US1] `back/src/services/admin-service.ts`: `getStats.emailQuota` (`quota`, `sent24h`,
  `patientLimit`, `waiting: { patient, business }`). En el front: `src/types/index.ts` y la tarjeta de
  Salud de `admin-overview-page.tsx` (ámbar desde el 80 % del cupo, rojo al llegar al límite del
  paciente, y los que esperan).
- [ ] T008 [US1] `back/tests/email-quota.test.ts` (nueva): el quickstart §1. También se actualizan las
  suites que miraban el tope de 400.

## Fase 3: Historia 2 - La política de privacidad dice la verdad (P1)

- [ ] T009 [P] [US2] `front/src/pages/privacy-page.tsx`: los textos de R4 (semanal, portabilidad,
  borrado y avisos de cambios, sin «términos del servicio»). Anotar en el reporte cada frase cambiada.
- [ ] T010 [P] [US2] `front/src/features/auth/register-form.tsx`: «Al crear tu cuenta aceptas la
  política de privacidad», con su enlace.

## Fase 4: Historia 3 - Datos correctos para el super admin (P2)

- [ ] T011 [US3] `back/src/services/subscriptions.ts` y `business-factory.ts`: `plan_since = now()` al
  cambiar de plan y al crear el negocio. `admin-service.ts`:
  - `planSince` en la ficha;
  - `nearLimit` con la misma regla que `plan-limits.ts` (una función compartida);
  - el reparto por plan, sólo los activos.

  En el front: «En {plan} desde el {fecha}» en `admin-business-detail-page.tsx`, sin «Renueva el…».
- [ ] T012 [US3] Las pruebas del admin: `planSince`, `nearLimit` (con un paciente de una reserva falsa
  sin citas activas que no cuenta) y el reparto por plan con un negocio suspendido.

## Fase 5: Documentación, beta y cierre

- [ ] T013 [P] READMEs del backend y del front:
  - el cupo de Gmail;
  - las correcciones de R6: Suscripción, MRR, las imágenes, el formato por servicio, los colores y
    el comentario de `ClinicalProfile`.
- [ ] T014 Comprobación:
  - `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`;
  - `front/`: `npm run build` y `npm run lint`;
  - el recorrido del quickstart §2 (API en el 4180, preview en el 5199, detenidos por PID).
- [ ] T015 Beta (copia previa `beta-src-antes-015.tgz`): la política y el registro, copiados del front.
  Después, `npm run build` y `npm run lint`.
- [ ] T016 Cierre: `reporte.md`, el estado de la spec y los commits sin firma de IA.

## Dependencias

- T002 y T003, antes que todo.
- T004 → T005 → T006 → T007 y T008.
- T011 → T012.
- T009, T010 y T013 son independientes.
- La beta (T015), después de T009 y T010.
