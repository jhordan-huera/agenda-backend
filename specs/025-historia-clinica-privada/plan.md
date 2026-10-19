# Plan de implementación: Historia clínica privada: ni el soporte la ve

**Rama**: `dev` · **Fecha**: 2026-10-19 · **Spec**: [spec.md](./spec.md)

## Cómo es hoy

- **`authorize()`** (`src/services/context.ts`) trata a todo super admin como soporte: devuelve
  `{ role: "owner", support: true }`.
- **`authorizeClinical()`** (`src/services/clinical-service.ts`) deja pasar al propietario, y por eso
  también al soporte. Lo usan la historia, las escrituras, los archivos **y los formatos**
  (`listTemplates`, `clinical-template-service.ts`).
- **`setClinicalAccess`** (`account-service.ts`) y **`auditLogService.list`** (`activity-service.ts`)
  también tratan al soporte como propietario.
- **En el front,** `session-provider.tsx` le pone `clinicalAccess: true` a la sesión de soporte, y
  `useClinicalAccess()` decide qué se ve: la pestaña, la impresión, los botones de la cita, la tarjeta
  de configuración y las páginas de formatos.

## Diseño

1. **El bloqueo en la API**, un solo punto, seguro por defecto:
   - `authorizeClinical()` rechaza al soporte con `forbidden` y el mensaje compartido
     `CLINICAL_SUPPORT_BLOCKED_MESSAGE`: «Por privacidad, el soporte de Agenda360 no tiene acceso a la
     historia clínica de los pacientes.»
   - Así quedan bloqueados, sin tocarlos uno por uno, `get` (que también alimenta la impresión),
     `saveProfile` (los antecedentes y el consentimiento), `addNote`, `addAddendum` y los archivos:
     `requestUpload`, `completeUpload` y `downloadUrl`. Cualquier ruta clínica nueva que use
     `authorizeClinical()` nace bloqueada.
   - **Los formatos** pasan a `authorizeClinicalTemplates()`, nueva, con la regla de hoy (el soporte
     pasa): `listTemplates` y `clinical-template-service.ts` (crear, ver, editar, activar y elegir el
     formato del negocio).
   - **Se quitan las ramas `actor.support`,** que ya no se alcanzan: en `get`, no registrar la consulta
     del soporte, y en `downloadUrl`, no registrar la apertura.
2. **Sin atajos:**
   - `setClinicalAccess`: si `actor.support`, `forbidden` con «Sólo el propietario puede dar o quitar
     el acceso a la historia clínica.»
   - `auditLogService.list`: `clinicalAccess = !actor.support && (owner || miembro autorizado)`. Al
     soporte no le salen los eventos `clinical_record`, pero sí los de `team`.
   - **Repaso del resto de caminos del super admin:**
     - `admin-service` sólo crea (el propietario nace con acceso) y borra;
     - `analytics-service` cuenta evoluciones;
     - `database-stats-service` mide tamaños;
     - `business-data-service` sólo mira si existe una historia (el aviso al eliminar un paciente).

     Ninguno lee contenido: no se cambian, y la prueba lo deja anotado.
3. **El mensaje compartido:** `CLINICAL_SUPPORT_BLOCKED_MESSAGE` va en `src/lib/constants/business.ts`
   del front (compartido) y llega al backend con `npm run sync:shared`.
4. **El front:**
   - **`session-provider.tsx`:** en modo soporte, `clinicalAccess: false`. Por eso el filtro de
     Actividad (`activity-log.tsx`) ya esconde el tipo «Historia clínica».
   - **`use-clinical-access.ts`** suma dos hooks:
     - `useClinicalSupportBlocked()`: la historia está activada y es el modo soporte;
     - `useClinicalTemplatesAccess()`: la historia está activada y hay acceso clínico o es el modo
       soporte.
   - **`client-detail-page.tsx`:** en modo soporte, con la historia activada, la pestaña «Historia
     clínica» sigue, con un `EmptyState` (`ShieldCheck`): «Por privacidad, el soporte de Agenda360 no
     tiene acceso a la historia clínica de los pacientes.» Debajo: «Sólo la ven el propietario y las
     personas que él autoriza.»
   - **`clinical-print-page.tsx`:** el mismo aviso en vez de «No tienes acceso».
   - **`appointment-details-sheet.tsx`:** en modo soporte, en lugar de «Registrar evolución» y «Ver
     historia», una línea pequeña con el candado y «La historia clínica no se ve en modo soporte».
   - **`team-settings.tsx`:** en modo soporte, el interruptor «Historia clínica» está deshabilitado,
     con «Sólo el propietario puede dar o quitar el acceso a la historia clínica».
   - **Los formatos:** `clinical-settings-card.tsx`, `clinical-templates-page.tsx` y
     `clinical-template-editor-page.tsx` usan `useClinicalTemplatesAccess()`, para que el soporte los
     siga gestionando.
   - **Los textos:**
     - en `clinical-settings-card.tsx`: «Sólo la ves tú y las personas que autorices en Equipo (ni el
       soporte de Agenda360 puede verla); cada acceso queda registrado y nada se puede borrar.»;
     - en `clinical-record-tab.tsx`: «Sólo la ven tú y las personas autorizadas, ni el soporte de
       Agenda360. Cada acceso queda registrado.»
