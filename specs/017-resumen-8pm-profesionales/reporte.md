# Reporte final: El resumen de las 8 en el celular de cada profesional

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-15

**Repos**: los dos (agenda-backend y agenda-front). La beta no tiene avisos al celular · **Migración**:
No

## Resumen

El rol Profesional, con su agenda, ahora puede activar los avisos en su celular. Lo hace desde la
franja que ve al entrar o desde Configuración → Perfil.

A las 8 de la noche, hora del negocio, le llega «Tienes N citas de hoy sin cerrar» si tiene alguna,
sólo de su agenda. El propietario sigue recibiendo el resumen de todo el negocio, sin uno repetido por
su agenda. Recepción y los administradores siguen sin avisos al celular.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El rol Profesional activa los avisos, sólo con el resumen | Cumple | `push-notices` (22 comprobaciones nuevas): su configuración sólo trae `evening_summary`. Recorrido: la franja, la tarjeta en Configuración → Perfil, el aviso de prueba, el interruptor y desactivar |
| RF-002 – A las 8, sólo de su agenda, una vez al día | Cumple | `push-notices`, con el cron simulado a las 20:00: un solo «Tienes 2 citas de hoy sin cerrar» para cada profesional, con su cifra; otra pasada no repite; sin citas sin cerrar, nada. Si la agenda pasa a otro usuario, el resumen va a quien la tiene ese día |
| RF-003 – El propietario, sin un aviso repetido | Cumple | `push-notices` y recorrido: el resumen del negocio, como antes |
| RF-004 – Recepción y los administradores, sin avisos | Cumple | `push-notices`: 403. Recorrido: Elena (Recepción) no ve la franja ni la tarjeta. Una profesional que pasa a Recepción deja de recibirlo |
| RF-005 – Sin datos de pacientes | Cumple | `push-notices`: el aviso sólo lleva la cifra |
| RF-006 – Todo queda en la actividad | Cumple | Recorrido: las 10 acciones de la profesional (activar, tipos, desactivar, prueba) |
| CE-001 / CE-002 / CE-003 | Cumple | Las pruebas de arriba; el recorrido a 390 px, sin desplazamiento horizontal |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores y `env -u DATABASE_URL npm test`: 56 de 56 suites.
  `push-notices` tiene 137 comprobaciones, 22 de ellas nuevas.
- **Front:** `npm run build` y `npm run lint` sin errores.

**Recorrido:** 40 de 40, a 1440 y a 390 px.

## Cambios respecto al plan

- **La audiencia del aviso** lleva también el negocio, y exige que la persona siga en él con el rol
  Profesional: si pasa a Recepción o a administradora, deja de recibirlo aunque conserve el aparato.
- **El mensaje del 403** para Recepción y los administradores ahora dice «…sólo para el propietario
  del negocio y los profesionales con su agenda.».
- **La tarjeta del profesional** va en Configuración → Perfil, la única pestaña que ve.
- **Una profesional sin agenda** no ve la franja, y la tarjeta le explica que pida una agenda.
- **El interruptor del profesional** dice «de tu agenda».

## Pendientes y riesgos

- **Sin comprobar:** un aviso real en un celular, en Chrome o en un iPhone. El recorrido simuló el
  servicio de avisos.
- **Cada profesional tiene que activar los avisos** en su celular. Conviene avisarles al publicar.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 7716df0 | Spec 017: … (spec, plan, tareas y constitución 1.14.0) |
| agenda-front | d26397b | Constitución 1.14.0: el resumen de las 8 para los profesionales (spec 017) |
| agenda-backend | (el de esta entrega) | Spec 017: el resumen de las 8 para los profesionales (backend) y reporte |
| agenda-front | (el de esta entrega) | Spec 017: el resumen de las 8 para los profesionales (front) |

## Cómo publicarlo

1. **Primero el PR del backend y después el del front.** Sin migración ni variables.
2. **Después,** cada profesional entra al panel y pulsa «Activar» en la franja. En iPhone, con la app
   instalada en la pantalla de inicio.

## Texto para el PR

Spec 017: el rol Profesional puede activar los avisos al celular y recibe a las 8 de la noche el
resumen de las citas de su agenda que siguen sin cerrar. Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/017-resumen-8pm-profesionales/reporte.md
