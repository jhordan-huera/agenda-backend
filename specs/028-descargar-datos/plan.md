# Plan de implementación: Descargar los datos del negocio

**Rama**: `dev` · **Fecha**: 2026-10-20 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **Quién descarga** (`src/services/data-export-service.ts`, nuevo), con `authorizeExport(db, ctx,
   businessId)`:
   - **el soporte (`actor.support`)** recibe `forbidden` con «Por privacidad, sólo el propietario y
     cada profesional descargan sus datos»;
   - **el propietario** descarga todo el negocio;
   - **el rol Profesional** descarga su agenda: sus pacientes, con la misma regla de «sólo sus
     pacientes» de `agenda-scope.ts` (sus citas o los que él registró) aunque el negocio esté en
     «todos», y las citas de su agenda;
   - **el administrador y la recepción** reciben `forbidden`;
   - **la historia clínica** va sólo si hay acceso clínico (el propietario siempre; el profesional, si
     el propietario se lo dio) y la historia está activada.

2. **La API, por partes** (`business-routes.ts`). Todas las rutas llevan `Cache-Control: no-store` y
   `limitRequests({ name: "descarga-datos", windowMinutes: 15, max: 600 })`:
   - **`GET /businesses/:id/export`:** el resumen. Devuelve:
     - qué se puede llevar (todo o lo suyo);
     - cuántos pacientes, citas, historias y archivos;
     - el nombre del negocio para el ZIP.

     Aquí se registra la actividad, una vez por descarga: «Descargó los datos del negocio (N
     pacientes, N citas y N historias clínicas)», o «Descargó sus datos…» para el profesional
     (`business.data_exported`).
   - **`GET …/export/clients?cursor=`:** 500 pacientes por parte, con todos sus datos (email y
     teléfono completos: son del negocio).
   - **`GET …/export/appointments?cursor=`:** 1000 citas por parte, con los nombres de pacientes,
     servicio y profesional.
   - **`GET …/export/clinical?cursor=`:** 50 pacientes por parte, cada uno con:
     - antecedentes y consentimiento;
     - evoluciones con su formato (la versión y sus campos) y aclaraciones;
     - los datos de sus archivos (id, nombre, tipo y tamaño).

     No registra «Consultó la historia clínica» por paciente: la descarga ya quedó registrada.
   - **`POST …/export/attachments/:attachmentId`:** el enlace firmado de 5 minutos de un archivo, sin
     registro por archivo. Comprueba que el archivo es de un paciente que esa persona puede
     llevarse.

   Las partes cortas mantienen cada respuesta lejos del tope de 6 MB de Lambda.

3. **El ZIP se arma en el navegador** (`front/src/features/data-export/`, nuevo):
   - **Dependencias nuevas,** cargadas sólo al tocar «Descargar» (`import()`), con justificación según
     la constitución, porque no hay nada parecido en el proyecto:
     - `fflate`: arma el ZIP en el navegador; pequeña y sin dependencias;
     - `write-excel-file`: del mismo autor que `read-excel-file`, que ya usa la importación.
   - **`pacientes.xlsx`:** encabezados que la importación reconoce («Nombre», «Cédula», «Email»,
     «Teléfono», «Dirección», «Notas»), más «Activo», «Por verificar» y «Fecha de alta».
   - **`citas.xlsx`:** una fila por cita.
   - **`historias-clinicas/<Apellido Nombre - cédula>.html`** (`clinical-html.ts`):
     - una página independiente, con estilos dentro (claros, para imprimir) y el texto escapado;
     - lleva el negocio, el paciente, los antecedentes, el consentimiento, las evoluciones en orden
       (fecha, autor y formato), cada campo según su tipo y las aclaraciones;
     - cada tipo de campo, en texto: escalas, listas, cuestionarios con total, interpretación y
       respuestas, IMC, el odontograma (piezas y estado) y el mapa del cuerpo (zonas y notas);
     - enlaces relativos a sus archivos;
     - usa las funciones de etiquetas y formato que ya existen en `features/clinical`.
   - **`historias-clinicas/archivos/<paciente>/`:** cada adjunto, descargado con su enlace firmado. Si
     falla uno, se anota y se sigue.
   - **`LEEME.html`:** qué trae, cómo guardar una historia como PDF, la fecha y los archivos que no se
     pudieron incluir.
   - **Los nombres de archivo** pasan por una función que quita lo que los sistemas no aceptan y
     resuelve los repetidos.

4. **La pantalla:**
   - **`data-export-card.tsx`:** en Configuración → Negocio para el propietario, y en Perfil para el
     rol Profesional («Descargar mis datos»):
     - qué trae el ZIP y, para el profesional sin acceso clínico, que no lleva historias;
     - el botón y el avance («Pacientes 500 de 1.200», «Archivos 12 de 40»);
     - los errores con «Reintentar».
   - **No sale** en modo soporte ni para el administrador ni la recepción.
   - **Funciona a 390 px:** el ZIP queda en Archivos o Descargas.
   - **«Eliminar negocio»** en /admin (`delete-business-dialog.tsx`) suma el recordatorio y la última
     descarga, que entrega `adminService.getBusiness` como `lastDataExportAt`, tomada de la
     actividad.
   - **La política de privacidad:** la portabilidad pasa a ser desde el panel. Cambia
     `LAST_UPDATED`.
   - **La etiqueta de la acción nueva** en la actividad, en las listas del front.

5. **Constitución 1.24.0** (MENOR), en las decisiones vigentes: «Los datos del negocio (pacientes,
   citas, historias clínicas y archivos) los descargan el propietario (todo) y cada profesional (lo
   suyo, y las historias sólo con acceso clínico); nunca el super admin, tampoco en modo soporte
   (spec 028, 2026-10-20)».

**Migración:** ninguna. **Variables:** ninguna.

## Pruebas

**Backend** (`tests/data-export.test.ts`, nueva):
- **Quién:**
  - el propietario recibe todo;
  - el profesional, sólo su agenda (ninguna cita, paciente ni historia de otro profesional, y lo
    comprueba con las de Valeria y Andrés);
  - el administrador, la recepción y el super admin en modo soporte reciben 403 en cada ruta, también
    en la de pacientes;
  - sin sesión, 401.
- **Completo:** recorriendo las partes, la suma coincide con el resumen y con la base, sin repetidos.
- **Clínico:**
  - sin acceso clínico, ni historias ni archivos;
  - con acceso, las evoluciones traen los campos de su formato;
  - no aparecen registros «Consultó la historia clínica» nuevos.
- **Archivos:** el enlace firmado sólo para pacientes permitidos, y 404 para un archivo ajeno.
- **Actividad:** una sola entrada por descarga, con las cifras.
- **Las respuestas:** llevan `no-store`, y está el límite de peticiones.

**Front:**
- build, lint y `check:contrast`;
- una prueba de ida y vuelta (script con Node):
  - los encabezados de `pacientes.xlsx` los reconoce `guessColumns` de la importación;
  - `clinical-html.ts` escapa el texto y pinta cada tipo de campo de los formatos de la plataforma;
- el recorrido, en Chromium y en WebKit a 390 px:
  - el propietario descarga y se revisa el ZIP (los archivos que trae, el Excel y una historia);
  - el profesional descarga sólo lo suyo;
  - en modo soporte no está el botón.

## Publicación

Sin migración. Primero el backend y después el front.
