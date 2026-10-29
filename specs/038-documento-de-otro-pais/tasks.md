# Tareas: Cualquier documento de identidad, de cualquier país

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front, `beta/` = ~/Documentos/Proyectos/Betas/agenda-beta.

## Fase 1: Código compartido

- [X] T001 front/src/lib/identity.ts: sin `documentIdError` ni `documentIdMaxLength`, con `documentIdChars` y `DOCUMENT_ID_MAX_LENGTH`
- [X] T002 front/src/lib/validations/fields.ts (letras y números, `optionalDocumentField`), clinical.ts, client.ts y client-import.ts
- [X] T003 `npm run sync:shared` en back/

## Fase 2: Backend

- [X] T004 [H1] back/src/services/public-booking-service.ts sin `documentIdError`
- [X] T005 [H2] back/src/services/business-data-service.ts sin `documentIdError`
- [X] T006 [H1][H2][H3] back/tests/foreign-document.test.ts y ajustes en back/tests/client-import.test.ts

## Fase 3: Front

- [X] T007 [H1] front/src/features/booking/details-step.tsx: el campo acepta letras, sin la ayuda «¿No tienes cédula ecuatoriana?»
- [X] T008 [H2] front/src/features/clients/client-form-dialog.tsx y front/src/features/clinical/clinical-profile-form.tsx
- [X] T009 Constitución 1.31.0 en los dos repos

## Fase 4: La beta

- [X] T010 Copia de seguridad y los mismos cambios

## Fase 5: Comprobación

- [X] T011 back: `typecheck` y `npm test`; front: build, lint, `check:contrast` y `check:data-export`; beta: build y lint
- [X] T012 Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro
