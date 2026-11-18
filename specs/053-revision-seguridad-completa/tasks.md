# Tareas: Revisión de seguridad completa

**Spec**: [spec.md](spec.md) · Rutas: back/ = agenda-backend, front/ = agenda-front

- [X] T001 Auditoría sin cambios: tres revisores (API, datos y front con despliegue), `npm audit`, `npm outdated`,
  paquetes sin uso y secretos en toda la historia de git de los dos repos.
- [X] T002 back: `src/services/trusted-device.ts`, el tope de 24 horas y el CAPTCHA en `session-security.ts`,
  `auth-service.ts`, `auth-routes.ts` y `http/captcha.ts` («captcha_required»); front: el CAPTCHA en `login-form.tsx`.
- [X] T003 back: `loyalty.ts` (canje), con sus pruebas; front: `redeem-reward-dialog.tsx` y `serviceId` en la recompensa.
- [X] T004 `.npmrc` y `cooldown` de Dependabot en los dos repos.
- [X] T005 back: `app.ts` (tope sin mayúsculas y sin sesión), con su prueba.
- [X] T006 back: tope diario de la 2FA y su aviso (`auth-service.ts`, `account-alerts.ts`), con sus pruebas.
- [X] T007 back: tipo real del archivo en `billing-service.ts` y `clinical-attachment-service.ts`, con sus pruebas.
- [X] T008 back: `patient-accounts.ts` (enlace antes del hash, huella del teléfono, eventos, sesión de 30 días,
  «Cerrar sesión en todos»), `patient-routes.ts`, la alerta de `scheduled-tasks.ts` y la pestaña «Seguridad» del super
  admin; front: «Cerrar sesión en todos» y el tipo `patient_account`.
- [X] T009 front: `public/.well-known/security.txt`.
- [X] T010 front: `zxing-wasm` 3.1.6 declarado; las dos carpetas `node_modules` al día con su lockfile.
- [X] T011 back: `tests/login-protection.test.ts` y las pruebas nuevas en `two-factor`, `security`, `loyalty`, `billing`,
  `clinical-custom` y `patient-accounts`; el navegador de las pruebas guarda varias cookies.
- [X] T012 La prueba de las protecciones contra la API en local y este reporte.
