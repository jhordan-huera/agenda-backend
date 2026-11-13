# Tareas: La pantalla Actividad del super admin, rediseñada

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front. Sin migración ni cambios en la API. El panel del negocio no
cambia.

## Fase 1: Lo que se puede probar sin navegador

- [ ] T001 [P] `front/src/features/admin/activity/activity-url.ts` (nuevo): `ActivityTab`, `readActivityUrl` (`?ver=…`, `?emails=…`) y `tabParam`
- [ ] T002 [P] `front/src/features/admin/activity/today-summary.ts` (nuevo): `summarizeToday` (título, tono, acción y las dos frases, en singular y plural) y `tabBadges`
- [ ] T003 [P] `front/src/features/admin/activity/date-range.ts` (nuevo): `DATE_PRESETS`, `presetRange` y `describeRange`
- [ ] T004 [P] `front/src/features/admin/activity/email-status.ts` (nuevo): `emailStatusOf` (enviado, en cola, falló y descartado, con el motivo)
- [ ] T005 `front/scripts/check-admin-activity.ts` (nuevo) y `check:admin-activity` en `front/package.json`

## Fase 2: Las piezas compartidas, sin cambiar el panel del negocio

- [ ] T006 `front/src/features/activity/audit-entry.tsx`: «Ver cambios» como `AuditChanges` exportado, con el mismo aspecto
- [ ] T007 `front/src/features/activity/audit-filters-bar.tsx`: las opciones `leading` y `dates` (por defecto, como hoy)
- [ ] T008 `front/src/features/settings/email-outbox.tsx`: exportar `TYPE_LABELS`, `DeliveryDetail` y el diálogo `EmailPreviewDialog`, con el mismo aspecto

## Fase 3: El resumen y las pestañas (Historias 1 y 2, P1)

- [ ] T009 [US1] `front/src/features/admin/activity/today-summary-card.tsx` (nuevo): el resumen, el enlace de los intentos fallidos y el botón de la acción
- [ ] T010 [US2] `front/src/pages/admin/admin-activity-page.tsx` (se rehace): el título, el resumen, las pestañas de línea con su cifra, la dirección (`?ver=`, `?emails=`), «Exportar» y los filtros de cada pestaña en la página

## Fase 4: Acciones y Seguridad (Historias 3 y 4)

- [ ] T011 [US3] `front/src/features/admin/activity/activity-ledger.tsx` (nuevo): el día a la izquierda (arriba en el celular), la hora, la frase, «Tú», el negocio como enlace, el navegador y la IP, «Ver cambios», los intentos fallidos en rojo, el vacío y «Cargar más»
- [ ] T012 [US3] `front/src/features/admin/activity/date-range-button.tsx` (nuevo): los atajos y Desde/Hasta en un `Popover`
- [ ] T013 [US4] Seguridad en la página: sin el tipo, con «Sólo intentos fallidos»

## Fase 5: Emails (Historia 5, P1)

- [ ] T014 [US5] `front/src/features/admin/activity/admin-email-list.tsx` (nuevo): Hoy / Fallidos (N) / Todos; la tabla por día en el computador y las líneas en el celular; el estado primero, el fallido en rojo con su motivo; al tocar, el contenido

## Fase 6: Cierre

- [ ] T015 Front: build, lint sin avisos y todas las `check:*`. Backend: `typecheck`
- [ ] T016 Recorrido en el navegador (Chromium 1440 en claro y WebKit 390 en oscuro), la altura en el celular contra la de hoy y el panel del negocio sin cambios, con capturas en `specs/049-actividad-super-admin/capturas/`
- [ ] T017 Reporte final; subir a `dev` con «Pruebas» en verde en los dos repos; abrir los PR `dev` → `main` y avisar por ntfy

## Dependencias

- T001 a T004 van primero (en paralelo); T005 los prueba.
- T006 a T008 antes que T010 a T014.
- T009 necesita T002; T011 necesita T006; T012 necesita T003; T014 necesita T004 y T008.
- T015 a T017, al final.
