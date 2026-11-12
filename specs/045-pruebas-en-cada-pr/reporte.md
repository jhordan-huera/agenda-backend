# Reporte final: Pruebas automáticas en cada PR

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-11-12, PR backend #75 y front #59) · **Fecha**: 2026-11-12

**Repos**: los dos · **Migración**: No

## Resumen

Cada PR, y cada subida a `dev`, corre las comprobaciones en GitHub y sale en verde o en rojo, con el detalle de qué
falló:
- **en el backend,** el chequeo de tipos y las 73 suites de pruebas;
- **en el front,** la compilación, el lint y todas las comprobaciones.

Así se sabe si un PR rompe algo antes de fusionarlo, también los de Dependabot. Es gratis y no toca Vercel ni la base
de producción. Con la regla de `main` que pone el dueño del producto, no se puede fusionar a `main` algo en rojo.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Cada PR dice si pasa | P1 | Hecha | En los dos repos, en cada PR a `dev` o `main` y en cada subida a `dev` |
| H2 – Los PR de Dependabot se prueban | P1 | Hecha | Sin secretos, así que corre igual en sus PR; se comprueba con el próximo |
| H3 – No se fusiona a `main` algo roto | P2 | Hecha | La regla «main protegida», puesta por el dueño del producto en los dos repos el 2026-11-12 |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Backend: tipos y todas las suites | Cumple | La corrida de `dev` (3f2a267): `typecheck` y «73 de 73 suites pasaron» |
| RF-002 – Front: compilación, lint y comprobaciones | Cumple | La corrida de `dev` (befd358): build, lint y las 7 `check:*`, leídas de `package.json` |
| RF-003 – Verde o rojo, con el detalle | Cumple | Los PR de prueba #74 (backend) y #58 (front) salieron en rojo y dicen qué falló («✗ zz-prueba-roja.test.ts», «✗ prueba roja a propósito») |
| RF-004 – Sin secretos, producción, Vercel ni Lambda | Cumple | Los flujos no leen `secrets` ni `vars`, tienen `contents: read` y las pruebas usan su base desechable y datos demo |
| RF-005 – También en los PR de Dependabot | Cumple en el diseño | No necesita secretos. Se confirma con el próximo PR de Dependabot (CE-005) |
| RF-006 – La versión nueva cancela la anterior | Cumple | `concurrency` por PR o por rama, con `cancel-in-progress` |
| RF-007 – Cuándo corren | Cumple | `pull_request` a `dev` y `main`, y `push` a `dev`: la subida a `dev` corrió sola |
| RF-008 – `main` bloqueada si algo falla | Cumple | La regla «main protegida» está activa en los dos repos: no deja borrar ni forzar `main` y exige «Comprobar» (leída con `gh api …/rulesets`) |
| RF-009 – Los otros flujos no cambian | Cumple | `cron.yml`, `backup.yml` y `deploy-lambda.yml` sin tocar |
| RF-010 – La constitución | Cumple | 1.44.0 en los dos repos (principio IV) |
| CE-001 – El rojo y el verde | Cumple | Los PR de prueba en rojo (cerrados sin fusionar y con su rama borrada) y las corridas de `dev` en verde |
| CE-002 – El PR de esta función en verde | Cumple | Las corridas de `dev` de los dos repos, en verde |
| CE-003 – Menos de 20 minutos | Cumple | Backend 5 min (7 min con una suite más); front 40 s |
| CE-004 – Sin costo | Cumple | Repos públicos: GitHub Actions es gratis; no se usa Vercel |
| CE-005 – Dependabot | Sin comprobar | Con su próximo PR semanal |

**Pruebas:**
- **Con la hora en UTC en este equipo:** «72 de 73». Falló `payments.test.ts` (ver «Cambios respecto al plan»).
- **Arreglada esa prueba:** pasa con la hora de Ecuador y con UTC.
- **En GitHub:** «73 de 73 suites pasaron».

## Cambios respecto al plan

- **Se arregló una prueba frágil** que apareció al correr con la hora de GitHub. `payments.test.ts` movía una cita a
  «hace 30 y 31 días» a su hora de siempre. Según el día, chocaba con una cita de demo del mismo profesional (la
  restricción `appointments_no_overlap`): el 2026-11-12 fallaba con cualquier hora, el 11 no. Ahora la cita movida
  queda a las 23:10, una hora sin citas de demo. La caducidad del enlace cuenta sólo la fecha, así que se prueba lo
  mismo.
- **La constitución** suma en el principio IV que las pruebas no deben depender del día ni de la hora del equipo.

## Pendientes y riesgos

- **La regla de `main`** quedó puesta en los dos repos (2026-11-12). En el backend, el #75 se fusionó un momento
  antes de ponerla, ya en verde.
- **El próximo PR de Dependabot** debería salir en verde o en rojo solo.
- **Una caída de GitHub Actions** deja los PR en espera. Se vuelven a correr cuando vuelva.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 5578099 | Spec 045, aprobada |
| agenda-backend | 21cce0f | Spec 045: plan de implementación |
| agenda-backend | 3f2a267 | Spec 045: el flujo «Pruebas», la prueba de pagos y la constitución 1.44.0 |
| agenda-backend | (este commit) | Spec 045: tareas y reporte |
| agenda-front | befd358 | Spec 045: el flujo «Pruebas», Dependabot de acciones y la constitución 1.44.0 |

## Cómo publicarlo

1. **Sin migración ni variables.**
2. **Los PR `dev` → `main`** de los dos repos: deben salir en verde.
3. **El dueño del producto pone la regla de `main`** en los dos repos y los fusiona.

## Texto para el PR

Spec 045: cada PR a `dev` o `main` y cada subida a `dev` corren las comprobaciones en GitHub Actions.
- **Backend:** el chequeo de tipos y las 73 suites. **Front:** la compilación, el lint y todas las comprobaciones.
- **Sin secretos,** así que también corren en los PR de Dependabot.
- **Arregla una prueba de pagos** que fallaba según el día.
- **Sin migración.**

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/045-pruebas-en-cada-pr/reporte.md
