---

description: "Tareas del endurecimiento de seguridad"
---

# Tareas: Endurecimiento de seguridad

**Entrada**: `specs/009-endurecimiento-seguridad/` (plan aprobado el 2026-10-14).

**Pruebas**:
- **Backend:**
  - suites nuevas: `tests/attempt-limits.test.ts`, `account-alerts.test.ts`, `booking-verify.test.ts`
    y `hardening.test.ts`;
  - suites que se actualizan: `cedula`, `couple-booking`, `booking-alert`, `two-factor`,
    `security-sessions`, `public-abuse` y `cron`.
- **Front y beta:** build, lint y lo que pide el quickstart: el recorrido con Playwright, la CSP con un
  servidor estático local y la prueba del proxy.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front, `beta/` = la beta. Las decisiones R1–R15
están en `research.md`.

## Fase 1: Base

- [x] T001 Constitución 1.6.0, igual en `back/` y `front/` (`.specify/memory/constitution.md`):
  - **Principio II:** el teléfono en ntfy es «***5555».
  - **Principio III:**
    - la reserva con la cédula de un paciente y otros datos queda «Por verificar» (vale para cada
      persona de la sesión; el rol Profesional no une);
    - «Recordarme» dura como mucho 30 días, y 7 para el super admin.
  - **Restricciones de seguridad:**
    - topes de intentos exactos;
    - firma de la IP con caducidad;
    - arranque seguro en la nube.
- [x] T002 Código compartido en `front/` y después `npm run sync:shared` en `back/`:
  - `src/types/index.ts`:
    - `Client.claimedClientId: string | null`;
    - `EmailType` gana `account_security_changed`.
  - `src/lib/validations/fields.ts`: `personNameField(label)` (R13). Es `requiredText` y además
    rechaza saltos de línea, «@», `://`, `www.` y palabras con forma de dominio, con el mensaje
    «Escribe sólo el nombre, sin enlaces ni emails».
  - `booking.ts` (quien reserva y otras personas) y `auth.ts` (nombre y apellido del registro) lo
    usan.
  - `src/lib/email/templates.ts`:
    - `accountSecurityChanged`: la cuenta, qué cambió, cuándo, la IP, el navegador y «Si no fuiste
      tú…»;
    - `bookingReceived`: gana un aviso opcional de «por verificar».
  - `src/features/settings/email-outbox.tsx`: la etiqueta «Seguridad de la cuenta».
- [x] T003 `back/db/migrations/036_security_hardening.sql`:
  - `alter table if exists schema_migrations enable row level security;`
  - `clients.claimed_client_id uuid references clients(id) on delete set null`, con el check
    `claimed_client_id is null or (document_id = '' and claimed_client_id <> id)` y el índice
    parcial `clients_claimed_idx`.
- [x] T004 `back/src/config.ts`:
  - `TWO_FACTOR_KEY`: texto, mínimo 32, opcional. `config.twoFactorKey` usa una clave fija de
    desarrollo con la base local y vale null en otro caso.
  - `PUBLIC_EMAILS_PER_DAY`: entero de 1 o más, 150 por defecto.

## Fase 2: Historia 1 - Topes de intentos exactos (P1)

- [x] T005 [US1] `back/src/services/session-security.ts`: `reserveAttempt(email, ip, userId)` (R1).
  - **Cuenta:** `incrementCounter` con las claves `acceso:cuenta-ip:<sha256 email>:<ip>` (10),
    `acceso:ip:<ip>` (50) y `acceso:cuenta:<sha256 email>` (30, sólo si la conexión no es
    conocida), con 15 min de ventana. La IP es la de `ipKeyGenerator(ip, 64)`.
  - **Devuelve:** si quedó bloqueado, y `succeeded()`, que borra las claves de la cuenta y resta 1 a
    la de la IP.
  - **`isLockedOut`** se queda como está.
- [x] T006 [US1] `back/src/services/auth-service.ts`:
  - `signIn` reserva el intento antes de bcrypt.
  - `verifyTwoFactor` hace lo mismo y además suma el intento del paso de forma atómica, antes de
    comprobar el código: `update login_challenges set attempts = attempts + 1 where id = $1 and
    attempts < 5 and expires_at > now() returning attempts`.
- [x] T007 [US1] Comprobaciones con la sesión abierta (R2):
  - `changePassword` (`back/src/services/auth-service.ts`);
  - `userService.update` al cambiar el email (`back/src/services/account-service.ts`);
  - `disable` y `regenerateRecoveryCodes` (`back/src/services/two-factor.ts`).

  Cada una reserva el intento. Si falla, registra `session.login_failed` con su resumen. Si está
  bloqueada, responde `lockedOutError()`.
