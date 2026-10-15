# Especificación: El resumen de las 8 de la noche en el celular de cada profesional

**Carpeta**: `specs/017-resumen-8pm-profesionales` (rama de trabajo: `dev`) · **Creada**: 2026-10-15

**Estado**: Aprobada (2026-10-15, con su plan)

**Repos**:
- **agenda-backend:** quién puede activar los avisos y el envío del resumen.
- **agenda-front:** activar los avisos siendo profesional.
- **La beta:** no tiene avisos al celular.

## Pedido

El dueño del producto pidió el 2026-10-15 «una notificación todos los días a las 8 de la noche para
que vean el estado de sus citas y cambien el estado, para que así los profesionales tengan datos más
reales».

Hoy el resumen de las 8 sólo llega al celular del propietario (spec 013). A los profesionales sólo les
llega a la campana del panel (spec 014), que ven si entran.

**Decisiones del dueño del producto (2026-10-15):**
- **Por dónde:** el aviso al celular.
- **A quién:** al propietario (como hoy, todo el negocio) y a cada profesional (sus citas). Esto amplía
  la decisión de la spec 013, en la que los avisos al celular eran sólo del propietario.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El profesional recibe su resumen a las 8 (Prioridad: P1)

**Prueba independiente**: un profesional activa los avisos, deja dos citas de hoy sin cerrar y a las 8
de la noche recibe el resumen sólo de las suyas.

**Escenarios de aceptación**:

1. **Dado** un profesional (el rol Profesional, con su agenda) que entra al panel, **entonces** ve la
   franja «Activa los avisos en este celular», con «Activar» y «Ahora no» (7 días), como el
   propietario. En Configuración tiene la tarjeta «Avisos en este celular».
2. **Dado** que activa, **entonces** recibe el aviso de prueba («Listo: aquí te avisaremos de las citas
   que quedan sin cerrar»).
3. **Dado** las 8 de la noche en la zona del negocio y citas de hoy de su agenda que ya terminaron y
   siguen «Pendiente» o «Confirmada», **entonces** le llega «Tienes N citas de hoy sin cerrar: márcalas
   Completada o No asistió». Al tocarlo se abre la agenda de ese día.
4. **Dado** que no le queda ninguna sin cerrar, **entonces** no le llega nada.
5. **Dado** el propietario, **entonces** sigue recibiendo el resumen de todo el negocio. Si también
   tiene agenda, no recibe un segundo aviso.
6. **Dado** la tarjeta del profesional, **entonces** sólo tiene ese tipo de aviso y lo puede apagar o
   desactivar en ese aparato.

### Casos límite

- **Recepción y los administradores** siguen sin avisos al celular.
- **Un profesional sin agenda activa** no puede activar los avisos: la tarjeta lo explica.
- **Dos profesionales en el mismo aparato** (una computadora compartida): al cerrar sesión, los avisos
  se pausan en ese aparato, como hoy.
- **El super admin en modo soporte** no recibe los avisos del profesional.
- **La campana** sigue igual. El aviso al celular se suma.
- **Una agenda que pasa a otro usuario:** el resumen va a quien la tiene ese día.

## Requisitos *(obligatorio)*

- **RF-001**: El rol Profesional, con una agenda activa, DEBE poder activar los avisos en su celular,
  desde la franja y desde Configuración. Sólo tiene el resumen de las 8.
- **RF-002**: A las 8 de la noche, hora del negocio, cada profesional con avisos activados DEBE recibir
  el resumen de las citas de hoy de su agenda que siguen sin cerrar, si hay alguna. Una vez al día.
- **RF-003**: El propietario DEBE seguir recibiendo el resumen del negocio, sin un aviso repetido por su
  propia agenda.
- **RF-004**: Recepción y los administradores NO DEBEN poder activar los avisos.
- **RF-005**: El aviso NO DEBE llevar datos de pacientes: sólo la cifra.
- **RF-006**: Activar, cambiar los tipos, desactivar y el aviso de prueba DEBEN quedar en la actividad,
  como los del propietario (constitución 1.9.0).

## Criterios de éxito *(obligatorio)*

- **CE-001**: Un profesional con citas sin cerrar recibe un solo resumen a las 8 de la noche, sólo de
  su agenda (comprobado en pruebas con la hora simulada).
- **CE-002**: Ningún otro rol recibe ni puede activar los avisos (comprobado en pruebas).
- **CE-003**: Las pruebas pasan, y la franja y la tarjeta se usan a 390 px.

## Supuestos

- **Sólo el resumen de las 8.** Los demás avisos al celular siguen siendo del propietario. Darle al
  profesional «Cita por cerrar», 30 minutos después de cada cita, se podría añadir después.
- **El email del resumen** no entra: el dueño eligió el celular.
