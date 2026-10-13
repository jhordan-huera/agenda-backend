---
name: "speckit-reporte"
description: "Cierra una función de SDD con su reporte final (specs/NNN/reporte.md): qué se entregó, cómo se comprobó cada requisito, cambios respecto al plan, commits y cómo publicarla. También prepara el texto del PR dev → main."
argument-hint: "Carpeta de la función (p. ej. specs/002-pagos) o vacío para la actual"
compatibility: "Proyecto con Spec Kit (.specify/) de Agenda360"
metadata:
  author: "agenda360"
user-invocable: true
disable-model-invocation: false
---

## Entrada

```text
$ARGUMENTS
```

## Cuándo se usa

Es el último paso del flujo, después de `/speckit-implement` (y `/speckit-converge` si se usó).
También se usa al publicar, para marcar el reporte como "Publicada" con su PR.

## Pasos

1. **Carpeta de la función**: la que indique la entrada o, si está vacía, la de
   `.specify/feature.json` (`feature_directory`). Si no existe `spec.md` en ella, parar y decirlo.

2. **Leer**: `spec.md`, `plan.md`, `tasks.md` y, si existen, `research.md`, `quickstart.md`,
   `contracts/` y `.specify/memory/constitution.md`.

3. **Tareas pendientes**: si queda alguna `- [ ]` en `tasks.md`, listarla y preguntar al dueño del
   producto si se cierra así (se anota en "Pendientes y riesgos") o se termina antes. No presentar
   como completa una función con tareas abiertas.

4. **Comprobar de nuevo**, sólo en local (nunca en Vercel ni contra la base de producción):
   - agenda-front: `npm run build` y `npm run lint`.
   - agenda-backend: `npm run typecheck` y `npm test`.
   - Lo que pida `quickstart.md` y se pueda repetir con los scripts de la implementación.
   Anotar el resultado real. Si algo falla, decirlo en el reporte y al dueño del producto; no
   maquillarlo.

5. **Requisito por requisito**: cada `RF-…` y `CE-…` de la spec va en la tabla "Comprobación" con
   "Cumple", "No cumple" o "Sin comprobar" y la prueba concreta (medida, captura, test, flujo
   probado). Sin prueba no se escribe "Cumple".

6. **Cambios respecto al plan**: comparar la estructura de archivos y el diseño del plan con lo
   que se hizo (`git log` y `git diff` de los commits de la función). Anotar cada diferencia y su
   motivo.

7. **Commits**: los de la función en cada repo que toca (hash corto y mensaje).

8. **Cómo publicarlo**: según el plan, si hay migración (va primero y la aplica el dueño del
   producto con `npm run db:migrate`), el orden de los PR y qué mirar después de publicar.

9. **Escribir** `reporte.md` en la carpeta de la función con la plantilla
   `.specify/templates/reporte-template.md`, todo en español y sin datos de pacientes, claves ni
   emails reales. Poner en `spec.md` el estado `**Estado**: Implementada (AAAA-MM-DD)`.

10. **Responder al dueño del producto** en español: el resumen, el resultado de la comprobación,
    los pendientes y el enlace al reporte. No hacer push ni abrir el PR si no lo pidió.

## Al publicar (PR `dev` → `main`)

- La descripción del PR nombra cada función incluida con una línea de resumen y el enlace a su
  reporte en GitHub (`https://github.com/<usuario>/<repo>/blob/main/specs/NNN-nombre/reporte.md`),
  y dice si hay migración. Los cambios sueltos sin spec van en una lista aparte.
- Sin firma de herramientas de IA en el PR ni en los commits.
- Después de fusionar, actualizar el reporte: `**Estado**: Publicada (AAAA-MM-DD, PR #N)`.
