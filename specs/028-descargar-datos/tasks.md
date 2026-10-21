---

description: "Tareas de «Descargar los datos del negocio»"
---

# Tareas: Descargar los datos del negocio

**Entrada**: `specs/028-descargar-datos/`. El dueño del producto aprobó la spec («si procede») y el plan
(«procede con los dos planes») el 2026-10-20.

**Rutas:** `back/` = agenda-backend y `front/` = agenda-front. La beta no lo lleva.

## Fase 1: Base

- [x] T001 Constitución 1.24.0, igual en los dos repos (la decisión vigente de la descarga).
- [x] T002 Código compartido (`front/src`, luego `npm run sync:shared` en `back/`): los tipos de las
  respuestas de la descarga (`DataExportSummary`, las partes de pacientes, citas e historias) y la
  acción `business.data_exported` donde se listan las acciones de la actividad.

## Fase 2: Historias 1 a 3, la API (P1)

- [x] T003 [US1] [US3] `back/src/services/data-export-service.ts` (nuevo):
  - `authorizeExport`: el soporte, el administrador y la recepción, `forbidden`; el propietario, todo;
    el profesional, su agenda;
  - el resumen, con la actividad (una entrada por descarga);
  - las partes de pacientes (500), citas (1000) e historias (50 pacientes);
  - el enlace firmado de un archivo permitido, sin registro por archivo.
- [x] T004 [US1] `back/src/routes/business-routes.ts`: las rutas `GET …/export`, `…/export/clients`,
  `…/export/appointments`, `…/export/clinical` y `POST …/export/attachments/:attachmentId`, con
  `no-store` y `limitRequests({ name: "descarga-datos", windowMinutes: 15, max: 600 })`.
- [x] T005 [US4] `adminService.getBusiness`: `lastDataExportAt`, la última descarga según la
  actividad.

## Fase 3: Historias 1, 2 y 4, la pantalla (P1)

- [x] T006 [US1] `front/package.json`: `fflate` y `write-excel-file`, cargadas con `import()` sólo al
  descargar.
- [x] T007 [US1] `front/src/features/data-export/`:
  - el armado del ZIP;
  - `pacientes.xlsx`, con los encabezados que reconoce la importación;
  - `citas.xlsx`;
  - `clinical-html.ts` (una página por paciente, con estilos dentro, el texto escapado y todos los
    tipos de campo);
  - los archivos con su enlace firmado;
  - `LEEME.html`;
  - los nombres de archivo seguros.
- [x] T008 [US1] [US2] `data-export-card.tsx`: en Configuración → Negocio (el propietario) y en Perfil
  (el rol Profesional), con el avance, los errores y «Reintentar». No sale en modo soporte, ni para el
  administrador ni la recepción.
- [x] T009 [US4] `delete-business-dialog.tsx`: el recordatorio y la última descarga. `privacy-page.tsx`:
  la portabilidad desde el panel y `LAST_UPDATED`. La etiqueta de la acción nueva en la actividad.

## Fase 4: Comprobación

- [x] T010 `back/tests/data-export.test.ts` (nueva, según el plan), `npm run typecheck` y la suite
  completa.
- [x] T011 `front/`: build, lint y `check:contrast`, y la prueba de ida y vuelta de los encabezados y de
  `clinical-html.ts`.
- [x] T012 El recorrido (descargar y revisar el ZIP como propietario y como profesional; sin botón en
  modo soporte), el `reporte.md` y los commits en `dev`.
