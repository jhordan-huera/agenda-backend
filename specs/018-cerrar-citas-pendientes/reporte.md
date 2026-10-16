# Reporte final: Cerrar las citas pendientes de días anteriores

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev, con la beta · **Fecha**: 2026-10-15

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: No

## Resumen

La agenda tiene el botón «Por cerrar (N)». Abre la lista de las citas que ya terminaron y siguen
«Pendiente» o «Confirmada»: primero las de días anteriores y después las de hoy. Cada una tiene
«Completada», «No asistió» o «Cancelada», y hay un «Marcar todas como completadas».

Al entrar al panel, quien tiene citas de días anteriores sin cerrar ve primero «Antes de seguir,
cierra tus citas pendientes». Con «Más tarde» entra, una vez cada 4 horas, y una franja se lo recuerda.
Cada uno ve lo suyo: el rol Profesional, su agenda; el propietario, los administradores y Recepción, el
negocio. En modo soporte sólo sale la franja.

Nada se cierra solo, y cerrar desde la lista no le escribe al paciente salvo que se marque la casilla.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La lista, ordenada | Cumple | `close-appointments` (60 comprobaciones): el orden, sin las cerradas ni las que no terminaron, tandas de 50 con 55 citas, la zona horaria. Recorrido |
| RF-002 – Cerrar una o todas | Cumple | `close-appointments`: «Marcar todas» sólo cierra las de su alcance que siguen sin cerrar. Recorrido: una por una, y después todas, hasta «Todo al día» |
| RF-003 – Actividad y paciente | Cumple | Cada cierre deja su entrada con «Estado» y, sin la casilla, «(sin avisar al paciente)». Sin la casilla no entra ningún email en la cola; con ella, sí |
| RF-004 – Bloqueo al entrar, con «Más tarde» | Cumple | Recorrido: el bloqueo; «Más tarde» deja entrar con la franja; pasadas 4 horas, vuelve |
| RF-005 – Cada uno lo suyo | Cumple | Valeria (Profesional) sólo ve su agenda; Recepción y el propietario, el negocio, también la agenda sin usuario |
| RF-006 – Nada se cierra solo | Cumple | No hay ningún cierre automático |
| RF-007 – El modo soporte no se bloquea | Cumple | Recorrido: sólo la franja («Este negocio tiene N…») |
| RF-008 – La beta | Cumple | Build, lint y recorrido (32 de 32), con 3 citas de prueba sin cerrar en la Clínica Dental Sonrisa |
| CE-001 / CE-002 / CE-003 | Cumple | El recorrido, a 390 px, sin desplazamiento horizontal |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores y `env -u DATABASE_URL npm test`: 57 de 57 suites.
  `close-appointments` es nueva: 60 comprobaciones.
- **Front:** `npm run build` y `npm run lint` sin errores.

**Recorridos:**
- **Front:** 73 de 73, en escritorio (Chromium) y a 390 px (WebKit, el motor de Safari).
- **Beta:** 32 de 32.

## Cambios respecto al plan

- **`PATCH …/status` acepta `onlyIfOpen`.** Si dos personas cierran la misma cita, se respeta el estado
  que ya tiene y responde 409.
- **«Marcar todas»** acepta hasta 200 citas por petición. Si hay más, el front las manda en tandas.
- **«Más tarde»** se comprueba al entrar y al cambiar de página, no en medio de un formulario.
- **Mientras llega el contador** se ve la pantalla de carga, para que el panel no aparezca un instante
  antes de bloquearse.
- **La cifra de la franja** suma también las citas de hoy, igual que la lista. Sólo bloquean las de
  días anteriores.
- **Con la casilla marcada** sale el email de la spec 008, pero no se ofrece el WhatsApp, para no
  frenar el cierre.
- **La lista** es un diálogo en la computadora y un `Sheet` en el celular.
- **El cambio de estado** se separó en `changeAppointmentStatus`, que comparten la ficha y la lista.

## Pendientes y riesgos

- **Al publicarse,** quien tenga citas viejas sin cerrar verá la pantalla al entrar. Conviene avisar a
  los negocios (mensaje de abajo).
- **Sin comprobar:** el envío real por Gmail cuando se marca la casilla.

## Mensaje sugerido para los negocios

> Desde hoy, al entrar a Agenda360 verás tus citas de días anteriores que siguen «Pendiente» o
> «Confirmada», para marcar cómo terminó cada una (Completada, No asistió o Cancelada). Con «Marcar
> todas como completadas» las cierras de una vez, y con «Más tarde» puedes entrar y hacerlo después.
> Así tu agenda y tus reportes muestran lo que de verdad pasó. Los pacientes no reciben ningún email,
> salvo que marques «Avisar a los pacientes». Si tienen alguna duda, escríbanme y con gusto les ayudo.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 4a5ca5a | Spec 018: cerrar las citas pendientes (spec, plan, tareas y constitución 1.15.0) |
| agenda-front | 2f9fb7c | Constitución 1.15.0: cerrar las citas pendientes (spec 018) |
| agenda-backend | (el de esta entrega) | Spec 018: cerrar las citas pendientes (backend) y reporte |
| agenda-front | (el de esta entrega) | Spec 018: cerrar las citas pendientes (front) |

La beta queda actualizada en su carpeta, con la copia previa `beta-src-antes-018.tgz`.

## Cómo publicarlo

1. **Primero el PR del backend y después el del front.** Sin migración ni variables.
2. **Después,** avisar a los negocios con el mensaje de arriba.

## Texto para el PR

Spec 018: la lista «Por cerrar» en la agenda y, al entrar al panel, el bloqueo hasta cerrar las citas
de días anteriores (o «Más tarde», una vez cada 4 horas). Cada uno ve lo suyo, nada se cierra solo y
no se le escribe al paciente salvo que se marque. Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/018-cerrar-citas-pendientes/reporte.md
