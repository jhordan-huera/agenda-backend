# Especificación: Arreglos urgentes de la plataforma

**Carpeta**: `specs/015-arreglos-urgentes` (rama de trabajo: `dev`)

**Creada**: 2026-10-15

**Estado**: Publicada (2026-10-15, PR backend #30 y front #26)

**Repos**:
- **agenda-backend** (principal): el tope de emails y los datos del super admin.
- **agenda-front:** la política de privacidad, el registro, Salud y la ficha del negocio.
- **La beta:** la política y el registro.

## Pedido

El 2026-10-15 el dueño del producto pidió revisar las brechas de todo el sistema. Se hicieron dos
revisiones del código y se comprobó cada hallazgo grave. El dueño eligió empezar por los arreglos
urgentes: los que tienen riesgo real (perder recordatorios, perder archivos clínicos, prometer en la
política lo que no existe) y los datos falsos que ve el super admin.

**Decisiones del dueño del producto (2026-10-15):**
1. **Tope de Gmail: primero lo del paciente.**
   - Los envíos se cuentan todos juntos frente al cupo diario de la cuenta.
   - Si no cabe todo, salen antes los recordatorios y los emails al paciente.
   - Las copias al profesional y los avisos al negocio esperan al día siguiente.
   - Las contraseñas y los avisos de seguridad del equipo salen siempre.
2. **La política de privacidad:** se corrige el texto de la copia a «semanal», sin cambiar la copia.
   Las demás promesas se ajustan a lo que existe hoy.
3. **Aplazados por el dueño (2026-10-15, al ver el plan):** la copia de los archivos clínicos en un
   almacenamiento aparte, y los términos del servicio con el contrato de encargo (necesitan la revisión
   de un abogado). Quedan para otra spec.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Los recordatorios no se pierden por el tope de Gmail (Prioridad: P1)

La cuenta de Gmail que envía los emails tiene un cupo de unos 500 envíos al día. Hoy el tope de la
plataforma sólo cuenta los emails al paciente. Con las copias al profesional y los avisos al negocio,
se puede pasar del cupo: Gmail los rechaza y los recordatorios salen con horas de retraso.

**Por qué esta prioridad**: un recordatorio que no llega es una inasistencia, y la copia al profesional
duplica los envíos.

**Prueba independiente**: con un cupo pequeño de prueba, poner en cola más emails de los que caben y
comprobar el orden en que salen y que nada se pierde.

**Escenarios de aceptación**:

1. **Dado** los envíos de las últimas 24 horas, **entonces** se cuentan todos (al paciente, copias al
   profesional, avisos al negocio, cuentas del equipo) frente al cupo de la cuenta.
2. **Dado** que no cabe todo, **entonces** salen primero:
   - las contraseñas y los avisos de seguridad del equipo (siempre);
   - después, los recordatorios y los emails al paciente.

   Las copias al profesional y los avisos al negocio esperan en la cola hasta que vuelva a haber cupo.
3. **Dado** una copia al profesional que esperó, **entonces** sale en cuanto hay cupo: nunca se
   descarta.
4. **Dado** un recordatorio que ya no llegaría a tiempo (la cita pasó), **entonces** no se envía.
5. **Dado** Salud en /admin, **entonces** el super admin ve:
   - los enviados en las últimas 24 horas frente al cupo, en ámbar al acercarse y en rojo al llegar;
   - cuántos esperan.
6. **Dado** que se llega al cupo, **entonces** ntfy avisa una vez, con la cifra.
7. **Dado** los topes de hoy (lo provocado por el público, spec 009, y el de cada negocio), **entonces**
   siguen igual dentro del nuevo.

---

### Historia 2 - La política de privacidad dice la verdad (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** la política, **entonces** dice «una copia de seguridad semanal».
2. **Dado** el resto de sus promesas (portabilidad, borrado definitivo, avisos por email de los
   cambios), **entonces** se ajustan a lo que existe hoy. Lo que falta no se promete y queda anotado
   como pendiente.
3. **Dado** el registro, que hoy dice «aceptas los términos del servicio» aunque esa página no
   existe, **entonces** sólo menciona la política de privacidad, hasta que haya términos (otra spec).

---

### Historia 3 - Datos correctos para el super admin (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** la ficha de un negocio, **entonces** dice desde cuándo está en su plan («En Pro desde el
   3 oct»). Ya no muestra una fecha de renovación que no existe.
