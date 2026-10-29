# Reporte final: Cualquier documento de identidad, de cualquier país

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada (2026-10-29) · **Fecha**: 2026-10-29

**Repos**: agenda-backend y agenda-front (y la beta) · **Migración**: No

## Resumen

El campo de siempre acepta la cédula ecuatoriana, el pasaporte o el documento de cualquier país: de 5 a 20
letras y números, sin comprobar el dígito verificador.
- **Dónde:** la reserva online, para quien reserva y para cada persona de la sesión; la ficha del paciente;
  los antecedentes de la historia clínica; y la importación desde Excel.
- **Lo que no cambia:** las etiquetas y no hay campos nuevos. Sólo cambia la ayuda bajo el campo: antes decía
  «Sólo números», ahora dice que vale cualquier documento.
- **En el celular,** el campo ya no abre el teclado numérico, para poder escribir letras.
- **Al escribirlo,** el documento se guarda en mayúsculas y sin espacios, puntos ni guiones: `V-12.345.678`
  queda `V12345678`.
- **Se quitó la ayuda «¿No tienes cédula ecuatoriana?»** de la página de reservas, porque ya no hace falta.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Un extranjero reserva por la página | P1 | Hecha | También la otra persona de una sesión en pareja |
| H2 – El negocio registra a un paciente extranjero | P1 | Hecha | Y en los antecedentes de la historia clínica |
| H3 – Importar con documentos de otros países | P2 | Hecha | Se mantiene el 0 que quita Excel a una cédula de 9 dígitos |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Cualquier documento, sin campos nuevos | Cumple | Recorrido: `V-12.345.678` reserva y queda `V12345678`; en el celular, un pasaporte en minúsculas pasa a mayúsculas; en el panel, `ab-1234567` crea el paciente `AB1234567`. Con signos o menos de 5 caracteres, sale el error |
| RF-002 – La API con la misma regla | Cumple | `tests/foreign-document.test.ts`, 13 de 13: la cédula venezolana, el pasaporte, los signos y los menos de 5 caracteres. `cedula.test.mjs`: la búsqueda antigua, la ficha y los antecedentes clínicos |
| RF-003 – Reconocimiento del paciente | Cumple | Prueba nueva: con el mismo pasaporte y el mismo email, es el mismo paciente; con otro email y otro teléfono, queda «Por verificar». El pasaporte repetido en la ficha da 409 |
| RF-004 – Constitución y beta | Cumple | Constitución 1.31.0, idéntica en los dos repos. La beta tiene los mismos archivos y sus repositorios de prueba sin la comprobación; compila y pasa el lint |
| CE-001 – Las pruebas del backend | Cumple | Prueba nueva, 13 de 13. Se ajustaron `cedula.test.mjs`, `client-import.test.ts` y `client-required-fields.test.ts`: las filas que fallaban por el dígito verificador ahora fallan por signos o por ser cortas |
| CE-002 – Las comprobaciones | Cumple | Backend: `typecheck` y `npm test`, 70 de 70 suites. Front: build, lint, `check:contrast`, `check:data-export`, `check:board` y `check:admin-calendar`. Beta: build y lint |
| CE-003 – Computador y celular | Cumple | Recorrido con base desechable: 19 de 19 comprobaciones, Chromium a 1440 px en claro y WebKit a 390 px en oscuro, sin desbordes ni errores en la consola, con capturas |

## Cambios respecto al plan

- **El primer plan llevaba un selector** («Cédula ecuatoriana» / «Pasaporte u otro país»). El dueño del
  producto lo descartó antes de que se escribiera código: «no agregues más campos… que me acepte cualquier
  documento». La spec, el plan y las tareas se reescribieron con esa decisión.
- **El documento de los antecedentes clínicos** también acepta letras, con `optionalDocumentField`. Así no
  rechaza el pasaporte que ya se aceptó en la ficha.
- **`resolveBookingClient`** ya no recibe `otherName`, que sólo servía para el mensaje de la cédula no válida.

## Pendientes y riesgos

- **Riesgo aceptado:** una cédula ecuatoriana mal escrita ya no se detecta, y puede crear un paciente
  repetido. Si pasa, se corrige editando el documento en la ficha.
- **Las páginas abiertas antes de publicar** siguen con el filtro de sólo números hasta que se recarguen.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 3a30b87 | Spec 038: el documento del paciente puede ser la cédula, el pasaporte o el de cualquier país (de 5 a 20 letras y números); la API ya no exige la cédula ecuatoriana en la reserva online, la ficha ni la importación; prueba nueva, pruebas ajustadas, spec, plan y tareas; constitución 1.31.0 |
| agenda-front | 1d324e8 | Spec 038: el documento del paciente puede ser la cédula, el pasaporte o el de cualquier país (de 5 a 20 letras y números) en el mismo campo de siempre, en la reserva online, la ficha, los antecedentes clínicos y la importación; ya no se exige la cédula ecuatoriana; constitución 1.31.0 |

## Cómo publicarlo

1. **Sin migración.**
2. **El PR `dev` → `main` del backend** y después el del front. El del front se abre sin la portada nueva, que
   aún no está aprobada.
3. **Después, en producción:** reservar con un documento de otro país en la página de reservas y comprobar
   que sale la cita.

## Texto para el PR

Spec 038: el documento del paciente puede ser la cédula, el pasaporte o el de cualquier país, de 5 a 20 letras
y números, en el mismo campo de siempre. Ya no se exige la cédula ecuatoriana. Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/038-documento-de-otro-pais/reporte.md
