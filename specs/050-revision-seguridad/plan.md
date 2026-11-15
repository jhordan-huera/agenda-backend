# Plan: Lo que quedó de la revisión de seguridad

**Spec**: [spec.md](spec.md) · **Fecha**: 2026-11-15 · **Rutas**: back/ = agenda-backend, front/ = agenda-front

## Contexto técnico

- **Sin migración.** Los cambios de la API son de código; los de la web, de `vercel.json`; los de GitHub, de sus
  ajustes.
- **Código compartido:** los tipos (`PublicWaitlistEntry`, `PublicSurvey`) y las validaciones (`fields.ts`,
  `booking.ts`) se editan en front/ y se copian con `npm run sync:shared` desde back/.
- **Pruebas:** las suites de back/ con su base temporal; las `check:*`, la compilación y el lint de front/.

## Constitución

- **Privacidad (principio II):** los enlaces cerrados dejan de mostrar datos; nada nuevo guarda datos de pacientes.
- **Decisiones guardadas (principio III):** la regla «email o teléfono» de la spec 009 pasa a «sólo el email», por
  decisión del dueño del 2026-11-15. Constitución 1.48.0, en los dos repos. Lo demás no cambia ninguna decisión.
- **Auditar todo:** no hay acciones nuevas que cambien datos.

## Diseño

1. **Lista de espera** (`back/src/services/waitlist-service.ts`): `saveEntry` actualiza el nombre y el teléfono sólo
   si la espera viene del panel (`case when $8::boolean`) y devuelve el nombre guardado. `join` lo usa en el saludo y
   en la actividad.
2. **Ruta antigua:** se quitan la ruta de `business-routes.ts` y `businessService.getProfessional`.
3. **Dirección sin enlaces** (`front/src/lib/validations/fields.ts`): `LINK_PATTERNS` sale de `NOT_A_NAME` y
   `publicHomeVisitSchema` lo aplica a la dirección y a la referencia, con el mismo tope de largo antes de la
   expresión regular. `publicBookingSchema` lo usa; `appointmentSchema` del panel sigue con `homeVisitSchema`.
4. **Comprobantes** (`file-storage.ts`): `fileInfo(path)` da el tamaño y el `mimetype` de Supabase (en la carpeta
   local, null: su subida ya exige el tipo). `paymentService.completeUpload` rechaza un tipo distinto.
5. **Enlaces cerrados:** `PublicWaitlistEntry` y `PublicSurvey` pasan a uniones por `closed` y `status`. La API
   devuelve sólo lo de cada caso. En front/, la página de la espera oculta «Lo que pediste», la reserva no rellena con
   una espera cerrada y la encuesta vencida saluda sin el nombre.
6. **Contraseñas** (`accounts.ts`): `BCRYPT_ROUNDS = 12` y `needsRehash`; el inicio de sesión rehace el hash si la
   contraseña es correcta y nadie la cambió entretanto. El hash ficticio del email inexistente, con costo 12.
7. **Tope de las peticiones** (`app.ts`): `express.json({ limit: "100kb" })` para `/api/(public|auth|push)`.
8. **Cabeceras** (`front/vercel.json`): HSTS de 2 años, COOP y CORP `same-origin`. Los emails no cargan imágenes de
   la web y nada la incrusta (`frame-ancestors 'none'`).
9. **GitHub:** `sha_pinning_required` y `approval_policy: all_external_contributors` en los dos repos (todas las
   acciones ya iban por SHA, spec 045). Las 2 alertas del front, descartadas como `tolerable_risk`.
10. **Sólo el email** (`public-booking-service.ts`): `sameContact` pasa a `sameEmail` en la ficha de la cédula, en el
    «Por verificar» anterior y en el reintento. `samePhone` queda sólo para el cliente antiguo sin cédula (nombre,
    email y teléfono). Textos de «Por verificar» en `claim-review.tsx` y en el email al negocio (`templates.ts`).

## Pruebas

- `tests/waitlist.test.ts`: el email de otra persona, la espera del equipo, el panel que corrige y el enlace cerrado.
- `tests/smoke.test.mjs`: `/professional` responde 404.
- `tests/security.test.ts`: la dirección con y sin enlaces, el panel con enlace, 2 MB al momento y el tope de 100 kB.
- `tests/payments.test.ts`: un Supabase de mentira guarda la foto como `text/html` y el comprobante se rechaza.
- `tests/surveys.test.ts`: la encuesta respondida y la vencida, sin la cita.
- `tests/security-sessions.test.ts`: un hash de costo 10 pasa a 12 al entrar.
- `tests/cedula.test.mjs` y `tests/booking-retry.test.ts`: con la cédula y el teléfono pero otro email, «Por verificar»
  y «hora ocupada». `couple-booking` y `security-scope` siguen probando el acceso pendiente con la cédula y el email.