- [x] T008 [US1] `back/tests/attempt-limits.test.ts` (quickstart §1). Revisar que
  `tests/security.test.ts` y `tests/passwords.test.mjs` sigan pasando.

## Fase 3: Historia 2 - Avisos de cambios en cuentas de super admin (P1)

- [x] T009 [US2] `back/src/services/account-alerts.ts` (nuevo, R3):
  - **`queueAccountSecurityEmail(db, user, change, connection)`:** pone en cola el email a la cuenta
    y al principal (`platform_owner`), uno solo si son el mismo, con `businessId: null`.
  - **`findAccountChanges(db, since, until, limit = 10)`:** busca en `audit_logs` las acciones
    `session.two_factor_enabled`, `two_factor_disabled`, `two_factor_reset` y `password_changed`, y
    `platform.user_password_changed`, de cuentas `super_admin`.
  - **`accountChangeNotice`:** arma el aviso, con el título «Agenda360: cambio en una cuenta de super
    admin», `maskEmail` y prioridad 4.
- [x] T010 [US2] Usarlo al cambiar algo:
  - `enable` y `disable` (`back/src/services/two-factor.ts`) ponen el email en cola;
  - `changePassword` (`back/src/services/auth-service.ts`) registra `session.password_changed` con IP
    y navegador, y pone el email en cola.
- [x] T011 [US2] `back/src/jobs/scheduled-tasks.ts` y `back/scripts/cron.ts`:
  - `accountChanges` en el informe, con los avisos, el tope de 10 y la cifra del resto;
  - la línea del registro dice «cambios de cuenta: N»;
  - `EMAIL_GROUPS` gana el tipo nuevo.
- [x] T012 [US2] `back/tests/account-alerts.test.ts` (quickstart §1) y la línea nueva en
  `back/tests/cron.test.mjs`.

## Fase 4: Historia 3 - Reserva «Por verificar» (P1)

- [x] T013 [US3] `back/src/db/columns.ts`: `clientColumns` gana
  `claimed_client_id as "claimedClientId"`.
- [x] T014 [US3] `back/src/services/public-booking-service.ts` (R4, R14):
  - **`resolveBookingClient`:** con `found` y sin `sameContact`, deja de lanzar 403. Primero busca un
    paciente aparte para esa ficha con los mismos datos (`claimed_client_id = found.id` y
    `sameContact`) y, si no lo hay, lo crea como uno nuevo: mismos topes, `document_id = ''`,
    `source = 'booking_page'` y `claimed_client_id = found.id`.
  - **`findRepeatedBooking`:** reconoce también la cédula de la ficha reclamada.
  - **Cliente antiguo sin cédula:** exige además el teléfono (`comparablePhone`).
  - **Comentario de cabecera y `UNCONFIRMED_IDENTITY_MESSAGE`:** se actualizan o se quitan.
- [x] T015 [P] [US3] Avisos de la reserva:
  - `back/src/services/notifications.ts`: `booking_received` lleva el aviso de «por verificar» si
    alguna persona de la cita lo está;
  - `back/src/services/booking-alerts.ts`: `findOnlineBookings` y `onlineBookingNotice` añaden «· Por
    verificar (la cédula es de un paciente con otros datos)».
- [x] T016 [US3] Unir a la ficha (R5):
  - **Servicio:** `clientService.confirmClaim(ctx, businessId, clientId, input)` en
    `back/src/services/business-data-service.ts`.
    - Permiso `clients.manage`; el rol Profesional recibe 403 con «Pide a recepción o al propietario
      que la revise».
    - Da 409 si no está por verificar, si la ficha ya no existe o si tiene historia clínica.
    - Mueve las citas y las filas de `appointment_clients`, quitando la sobrante si la ficha ya
      estaba.
    - Si se pide, copia el email y el teléfono a la ficha.
    - Borra el paciente aparte y registra `client.claim_confirmed`.
  - **Ruta:** `POST /:businessId/clients/:clientId/confirm-claim` en
    `back/src/routes/business-routes.ts`.
- [x] T017 [US3] Pruebas:
  - `back/tests/booking-verify.test.ts` (quickstart §1);
  - pasar el 403 de identidad a «por verificar» en `back/tests/cedula.test.mjs`,
    `couple-booking.test.ts` y `booking-retry.test.ts`, si lo comprueba;
  - en `hardening.test.ts`, los nombres con enlaces.
