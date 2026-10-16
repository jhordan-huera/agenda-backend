# Plan de implementación: El resumen de las 8 en el celular de cada profesional

**Rama**: `dev` · **Fecha**: 2026-10-15 · **Spec**: [spec.md](./spec.md)

## Diseño (corto: amplía la spec 013)

1. **El permiso.** `push-device-service.ts` (`authorizePush`) acepta un tercer caso: el rol
   `professional` de un negocio activo, con una agenda activa vinculada.
   - Sus tipos son sólo `evening_summary` (`AGENDA_PUSH_KINDS` en `src/lib/constants/push.ts`, que se
     comparte).
   - La auditoría de la spec 013 vale igual: va a la actividad de su negocio.
   - Recepción y los administradores siguen con 403.
2. **A quién va.** `PushAudience` suma `{ userOf: <usuario> }`: los aparatos de esa persona, si sigue
   activa y en un negocio activo.
3. **El envío.** `queueEveningSummaries` ya calcula, para la campana (spec 014), cuántas citas sin
   cerrar tiene cada agenda. Ahora, además, por cada agenda con usuario que no sea el propietario,
   hace la cola del aviso al celular de esa persona:
   - título «Tienes N citas de hoy sin cerrar»;
   - abre `/dashboard/calendar?date=<hoy>`;
   - clave `resumen:<agenda>:<fecha>`, una vez al día.

   El del propietario no cambia.
4. **El front.**
   - `PushPrompt` y `PushSettingsCard` aceptan `audience = "agenda"`, con su texto: «Te avisamos a las 8
     de la noche si te quedan citas de hoy sin cerrar».
   - `dashboard-layout.tsx` muestra la franja también al rol Profesional, nunca en modo soporte.
   - `settings-page.tsx` muestra la tarjeta al rol Profesional.
   - El aviso de prueba dice «Listo: aquí te avisaremos de las citas que quedan sin cerrar».
5. **La constitución 1.14.0** (MENOR), en el principio III, en la línea de los avisos al celular:
   > El rol Profesional también puede activarlos, sólo para el resumen de las 8 de la noche de su
   > agenda (2026-10-15).

**Sin migración ni variables nuevas.** La beta no cambia, porque no tiene avisos al celular.

## Pruebas

En `tests/push-notices.test.ts`:
- **El profesional:**
  - activa su aparato y su configuración trae sólo `evening_summary`;
  - Recepción y el administrador siguen recibiendo 403;
  - con la hora del cron simulada a las 20:00, recibe un solo resumen con su cifra, y la otra
    profesional, el suyo;
  - pasar el cron otra vez no repite;
  - sin citas sin cerrar, no le llega nada.
- **El propietario:** sigue recibiendo el del negocio, sin un aviso repetido por su agenda.
- **Privacidad:** el aviso no lleva nombres.
- **La actividad:** registra su activación.

Además:
- **Front:** build, lint y un recorrido corto (la franja y la tarjeta del rol Profesional, a 390 px).

## Publicación

1. **Primero el PR del backend y después el del front.** Sin migración.
2. **Después,** cada profesional entra al panel y pulsa «Activar» en la franja.

## Decisiones del dueño (2026-10-15)

El aviso, al celular. Lo reciben el propietario (como hoy) y cada profesional (sus citas).
