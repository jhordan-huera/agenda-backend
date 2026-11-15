# Tareas: Lo que quedó de la revisión de seguridad

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Rutas: back/ = agenda-backend, front/ = agenda-front

## Historia 1 - La lista de espera (P1)

- [X] T001 [US1] back/src/services/waitlist-service.ts: desde la página de reservas, `saveEntry` no cambia el nombre ni
  el teléfono de una espera abierta; el saludo y la actividad con el nombre guardado
- [X] T002 [US1] back/tests/waitlist.test.ts: otro nombre y teléfono, la espera del equipo y el panel que corrige
  (comprobado: sin el arreglo fallan 4)

## Historia 2 - Lo que ya no se usa (P1)

- [X] T003 [US2] back/src/routes/business-routes.ts y back/src/services/account-service.ts: quitar `/professional`
- [X] T004 [US2] back/tests/smoke.test.mjs: `/professionals` en vez de `/professional`, y `/professional` da 404
- [X] T005 [P] [US2] front/src/types/index.ts: `PublicWaitlistEntry` y `PublicSurvey` como uniones; `npm run sync:shared`
- [X] T006 [US2] back/src/services/waitlist-service.ts y back/src/services/surveys.ts: lo que devuelve cada caso
- [X] T007 [US2] front/src/pages/waitlist-page.tsx, front/src/pages/survey-page.tsx y
  front/src/features/booking/booking-flow.tsx: sin «Lo que pediste», sin el nombre y sin rellenar
- [X] T008 [US2] back/tests/waitlist.test.ts y back/tests/surveys.test.ts: los enlaces cerrados

## Historia 3 - La dirección sin enlaces (P2)

- [X] T009 [US3] front/src/lib/validations/fields.ts y booking.ts: `LINK_PATTERNS` y `publicHomeVisitSchema`;
  `npm run sync:shared`
- [X] T010 [US3] back/tests/security.test.ts: con y sin enlaces, el panel con enlace y 2 MB al momento

## Historia 4 - Los comprobantes (P2)

- [X] T011 [US4] back/src/services/file-storage.ts: `fileInfo` con el `mimetype` de Supabase
- [X] T012 [US4] back/src/services/payment-service.ts: `completeUpload` rechaza otro tipo
- [X] T013 [US4] back/tests/payments.test.ts: un Supabase de mentira con la foto guardada como `text/html`

## Historia 5 - Contraseñas, peticiones, cabeceras y GitHub (P3)

- [X] T014 [US5] back/src/services/accounts.ts y back/src/services/auth-service.ts: costo 12, `needsRehash` y el hash
  ficticio nuevo
- [X] T015 [US5] back/tests/security-sessions.test.ts: un hash de costo 10 pasa a 12 al entrar
- [X] T016 [US5] back/src/app.ts: 100 kB para `/api/(public|auth|push)`; prueba en back/tests/security.test.ts
- [X] T017 [P] [US5] front/vercel.json: HSTS, COOP y CORP
- [X] T018 [US5] GitHub: `sha_pinning_required` y `all_external_contributors` en los dos repos
- [X] T019 [US5] GitHub: las alertas 1 y 3 del front, descartadas como `tolerable_risk`

## Cierre

- [X] T020 back: `npm run typecheck` y `npm test`; front: `npm run build`, `npm run lint` y todas las `check:*`
- [X] T021 back/specs/050-revision-seguridad/reporte.md