- [x] T018 [US3] Front:
  - **Datos:**
    - `src/lib/data/repository.ts` y `api-repository.ts`: `clients.confirmClaim(businessId, clientId,
      { updateEmail, updatePhone })`;
    - `src/hooks/queries/use-clients.ts`: `useConfirmClaim`, que refresca pacientes y citas.
  - **`src/components/shared/verify-badge.tsx` (nuevo):** la marca «Por verificar», con icono y
    texto, al estilo de `ReceiptBadge` y en tono ámbar.
  - **`src/features/appointments/claim-review.tsx` (nuevo):**
    - el aviso «La cédula es de {ficha}, pero el email y el teléfono no coinciden con su ficha», sin
      nombre si no está en la lista;
    - el botón «Es el mismo paciente: unir a su ficha», con un diálogo y casillas para actualizar el
      email y el teléfono;
    - para el rol Profesional, el texto «Lo revisa recepción o el propietario».
  - **Dónde se usa:**
    - `appointment-details-sheet.tsx` (cabecera y aviso);
    - `features/calendar/time-grid-view.tsx` y `agenda-list-view.tsx`;
    - `appointment-list-item.tsx`;
    - `pages/dashboard/client-detail-page.tsx`, con la marca y el aviso en la ficha del paciente.

## Fase 5: Historia 4 - Los recordatorios siempre salen (P2)

- [x] T019 [US4] `back/src/services/email-limits.ts` (R11):
  - `THIRD_PARTY_EMAIL_TYPES` gana `appointment_pending`, `appointment_completed` y
    `appointment_no_show`;
  - **tope nuevo del público** (`config.publicEmailsPerDay`): cuenta la bienvenida y los emails de
    citas `booking_page` creados en su misma transacción (`n.created_at = a.created_at`). Sólo frena
    esos emails, con su aviso por ntfy una vez al día;
  - **el tope total** sigue como está.
- [x] T020 [US4] `back/tests/public-abuse.test.ts`: con el tope del público alcanzado, las reservas
  se frenan y el recordatorio y el aviso de cambio de estado salen.

## Fase 6: Historia 5 - Sesiones y secretos (P2)

- [x] T021 [US5] `back/src/services/auth-service.ts` (R6):
  - **`createSession`:** con «Recordarme», `now() + 14 días`, o 7 para el super admin.
  - **`findSessionByToken`:** exige `not remember or created_at > now() - tope` y renueva con
    `least(created_at + tope, now() + 14 días)`. El tope es de 30 días, o 7 para `super_admin`.
- [x] T022 [US5] Cifrado del secreto (R7):
  - **`back/src/services/secret-box.ts` (nuevo):** `sealSecret` y `openSecret`, con AES-256-GCM, la
    clave sha256 de `TWO_FACTOR_KEY` y el formato `v1.<base64url>`; lee el base32 en claro de antes.
  - **`back/src/services/two-factor.ts`:**
    - `setup` guarda el secreto cifrado;
    - `enable` y `verifySecondFactor` lo leen con `openSecret`;
    - con el código correcto, un secreto en claro se vuelve a guardar cifrado.
  - **Sin clave fuera de la base local:** error claro.
- [x] T023 [US5] Respuestas públicas sin cookie (R10):
  - `back/src/app.ts`: `/public` se monta antes de `loadSession`, con `req.ctx` vacío;
  - front: `src/lib/api/client.ts` usa `credentials: "omit"` en `/public/*`, y `public/early-data.js`
    también.
- [x] T024 [US5] Firma de la IP (R8):
  - **Backend:**
    - `back/src/http/secrets.ts`: `verifyClientIpSignature(ip, ts, sig)`, con HMAC-SHA256 de
      `<ip>.<ts>`, ±120 s y tiempo constante;
    - `back/src/http/client-ip.ts`: acepta la firma o el secreto de hoy;
    - `back/src/app.ts`: la guarda de Lambda acepta lo mismo.
  - **Front, `middleware.ts`:** borra las `x-agendo-*` que llegan y manda `x-agendo-client-ip`,
    `x-agendo-client-ts`, `x-agendo-client-sig` (Web Crypto) y, en la fase 1, `x-agendo-proxy-secret`.
- [x] T025 [US5] Pruebas:
  - `back/tests/hardening.test.ts`: sesiones, secreto, respuestas públicas y firma;
  - ajustar `back/tests/two-factor.test.ts` (el secreto, de la respuesta de `setup`) y
    `security-sessions.test.ts`.

## Fase 7: Historia 6 - La API no arranca desprotegida en la nube (P2)

- [x] T026 [US6] `back/src/config.ts` (R9):
  - con `hosted`, si falta algo de la lista, `console.error("Configuración insegura para la nube:
    falta …")` sin valores y `process.exit(1)`;
  - `back/src/http/session.ts`: `secure` también con `config.hosted`;
  - prueba en `hardening.test.ts`: arrancar con `VERCEL=1` quitando cada variable.

## Fase 8: Historia 7 - Cada uno recibe sólo lo que necesita (P2)

