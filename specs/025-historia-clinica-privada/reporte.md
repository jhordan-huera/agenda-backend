# Reporte final: Historia clínica privada: ni el soporte la ve

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-19, PR backend #51 y front #37) · **Fecha**: 2026-10-19

**Repos**: los dos, y la beta (sólo la política y los textos) · **Migración**: No

## Resumen

El super admin, en modo soporte, ya no puede ver ni cambiar la historia clínica de los pacientes:
- ni los antecedentes, el consentimiento, las evoluciones, las aclaraciones o los cuestionarios;
- ni los archivos ni la impresión;
- ni los eventos clínicos de la actividad, tampoco desde /admin.

La API lo rechaza con «Por privacidad, el soporte de Agenda360 no tiene acceso a la historia clínica de
los pacientes». La pantalla muestra ese aviso en la pestaña, la impresión y la cita.

**Sin atajos:** el soporte no puede dar ni quitar el acceso clínico a los miembros del equipo. Eso sólo
lo hace el propietario desde su sesión.

**Lo que el soporte sigue haciendo:** gestionar los formatos, activar o desactivar la historia
clínica, y todo lo demás del panel.

**Dentro del negocio no cambia nada:** el propietario y los miembros que él autoriza.

**Textos:**
- la política de privacidad, actualizada el 19 de octubre de 2026;
- la tarjeta de Configuración y la pestaña;
- la constitución 1.22.0 en los dos repos.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La API rechaza todo lo clínico al soporte | Cumple | `clinical-support`: 403 con el mensaje al leer, guardar antecedentes, registrar una evolución y una aclaración, pedir, completar y abrir un archivo. Con la historia desactivada, también el mensaje de privacidad. Al quitar los dos bloqueos un momento, la suite dio 17 ✗ |
| RF-002 – Sin dar ni quitar el acceso clínico | Cumple | `clinical-support` y `clinical`: 403 con «Sólo el propietario…». El acceso de Elena no cambia |
| RF-003 – La actividad, sin eventos clínicos | Cumple | `clinical-support`: ni en la lista ni filtrando por tipo o por acción. Los cambios de equipo sí salen. Recorrido: la consulta del propietario («Consultó la historia clínica de…») no le sale al soporte |
| RF-004 – El aviso en la pantalla | Cumple | Recorrido: la pestaña, la impresión (sin «Imprimir»), la cita (sin «Registrar evolución») y el interruptor de Equipo deshabilitado, con su línea |
| RF-005 – /admin, sin contenido clínico | Cumple | `clinical-support`: la ficha del negocio y la actividad de la plataforma, sin eventos clínicos, ni filtrando. Recorrido: las dos pantallas |
| RF-006 – El propietario y los autorizados, igual | Cumple | `clinical-support`, `clinical`, `clinical-custom` y `security-scope`. Recorrido: el propietario ve la historia y el interruptor se puede cambiar |
| RF-007 – El soporte sigue con los formatos y lo demás | Cumple | `clinical-support`: listar, crear y elegir formatos, desactivar y activar la historia, listar pacientes. Recorrido: los formatos se abren |
| RF-008 – Los textos, la política y la constitución | Cumple | Recorrido de la tarjeta y la política. Constitución 1.22.0, idéntica en los dos repos (`diff`) |
| RF-009 – Un intento bloqueado no va a la actividad | Cumple | `clinical-support` y `security-scope`: los `audit_logs` cuentan lo mismo antes y después |
| CE-001 a CE-004 | Cumple | Las de arriba. Recorrido: 22 ✓ en cada una de las cuatro combinaciones (Chromium a 1440 px y WebKit a 390 px, claro y oscuro), sin desplazamiento horizontal |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test`: 64 de 64 suites, con 2766 ✓ y 0 ✗.
- **Front:** build, lint y `check:contrast` sin errores.
- **Beta:** el build, sin errores.

## Cambios respecto al plan

- **/admin también muestra la actividad.** Al repasar los caminos del super admin aparecieron dos
  pantallas que enseñaban los eventos de la historia clínica: la actividad reciente de la ficha del
  negocio y la actividad de toda la plataforma. Muestran pacientes, formatos y nombres de archivos,
  no el contenido. Ahora las dos los excluyen, y la pantalla de actividad de /admin ya no tiene el
  filtro «Historias clínicas». Lo pide RF-005.
- **El aviso es un componente propio,** `clinical-support-notice.tsx`, que comparten la ficha y la
  impresión.
- **En Equipo, la línea del candado** va una sola vez bajo la lista, no en cada fila, porque a 390 px
  se rompía.
- **Otros textos que decían que el soporte ve la historia:**
  - la pantalla que pide la verificación en dos pasos: «…todos los negocios y sus pacientes»;
  - comentarios en `context.ts`, `business-routes.ts`, `types/index.ts`, `auth/types.ts` y
    `repository.ts`.
- **La sección 7 de la política** (proveedores), a pedido del dueño del producto: el servidor de la
  aplicación es Amazon Web Services (la API está en AWS Lambda desde el 2026-10-19), y Vercel sirve la
  página web. También en la beta.
- **La prueba de que lo que cambia el soporte queda registrado** usa un cambio de rol, porque el
  soporte ya no da acceso clínico.

## Pendientes y riesgos

- **Riesgos aceptados,** anotados en la constitución:
  - el super admin pone las contraseñas y podría entrar como el propietario, que se enteraría por el
    email de la contraseña nueva;
  - el acceso técnico a la base y a las copias de seguridad llega a los datos. La política lo dice.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | (el de esta entrega) | Spec 025: la historia clínica, privada también para el soporte (spec, plan, tareas, constitución 1.22.0 y backend) |
| agenda-front | (el de esta entrega) | Spec 025: la historia clínica, privada también para el soporte (front y constitución 1.22.0) |

## Cómo publicarlo

1. **Sin migración.**
2. **Primero el PR del backend y después el del front,** en el mismo rato. Mientras tanto, si el soporte
   abre una historia, el front viejo muestra el error de la API: no hay fuga, sólo un mensaje menos
   claro.
3. **Después:** entrar en modo soporte a un negocio con historia y comprobar el aviso, y mirar
   `/privacidad`.

## Texto para el PR

Spec 025: la historia clínica, privada también para el soporte.
- **El soporte ya no la ve ni la cambia:** ni los antecedentes, las evoluciones, los archivos o la
  impresión, ni sus eventos en la actividad, tampoco desde /admin. Tampoco da acceso clínico al
  equipo.
- **Sigue gestionando** los formatos y lo demás del panel.
- **La pantalla** muestra un aviso de privacidad, y la política de privacidad lo dice.
- **Constitución 1.22.0.**

**Migración:** ninguna.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/025-historia-clinica-privada/reporte.md