2. **Dado** «Cerca del límite» en el Inicio, **entonces** cuenta los pacientes igual que el resto del
   sistema, sin falsos positivos.
3. **Dado** el reparto por plan del Inicio, **entonces** no cuenta los negocios suspendidos junto a
   «N negocios activos».

---

### Casos límite

- **Cupo de otra cuenta:** si algún día se usa una cuenta de Google Workspace (unos 2.000 envíos al
  día), el cupo se cambia en la configuración, sin tocar el código.
- **Un día con muchas reservas:** las copias al profesional se acumulan y salen al día siguiente,
  antes que las copias nuevas de ese día.
- **Gmail rechaza igual** (por ejemplo, porque la cuenta se usó desde otro lado): los emails quedan en
  la cola con sus reintentos, como hoy.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: Los emails de las últimas 24 horas DEBEN contarse todos juntos frente al cupo de la
  cuenta que envía (configurable, unos 500 por defecto).
- **RF-002**: Si no cabe todo, DEBEN salir primero las contraseñas y la seguridad del equipo, después
  los emails al paciente. Las copias al profesional y los avisos al negocio DEBEN esperar en la cola,
  sin descartarse.
- **RF-003**: Un recordatorio que ya no llega a tiempo NO DEBE enviarse.
- **RF-004**: Salud DEBE mostrar los enviados en 24 horas frente al cupo (ámbar y rojo) y cuántos
  esperan. ntfy DEBE avisar una vez al llegar al cupo, sólo con cifras.
- **RF-005**: Los topes de hoy (lo provocado por el público y por negocio) DEBEN seguir funcionando.
- **RF-006**: La política de privacidad DEBE decir «copia semanal» y no prometer nada que no exista.
  El registro NO DEBE mencionar unos términos que no existen.
- **RF-007**: La ficha del negocio DEBE decir desde cuándo está en su plan, sin fecha de renovación.
- **RF-008**: «Cerca del límite» DEBE contar los pacientes igual que el resto del sistema. El reparto
  por plan NO DEBE contar los suspendidos como activos.
- **RF-009**: Los README DEBEN corregir lo que ya no es cierto (la pestaña Suscripción, los ingresos,
  las imágenes, el formato por servicio, quién cambia los colores).
- **RF-010**: La beta DEBE tener la política y el registro corregidos.

### Entidades clave

- **Envío de email**: su tipo decide su prioridad. Los que esperan siguen en la cola de hoy.

## Criterios de éxito *(obligatorio)*

- **CE-001**: En un día con más emails que el cupo, ningún recordatorio que llegaba a tiempo se
  retrasa por una copia o un aviso al negocio (comprobado en pruebas).
- **CE-002**: Ninguna copia al profesional se pierde: todas salen, aunque sea al día siguiente
  (comprobado en pruebas).
- **CE-003**: La política de privacidad no promete nada que no exista (revisado punto por punto).
- **CE-004**: Las pruebas pasan, y lo que cambia se usa sin desplazamiento horizontal a 390 px.

## Supuestos

- **El cupo de Gmail:** la cuenta que envía es un Gmail gratuito, con unos 500 envíos al día.
- **La copia de la base** no cambia: sigue semanal, por email.
- **Aplazados (otra spec):**
  - la copia de los archivos clínicos;
  - los términos del servicio y el contrato de encargo, que necesitan revisión legal.
- **Fuera de esta spec:**
  - el cobro de las suscripciones;
  - exportar los datos de un negocio;
  - el registro de errores;
  - las demás brechas de la revisión del 2026-10-15.
