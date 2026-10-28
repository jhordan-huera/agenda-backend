# Plan de implementación: Elegir y corregir la fecha de una evolución

**Rama**: `dev` · **Fecha**: 2026-10-28 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **La migración `053_fecha_de_la_evolucion.sql`:**
   - el disparador que protege `clinical_notes` deja de bloquear `date`; el resto del contenido, el autor y
     `created_at` siguen bloqueados;
   - un disparador nuevo, al insertar y al actualizar, exige que `date` esté entre el día de registro
     (`created_at` en la zona del negocio) menos 30 días y ese mismo día. Así la regla vale también por SQL.
2. **Lo compartido** (en el front, y `sync:shared` en el backend):
   - en `validations/clinical.ts`, `clinicalNoteSchema` suma `date` (opcional) y un esquema nuevo para el
     cambio de fecha;
   - `CLINICAL_NOTE_DATE_WINDOW_DAYS = 30`.
3. **El backend** (`clinical-service.ts`):
   - **`addNote`:** usa la fecha recibida (hoy si no viene) y comprueba la ventana con el día del negocio;
   - **`changeNoteDate`** (nuevo):
     - la ruta es `PATCH /businesses/:id/clinical-notes/:noteId/date`;
     - autoriza como `addAddendum` y comprueba la ventana contra el día de registro;
     - deja `clinical_record.note_date_changed` en la actividad, con «del 27/10 al 26/10»;
   - la ruta va en `business-routes.ts`.
4. **El front:**
   - **`clinical-note-dialog.tsx`:** el campo «Fecha de la consulta» (`input type=date` con `min` y `max`)
     reemplaza el candado. Al elegir una cita, propone su fecha si cabe en la ventana;
   - **`clinical-note-card.tsx`:**
     - muestra «Consulta: lun 27 oct» y, debajo, «Registrada el mar 28 oct, 09:12»;
     - tiene la acción «Cambiar fecha», junto a «Añadir aclaración», con un diálogo de confirmación;
   - **la impresión** (`clinical-print-page.tsx`) **y la descarga** (`clinical-html.ts`): las dos fechas;
   - **`use-clinical`:** la mutación nueva, que recarga la historia.
5. **La constitución 1.30.0** en los dos repos. «Las fechas de consentimiento y de las evoluciones clínicas
   las pone el sistema» pasa a:

   > La fecha del consentimiento la pone el sistema. La de cada evolución la elige quien la registra (hoy
   > por defecto) y se puede corregir después, siempre entre los 30 días anteriores a su registro y ese
   > mismo día, nunca futura; cada cambio queda en la actividad. El contenido y la fecha de registro no se
   > modifican (2026-10-28).

6. **La beta:** la misma interfaz, con su repositorio de datos de ejemplo. Antes, una copia de `src`.

**Migración:** sí, la `053`. La aplica el dueño del producto con `npm run db:migrate` **antes** de publicar
el backend.

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | El soporte sigue sin acceso a la historia clínica; la actividad clínica guarda 5 años |
| III. Decisiones | Sí, con la regla nueva | Decisión del dueño del 2026-10-28; se actualiza la constitución |
| Auditoría | Sí | `clinical_record.note_date_changed`, con su prueba |
| VII. Diseño | Sí | Campo de fecha nativo y accesible, a 390 px sin desbordes |

## Pruebas

- **`tests/clinical*.test`:**
  - registrar hoy, ayer, hace 30 días, hace 31 días (rechazada) y mañana (rechazada);
  - cambiar la fecha dentro y fuera de la ventana;
  - la actividad;
  - un rol sin acceso clínico y el modo soporte reciben 403;
  - por SQL, cambiar el contenido falla y una fecha fuera de la regla falla.
- **Backend:** `typecheck` y `npm test`.
- **Front y beta:** build, lint y `check:contrast`.
- **El recorrido** en el computador y a 390 px: registrar con otra fecha, cambiarla y ver las dos fechas en
  la ficha y en la impresión.