- [x] T027 [US7] Datos de más (R12):
  - `back/src/services/activity-service.ts`: la bandeja excluye `plan_change_requested`;
  - `back/src/services/professional-service.ts` `list`: para el rol Profesional, `email: ""`,
    `meetingUrl: ""` y `bankAccounts: []` en las agendas que no son la suya (también el `bankAccount`
    deprecado);
  - `back/src/services/account-service.ts` `getById`: `two_factor_required` si es otro usuario;
  - pruebas en `hardening.test.ts`.

## Fase 9: Historia 8 - El front avisa, informa y carga sólo lo suyo (P3)

- [x] T028 [P] [US8] Front:
  - **Cerrar sesión:** `src/components/layout/use-sign-out.ts`, con try/catch, el toast de error y
    «Reintentar»; `src/pages/onboarding-page.tsx` usa el hook.
  - **`src/pages/privacy-page.tsx`:**
    - Nominatim (Fundación OpenStreetMap) y Vercel Analytics en la sección 7;
    - nueva fecha de `LAST_UPDATED`.
  - **`vercel.json`:** `img-src 'self' data: blob: https://owrmbzomwufznfjnyada.supabase.co`.

## Fase 10: Historia 9 - Registros públicos y ntfy (P3)

- [x] T029 [P] [US9] Registros públicos y ntfy:
  - `back/.github/workflows/backup.yml`: `BACKUP_EMAIL: ${{ secrets.BACKUP_EMAIL || vars.BACKUP_EMAIL }}`;
  - `back/.github/workflows/deploy-lambda.yml`: `if: github.ref == 'refs/heads/main' && …`, y el ARN
    del rol con `secrets.… || vars.…`;
  - `back/src/services/masking.ts` `maskPhone`: «***» y los últimos 4 dígitos;
  - `back/tests/booking-alert.test.ts`: ajustar el formato.

## Fase 11: Beta, comprobación y cierre

- [x] T030 Beta, sólo «Por verificar» (en `beta/`):
  - **Tipos:** `Client.claimedClientId`.
  - **`src/lib/data/mock/public-booking-repository.ts`:** crea el paciente aparte en vez de lanzar
    `forbidden`; el cliente antiguo exige también el teléfono.
  - **Repositorio de pacientes:** `confirmClaim`.
  - **Interfaz:** la marca y la revisión del front, adaptadas a su ficha de la cita.

  Antes, guardar una copia de su código. Después, build y lint.
- [x] T031 Comprobar:
  - back: `npm run typecheck` y `npm test`;
  - front: `npm run build` y `npm run lint`;
  - el recorrido de Playwright del quickstart §2, en escritorio y a 390 px;
  - la CSP con un servidor estático local (§3);
  - la prueba del proxy con `middleware.ts` (§3);
  - la beta en el 3199 (§4).
- [x] T032 Cierre:
  - README del backend: variables nuevas, lo obligatorio en la nube, «Por verificar», los topes de
    emails y la firma del proxy;
  - commits sin firma de IA;
  - después, `/speckit-reporte`.

## Después de publicar (fuera de esta entrega)

- **Fase 2 de la firma (R8).** Es un cambio pequeño, sin spec:
  1. el front deja de mandar `x-agendo-proxy-secret`, y se publica;
  2. el backend deja de aceptarlo, y se publica.

## Dependencias

- T001–T004 primero. T002 va antes de cualquier tarea que use tipos, validaciones o plantillas.
- **US1:** T005 → T006 → T007 → T008.
- **US2:** T009 → T010 → T011 → T012. Depende de T005–T007, porque toca los mismos archivos.
- **US3:** T013 → T014 → T015 y T016 → T017 → T018. Necesita la migración (T003).
- **US4–US9** son independientes entre sí. Comparten archivos con:
  - **US1:** T021 (`auth-service.ts`);
  - **US2:** T022 (`two-factor.ts`);
  - **US6:** T024 (`app.ts`).

  Esas tareas se hacen una detrás de otra.
- **La beta (T030)** va después de T018.
- **T031 y T032**, al final.

## Paralelo

- **[P] reales:**
  - T015 (avisos) mientras se hace T016;
  - T028 (front, archivos propios) y T029 (workflows y masking) en cualquier momento después de la
    fase 1.
- **La beta (T030)** puede hacerla un agente aparte cuando T018 esté terminada.

## Estrategia

1. **MVP:** historias 1, 2 y 3 (P1), que son los tres puntos de gravedad media. Con ellas ya se
   cierran los riesgos principales.
2. **Después:** las P2 (4 a 7) y las P3 (8 y 9).
3. **Al final:** beta, comprobación, README y reporte.
4. **Se publica todo junto,** en el orden del plan: variables, migración, backend y front.
