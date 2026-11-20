# Tareas: Recuperar la contraseña con una contraseña temporal

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Rutas: back/ = agenda-backend, front/ = agenda-front

## Base

- [X] T001 back/db/migrations/061_recuperar_contrasena.sql: la tabla `temporary_passwords` (con RLS) y
  `password_change_required` en users, sessions y login_challenges (`boolean not null default false`)
- [X] T002 [P] front/src/lib/validations/auth.ts, front/src/types/index.ts y front/src/lib/constants/auth.ts:
  `forgotPasswordSchema`, `newPasswordSchema`, `Session.passwordChangeRequired`, el `EmailType` `temporary_password`,
  las constantes y `generateTemporaryPassword()`
- [X] T003 [P] front/src/lib/email/templates.ts: `temporaryPassword` y el texto de temporal en `passwordChanged`,
  `teamInvite`, `platformAdminAdded` y `businessCreated`; `npm run sync:shared` desde back/
- [X] T004 back/src/http/errors.ts y back/src/http/session.ts: `password_change_required` (403) y
  `requirePasswordChanged`, dentro de `requireSignedIn` y en `/push`; back/src/services/auth-service.ts:
  `findSessionByToken` y `getSession` con la marca

## Historia 1 - Recupera su acceso con una contraseña temporal (P1)

- [X] T005 [US1] back/src/services/password-recovery.ts: `request` (topes por email, mismo trabajo sin cuenta, email
  con `secret`, actividad) y `matchTemporary`; `POST /auth/forgot-password` en back/src/routes/auth-routes.ts con
  `limitRequests` y `requireCaptcha`
- [X] T006 [US1] back/src/services/auth-service.ts: `signIn` con la temporal, la marca en la sesión o en el paso del
  código y sin cookie de dispositivo; borrar las temporales al entrar con la de siempre; la limpieza en
  `deleteExpiredSessions`
- [X] T007 [P] [US1] front/src/pages/auth/forgot-password-page.tsx: el formulario con el CAPTCHA, el mensaje de
  siempre y el contacto del soporte

## Historia 2 - Crea su contraseña nueva al entrar (P1)

- [X] T008 [US2] back/src/services/auth-service.ts: `newPassword` (en auth-service por la sesión y la cookie); `POST /auth/new-password` (con la cookie
  de dispositivo nueva) y la barrera en las rutas de /auth que no deben pasar
- [X] T009 [US2] front/src/features/auth/new-password-screen.tsx en front/src/components/layout/admin-layout.tsx y
  dashboard-layout.tsx; front/src/lib/auth (`newPassword`); front/public/early-data.js sin pedir nada con la marca

## Historia 3 - La contraseña que pone el soporte también es temporal (P2)

- [X] T010 [US3] back/src/services/admin-service.ts y accounts.ts: la marca en `setUserPassword` y en las altas, y
  borrar las temporales pendientes
- [X] T011 [P] [US3] front/src/features/admin/set-password-form.tsx (y quien lo abre, con el teléfono): el texto de
  temporal, «Generar una», «Contraseña temporal lista» con «Enviar por WhatsApp» y «Copiar mensaje»;
  `buildTemporaryPasswordMessage` en front/src/lib/whatsapp.ts

## Historia 4 - Cambia su contraseña cuando quiera (P2)

- [X] T012 [US4] back/src/services/auth-service.ts: `changePassword` para cualquier cuenta (no con la sesión marcada),
  borra las temporales y devuelve la cookie de dispositivo; el email según la cuenta
- [X] T013 [P] [US4] front/src/features/settings/change-password-form.tsx en la pestaña Perfil de
  front/src/pages/dashboard/settings-page.tsx

## Historia 5 - El super admin, con su verificación en dos pasos (P1)

- [X] T014 [US5] back/src/services/auth-service.ts (`verifyTwoFactor` con la marca) y
  back/src/services/account-alerts.ts: `session.temporary_login` en `ACCOUNT_CHANGES` y
  `queueOwnPasswordEmail`

## Pruebas y cierre

- [X] T015 back/tests/password-recovery.test.ts y las suites que cambian (change-password del equipo, altas y
  «Cambiar contraseña»); las etiquetas de la actividad en back y front
- [X] T016 [P] front/scripts/check-password-recovery.ts y `check:password-recovery` en package.json
- [X] T017 .specify/memory/constitution.md de los dos repos: 1.52.0 (principio III)
- [X] T018 back: `npm run typecheck` y `npm test`; front: build, lint y todas las `check:*`; recorrido local con
  Playwright
- [X] T019 back/specs/054-recuperar-contrasena/reporte.md

## Orden

- La base (T001–T004) antes que todo. Las historias 1 y 2 van juntas (sin la 2, la temporal no deja usar el panel).
- La 3, la 4 y la 5 dependen de la 2 y son independientes entre sí.
- En paralelo: el front de cada historia ([P]) mientras se hace su backend.
