---

description: "Tareas de «Elegir y corregir la fecha de una evolución»"
---

# Tareas: Elegir y corregir la fecha de una evolución

**Entrada**: `specs/037-fecha-de-la-evolucion/`. El dueño del producto aprobó la spec y el plan el 2026-10-28 («procede con todo esto esta bien»).

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front y `beta/` = `~/Documentos/Proyectos/Betas/agenda-beta` (copia: `agenda-beta-respaldo-antes-de-fecha-evolucion-037-2026-10-28.tar.gz`).

## Fase 1: La base y lo compartido

- [x] T001 `back/db/migrations/053_fecha_de_la_evolucion.sql`:
  - `clinical_notes_protect` deja de vigilar `date`: sigue con `business_id`, `client_id`, `template_version_id`, `data`, `author_name` y `created_at`;
  - un disparador nuevo, al insertar y al cambiar `date`, exige que esté entre el día de `created_at` en la zona del negocio menos 30 días y ese día (errcode `42501`, mensaje en español).
- [x] T002 `front/src/lib/validations/clinical.ts`:
  - `CLINICAL_NOTE_DATE_WINDOW_DAYS = 30`;
  - `clinicalNoteSchema` con `date` opcional (AAAA-MM-DD);
  - `clinicalNoteDateSchema` (`{ date }`).
  Después, `npm run sync:shared` en `back/`.

## Fase 2: Registrar una evolución de otro día (US1, P1)

- [x] T003 [US1] `back/src/services/clinical-service.ts`, `addNote`: usa `data.date` o hoy; rechaza (400) una fecha futura o de hace más de 30 días, con el día del negocio.
- [x] T004 [P] [US1] `front/src/features/clinical/clinical-note-dialog.tsx`:
  - «Fecha de la consulta» (`input type=date`, `min` = hoy − 30 y `max` = hoy) en lugar del candado;
  - al elegir una cita, propone su fecha si cabe;
  - el aviso de abajo dice que la fecha se puede corregir y el contenido no.

## Fase 3: Corregir la fecha de una evolución guardada (US2, P1)

- [x] T005 [US2] `back/src/services/clinical-service.ts`, `changeNoteDate`:
  - autoriza como `addAddendum` (`authorizeClinical` y `findPatient`);
  - comprueba la ventana contra el día de registro;
  - deja `clinical_record.note_date_changed` con «del 27/10/2026 al 26/10/2026».
  Ruta `PATCH /:businessId/clinical-notes/:noteId/date` en `back/src/routes/business-routes.ts`.
- [x] T006 [P] [US2] `front/`: `changeClinicalNoteDate` en el repositorio (`api-repository.ts` y `repository.ts`) y `useChangeClinicalNoteDate` en `hooks/queries/use-clinical.ts`, que recarga la historia.
- [x] T007 [US2] `front/src/features/clinical/clinical-note-card.tsx`: «Cambiar fecha» junto a «Añadir aclaración», con su diálogo (fecha con `min`/`max` de la ventana y confirmación).

## Fase 4: Ver las dos fechas (US3, P1)

- [x] T008 [P] [US3] `front/`: la ficha (`clinical-note-card.tsx`), la impresión (`clinical-print-page.tsx`) y la descarga (`data-export/clinical-html.ts`) muestran la fecha de la consulta y, aparte, «Registrada el … por …».

## Fase 5: Pruebas, constitución y cierre

- [x] T009 `back/tests/clinical-note-date.test.ts`:
  - registrar hoy, ayer, hace 30 días; rechazar hace 31 y mañana;
  - cambiar dentro y fuera de la ventana;
  - la actividad;
  - 403 para el staff sin acceso y para el modo soporte;
  - por SQL: cambiar `data` falla y una fecha fuera de la regla falla.
- [x] T010 [P] La constitución 1.30.0 en `back/` y `front/` (la regla de la fecha, iguales en los dos repos).
- [x] T011 `back/`: `typecheck` y `npm test`. `front/`: build, lint y `check:contrast`. El recorrido en el computador y a 390 px, con capturas.
- [x] T012 `beta/`: lo mismo con su repositorio de datos de ejemplo; build y lint.
- [ ] T013 `reporte.md` y los commits en `dev`.

## Dependencias

- T001 y T002 primero. US1, US2 y US3 se pueden hacer en paralelo después; T007 depende de T006.
- T009 depende de T001, T003 y T005. La beta (T012) copia lo compartido del front: después de T002–T008.