5. **La política de privacidad** (`privacy-page.tsx`, sección 5): `LAST_UPDATED` pasa a «19 de octubre
   de 2026», y el punto del soporte pasa a decir:
   > **El soporte de Agenda360** puede entrar al panel de un negocio para darle asistencia, y ahí ve lo
   > mismo que su propietario, **salvo la historia clínica**: no puede abrirla, ni sus archivos, ni
   > cambiarla. Todo lo que cambie queda en el registro de actividad del negocio.

   Se añade otro punto:
   > **El acceso técnico a la base de datos** queda reservado al mantenimiento del servicio y a las
   > copias de seguridad (cifradas), y no se usa para leer historias clínicas.
6. **La beta** (`~/Documentos/Proyectos/Betas/agenda-beta`): `privacy-page.tsx`, los dos textos y la
   constante compartida. No tiene modo soporte real.
7. **La constitución, 1.22.0 (MENOR), igual en los dos repos:**
   - **La decisión vigente pasa a:** «En modo soporte el super admin tiene permisos de propietario,
     salvo la historia clínica: no ve ni cambia antecedentes, evoluciones, archivos ni su actividad, ni
     da o quita el acceso clínico al equipo (2026-10-19). No se avisa al negocio de la entrada ni se
     registran sus consultas, sólo lo que crea o cambia.»
   - **En el principio II:** «La historia clínica sólo la ven el propietario y los miembros que él
     autoriza; ni el soporte de la plataforma (spec 025).»
   - **Riesgos aceptados:** el super admin pone las contraseñas y podría entrar como el propietario,
     que se enteraría; el acceso técnico a la base y a las copias.

**Migración:** ninguna. **Variables:** ninguna.

## Pruebas

**Backend:**
- **`tests/clinical-support.test.ts`** (nueva, contra la base desechable), con el super admin en modo
  soporte en la Clínica Dental (historia activada, con datos demo y un archivo subido por el
  propietario):
  - 403 con el mensaje de privacidad en cada camino:
    - leer la historia;
    - guardar los antecedentes y el consentimiento;
    - registrar una evolución y una aclaración;
    - pedir, completar y abrir un archivo;
    - dar y quitar el acceso clínico a un miembro;
  - ninguno cambia nada: los conteos de evoluciones, aclaraciones, archivos y actividad quedan igual,
    y `clinical_access` del miembro también;
  - la actividad que ve el soporte no trae eventos `clinical_record`, pero sí los de `team`;
  - **sigue pudiendo:**
    - listar y crear formatos, y elegir el del negocio;
    - activar y desactivar la historia clínica;
    - ver los pacientes;
  - **el propietario y un miembro autorizado** siguen leyendo, escribiendo y abriendo el archivo.
- **Se actualizan,** porque hoy prueban lo contrario:
  - `tests/clinical.test.mjs`: el soporte ve la historia y da acceso clínico. Pasa a 403. El registro
    «lo que el super admin cambia sí queda» se prueba con otro cambio de equipo que sí puede hacer;
  - `tests/security-scope.test.ts`: el soporte abre una historia y descarga un archivo. Pasa a 403.
- **La suite completa** y `npm run typecheck`.

**Front:**
- build, lint y `check:contrast`;
- **el recorrido** en modo soporte, en los dos modos y a 390 px:
  - la pestaña muestra el aviso;
  - la impresión muestra el aviso;
  - la cita muestra la línea en vez de los botones;
  - el interruptor de Equipo está deshabilitado;
  - los formatos se abren y se editan;
  - en Actividad no está el tipo «Historia clínica»;
- **el recorrido como propietario:** todo igual que hoy.

## Publicación

1. **Sin migración.** Primero el backend y después el front, en el mismo rato. Mientras tanto, si el
   soporte abre una historia, el front viejo muestra el error de la API: no hay fuga, sólo un mensaje
   menos claro.
2. **Después de publicar,** entrar en modo soporte a un negocio con historia y comprobar el aviso.
   Mirar también la política en `/privacidad`.
3. **La beta,** con su commit propio.
