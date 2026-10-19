# Especificación: Historia clínica privada: ni el soporte la ve

**Carpeta**: `specs/025-historia-clinica-privada` (rama de trabajo: `dev`) · **Creada**: 2026-10-19

**Estado**: Implementada (2026-10-19)

**Repos**:
- **agenda-backend:** el bloqueo en la API (la historia, los archivos, la impresión, la actividad clínica
  y el acceso del equipo).
- **agenda-front:** los avisos en modo soporte, los textos de la pantalla y la política de privacidad.
- **La beta:** la política y los textos, que copia del front (no tiene un modo soporte real). Ver la
  pregunta de los supuestos.

## Pedido

El dueño del producto, el 2026-10-19: «que nadie pueda verlas, ni el super admin, sólo el profesional;
cámbialo en las políticas y en el código». Lo pidió después de que una psicóloga, posible clienta,
dijera que lo que más le interesa de Agenda360 es la historia clínica.

Hoy, en modo soporte, el super admin entra con permisos de propietario y ve la historia clínica y sus
archivos. Así lo dicen la constitución (como decisión vigente) y la política de privacidad.

**Decisiones del dueño del producto (2026-10-19):**
1. **Bloquear en la app, sin cifrado con clave del profesional.** Ni el modo soporte ni ninguna
   pantalla de /admin pueden abrir la historia clínica, y la API lo rechaza. La política lo dice con
   honestidad: Agenda360 no puede abrirlas desde la plataforma. Sólo el acceso técnico directo a la base
   de datos, reservado al mantenimiento y a las copias de seguridad, podría llegar a esos datos, y no se
   usa para leerlos.
2. **Dentro del negocio, todo como ahora:**
   - el propietario la ve siempre;
   - los miembros, sólo si el propietario les activa «Historia clínica» en Equipo;
   - el rol Profesional con «sólo sus pacientes» sigue igual.
3. **Cambia la decisión vigente de la constitución.** Pasa a decir que, en modo soporte, el super admin
   tiene permisos de propietario **salvo la historia clínica**, que no puede ver ni cambiar.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - El soporte no abre la historia clínica (Prioridad: P1)

La psicóloga necesita saber que lo que anota de sus pacientes no lo lee nadie de Agenda360.

**Prueba independiente**: entrar en modo soporte a un negocio con historias clínicas e intentar abrir
cada parte, desde la pantalla y pidiéndolo directamente a la API.

**Escenarios de aceptación**:

1. **Dado** el super admin en modo soporte en un negocio con historia clínica, **cuando** abre la ficha
   de un paciente, **entonces** la pestaña «Historia clínica» muestra «Por privacidad, el soporte de
   Agenda360 no tiene acceso a la historia clínica de los pacientes». No carga nada:
   - ni los antecedentes ni el consentimiento;
   - ni las evoluciones, sus aclaraciones o sus cuestionarios (PHQ-9, GAD-7);
   - ni el gráfico de evolución ni los archivos.
2. **Dado** el detalle de una cita en modo soporte, **entonces** no se ofrecen «Registrar evolución» ni
   «Ver historia». En su lugar se ve el mismo aviso.
3. **Dado** la página «Imprimir / PDF» de un paciente en modo soporte, **entonces** muestra el aviso y
   ningún dato clínico.
4. **Dado** cualquier pedido directo a la API de la historia clínica en modo soporte, **entonces** se
   rechaza como «no autorizado» y no cambia nada. Vale para leer, registrar una evolución o una
   aclaración, cambiar los antecedentes o el consentimiento, y listar, abrir o subir archivos.
5. **Dado** el propietario, o un miembro con acceso clínico, **entonces** todo funciona como hoy.

### Historia 2 - Sin atajos (Prioridad: P1)

El super admin agrega los miembros de equipo y pone sus contraseñas. Si pudiera darles acceso clínico,
podría crear uno, autorizarlo y entrar con él.

**Prueba independiente**: en modo soporte, intentar dar acceso clínico a un miembro, y revisar la
actividad del negocio.

**Escenarios de aceptación**:

1. **Dado** Configuración → Equipo en modo soporte, **entonces** el interruptor «Historia clínica» de
   cada miembro se ve, pero no se puede cambiar, y dice «Sólo el propietario puede dar o quitar el
   acceso a la historia clínica». La API también lo rechaza.
2. **Dado** un miembro nuevo, **entonces** empieza sin acceso clínico (ya es así) y sólo el propietario,
   desde su propia sesión, puede dárselo.
3. **Dado** Configuración → Actividad en modo soporte, **entonces** no salen los eventos de la historia
   clínica: quién la consultó, las evoluciones y los archivos (con sus nombres). Los cambios de acceso
   del equipo sí salen, porque no llevan datos de pacientes.
4. **Dado** cualquier pantalla de /admin, **entonces** no muestra contenido clínico, sólo cifras
   agregadas: cuántos negocios usan la historia clínica, cuántas evoluciones hay y cuánto ocupan.

### Historia 3 - El negocio y la política lo dicen (Prioridad: P1)

**Prueba independiente**: leer la tarjeta de configuración, la pestaña y la política.

**Escenarios de aceptación**:

1. **Dado** la tarjeta de la historia clínica en Configuración y la pestaña del paciente, **entonces**
   dicen que sólo la ven el propietario y las personas que él autoriza, y que ni el soporte de Agenda360
   puede verla.
2. **Dado** la política de privacidad, **entonces** la sección del soporte dice tres cosas:
   - el soporte entra al panel de un negocio para darle asistencia y ve lo mismo que su propietario,
     **salvo la historia clínica**, que no puede abrir ni cambiar;
   - lo que el soporte cambia queda en la actividad del negocio;
   - con honestidad: el acceso técnico directo a la base de datos queda reservado al mantenimiento y a
     las copias de seguridad, y no se usa para leer historias clínicas.

   Además, la fecha de «última actualización» cambia.

### Historia 4 - Lo que el soporte sigue haciendo (Prioridad: P2)

El dueño del producto configura los negocios de sus clientes («yo mismo se la configuro»).

**Escenarios de aceptación**:

1. **Dado** el modo soporte, **entonces** puede seguir:
   - activando o desactivando la historia clínica del negocio;
   - gestionando los formatos: crear, duplicar y adaptar, activar, y elegir el formato del negocio
     (son plantillas, no datos de pacientes);
   - importando pacientes y haciendo todo lo demás del panel.

### Casos límite

- **Un super admin siempre entra a los negocios en modo soporte.** Su cuenta no es miembro de ningún
  negocio (se crea aparte desde /admin), así que el bloqueo vale siempre para él.
- **Al eliminar un paciente con historia clínica,** el aviso «tiene historia clínica» dice que existe,
  pero no qué contiene. Así queda.
- **Eliminar un negocio** sigue borrando todo, incluidas sus historias y sus archivos.
- **Un enlace a un archivo** que el soporte hubiera recibido antes del cambio caduca solo (a los 5
  minutos). Después, el soporte no puede pedir enlaces nuevos.
- **Si la historia clínica está desactivada,** el negocio ve los mismos avisos de hoy.
- **A 390 px y en los dos modos (claro y oscuro).**

## Requisitos *(obligatorio)*

- **RF-001**: En modo soporte, la API DEBE rechazar toda lectura y escritura de la historia clínica, sin
  cambiar nada:
  - los antecedentes y el consentimiento;
  - las evoluciones, sus aclaraciones y sus cuestionarios;
  - los archivos: listar, abrir y subir;
  - los datos de la impresión.
- **RF-002**: En modo soporte, la API DEBE rechazar dar o quitar el acceso clínico a un miembro.
- **RF-003**: En modo soporte, la actividad del negocio NO DEBE mostrar los eventos de la historia
  clínica.
- **RF-004**: En modo soporte, la pantalla DEBE mostrar el aviso de privacidad, nunca un error genérico:
  - en la pestaña del paciente, en la impresión y en el detalle de la cita;
  - en Equipo, el interruptor deshabilitado con su explicación.
- **RF-005**: Ninguna pantalla de /admin DEBE mostrar contenido clínico, sólo cifras agregadas.
- **RF-006**: El propietario y los miembros autorizados DEBEN seguir igual, con el alcance «sólo sus
  pacientes» del rol Profesional.
- **RF-007**: En modo soporte DEBEN seguir funcionando:
  - activar o desactivar la historia clínica;
  - gestionar los formatos;
  - importar pacientes y lo demás del panel.
- **RF-008**: Los textos:
  - la tarjeta de configuración y la pestaña;
  - la política de privacidad reescrita, con su fecha;
  - la constitución 1.22.0 en los dos repos, con la decisión nueva y su fecha.
- **RF-009**: Un intento bloqueado NO DEBE ir a la actividad, porque no cambia datos.

## Criterios de éxito *(obligatorio)*

- **CE-001**: En modo soporte, ningún camino de la historia clínica devuelve contenido. Las pruebas
  revisan cada uno: la historia, cada escritura, los archivos, la impresión y la actividad.
- **CE-002**: El propietario y un miembro autorizado hacen todo lo que hacen hoy. Las pruebas clínicas
  de hoy siguen pasando.
- **CE-003**: Un propietario lee en una frase, en la pantalla y en la política, que ni el soporte de
  Agenda360 ve la historia clínica.
- **CE-004**: Las pruebas pasan, y la pantalla se ve bien en los dos modos y a 390 px.

## Supuestos

- **El modo soporte** es cuando el super admin entra al panel de un negocio.
- **No hace falta migración:** no cambian datos, sólo quién puede pedirlos.
- **Los formatos de historia clínica** no son datos de pacientes: el soporte los sigue gestionando.
- **Riesgos aceptados**, que se anotan en la constitución:
  - El super admin pone las contraseñas y podría cambiar la del propietario y entrar como él. El
    propietario se enteraría: le llega la contraseña nueva por email y su sesión cambia.
  - Quien administra la base de datos y las copias de seguridad tiene acceso técnico a los datos. La
    política lo dice, y no se usa para leer historias.
- **La regla «auditar todo»** no aplica a los intentos bloqueados, porque no cambian datos.
- **La beta** lleva la política y los textos nuevos (los copia del front). No tiene modo soporte real
  que bloquear. El dueño del producto lo aprobó junto con la spec (2026-10-19).
