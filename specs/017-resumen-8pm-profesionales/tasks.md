---

description: "Tareas de «El resumen de las 8 en el celular de cada profesional»"
---

# Tareas: El resumen de las 8 en el celular de cada profesional

**Entrada**: `specs/017-resumen-8pm-profesionales/`. El dueño del producto aprobó la spec y el plan el
2026-10-15 («si procede»).

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front. La beta no cambia.

- [x] T001 Constitución 1.14.0 en `back/` y `front/`: el rol Profesional puede activar los avisos, sólo
  para el resumen de las 8 de su agenda.
- [x] T002 `front/src/lib/constants/push.ts`: `AGENDA_PUSH_KINDS = ["evening_summary"]`, con su texto en
  la tarjeta. Después, `npm run sync:shared` en `back/`.
- [x] T003 `back/src/services/push-device-service.ts`:
  - `authorizePush` acepta al rol `professional` de un negocio activo, con una agenda activa
    vinculada, y le da `AGENDA_PUSH_KINDS`;
  - sin agenda, 403 con un mensaje claro;
  - Recepción y los administradores siguen con 403;
  - la auditoría va a su negocio;
  - el aviso de prueba del profesional: «Listo: aquí te avisaremos de las citas que quedan sin
    cerrar», que abre `/dashboard`.
- [x] T004 `back/src/services/push-delivery.ts`: `PushAudience` suma `{ userOf }` (los aparatos de esa
  persona si sigue activa y su negocio está activo), en `recipientsSql` y `recipientParams`.
- [x] T005 `back/src/services/push-notices.ts`: `queueEveningSummaries`, por cada agenda con usuario
  que no sea el propietario y tenga citas sin cerrar:
  - la cola del aviso al celular de esa persona;
  - el título «Tienes N citas de hoy sin cerrar», en singular con una;
  - abre `/dashboard/calendar?date=<fecha>`;
  - la clave `resumen:<agenda>:<fecha>`.

  El del propietario no cambia.
- [x] T006 `front/`:
  - `PushPrompt` y `PushSettingsCard` con `audience = "agenda"` y su texto;
  - la franja para el rol Profesional en `dashboard-layout.tsx`, nunca en modo soporte;
  - la tarjeta en `settings-page.tsx` para el rol Profesional.
- [x] T007 `back/tests/push-notices.test.ts`: lo de «Pruebas» del plan.
- [x] T008 READMEs de los dos repos y comprobación:
  - `back/`: `npm run typecheck` y `env -u DATABASE_URL npm test`;
  - `front/`: `npm run build` y `npm run lint`;
  - el recorrido corto, a 390 px (API en el 4180, preview en el 5199, detenidos por PID).
- [x] T009 Cierre: `reporte.md`, el estado de la spec y los commits sin firma de IA.
