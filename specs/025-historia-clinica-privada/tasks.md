---

description: "Tareas de «Historia clínica privada: ni el soporte la ve»"
---

# Tareas: Historia clínica privada: ni el soporte la ve

**Entrada**: `specs/025-historia-clinica-privada/`. El dueño del producto aprobó la spec y el plan el
2026-10-19 («si procede por favor» y «procede»).

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front y `beta/` =
`~/Documentos/Proyectos/Betas/agenda-beta`.

## Fase 1: Base

- [x] T001 Constitución 1.22.0, igual en los dos repos (`.specify/memory/constitution.md`):
  - la decisión vigente del modo soporte, reescrita;
  - una línea en el principio II;
  - los dos riesgos aceptados (las contraseñas y el acceso técnico a la base).
- [x] T002 Código compartido (`front/src/lib/constants/business.ts`, luego `npm run sync:shared` en
  `back/`): `CLINICAL_SUPPORT_BLOCKED_MESSAGE` = «Por privacidad, el soporte de Agenda360 no tiene
  acceso a la historia clínica de los pacientes.»

## Fase 2: Historias 1 y 2, el bloqueo en la API (P1)

- [x] T003 [US1] `back/src/services/clinical-service.ts`:
  - `authorizeClinical()` rechaza `actor.support` con `forbidden` y el mensaje compartido;
  - `authorizeClinicalTemplates()` es nueva y mantiene la regla de hoy (el soporte pasa);
  - `listTemplates` usa la nueva;
  - en `get`, se quita la rama `actor.support`.
- [x] T004 [US1] `back/src/services/clinical-template-service.ts`: usa `authorizeClinicalTemplates()`
  en los dos puntos. `back/src/services/clinical-attachment-service.ts`: se quita la rama
  `actor.support` de `downloadUrl`.
- [x] T005 [US2] `back/src/services/account-service.ts`: en `setClinicalAccess`, si `actor.support`,
  `forbidden` con «Sólo el propietario puede dar o quitar el acceso a la historia clínica.»
  Se actualiza su comentario.
- [x] T006 [US2] `back/src/services/activity-service.ts`: en `auditLogService.list`,
  `clinicalAccess = !actor.support && (…)`. Se actualiza el comentario.
- [x] T007 [US1] [US2] Pruebas:
  - `back/tests/clinical-support.test.ts`, nueva, según el plan: cada camino da 403 sin cambiar nada,
    la actividad sale sin eventos clínicos, el soporte sigue con los formatos y con activar la
    historia, y el propietario y el miembro autorizado siguen igual;
  - se actualizan `back/tests/clinical.test.mjs` y `back/tests/security-scope.test.ts`.

## Fase 3: Historias 1, 3 y 4, la pantalla y los textos (P1)

- [x] T008 [US1] `front/src/features/auth/session-provider.tsx`: en modo soporte,
  `clinicalAccess: false`, con su comentario. `front/src/features/clinical/use-clinical-access.ts`:
  los hooks `useClinicalSupportBlocked()` y `useClinicalTemplatesAccess()`.
- [x] T009 [US1] El aviso de privacidad (`EmptyState` con `ShieldCheck` y el mensaje compartido):
  - `front/src/pages/dashboard/client-detail-page.tsx`: la pestaña «Historia clínica» sigue en modo
    soporte, con el aviso;
  - `front/src/pages/dashboard/clinical-print-page.tsx`: el aviso;
  - `front/src/features/appointments/appointment-details-sheet.tsx`: la línea «La historia clínica no
    se ve en modo soporte» en vez de los botones.
- [x] T010 [US2] `front/src/features/settings/team-settings.tsx`: en modo soporte, el interruptor
  «Historia clínica» está deshabilitado y lleva su explicación.
- [x] T011 [US4] `front/src/features/settings/clinical-settings-card.tsx`,
  `front/src/pages/dashboard/clinical-templates-page.tsx` y
  `front/src/pages/dashboard/clinical-template-editor-page.tsx`: usan `useClinicalTemplatesAccess()`.
- [x] T012 [US3] Los textos de `clinical-settings-card.tsx` y `clinical-record-tab.tsx`, y en
  `front/src/pages/privacy-page.tsx` la sección 5 y `LAST_UPDATED` («19 de octubre de 2026»), según
  el plan.

## Fase 4: La beta

- [x] T013 `beta/`: `src/pages/privacy-page.tsx`, los textos de `clinical-settings-card.tsx` y
  `clinical-record-tab.tsx`, y la constante compartida si la beta tiene `src/lib/constants/business.ts`.
  Después, `npm run build`.

## Fase 5: Comprobación

- [x] T014 `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`.
  `front/`: `npm run build`, `npm run lint` y `npm run check:contrast`.
- [x] T015 El recorrido del plan, en modo soporte y como propietario, en los dos modos y a 390 px.
- [x] T016 `reporte.md` (`/speckit-reporte`) y los commits en `dev` de cada repo.

## Dependencias

- La Fase 1 va antes que todo.
- Las Fases 2 y 3 son independientes entre sí: el back y el front pueden ir en paralelo.
- La Fase 4 va después de la 3, porque copia sus textos.
- La Fase 5 va al final.
