# Tareas: Pruebas automáticas en cada PR

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `back/` = agenda-backend, `front/` = agenda-front. Sin migración ni cambios en la app. La beta no cambia.

## Fase 1: Que las pruebas pasen fuera de la Mac

- [X] T001 `npm test` con la hora en UTC (la de los servidores de GitHub). Arreglar lo que falle: `back/tests/payments.test.ts` movía una cita a «hace 31 días» a una hora que, según el día, chocaba con una cita de demo (`appointments_no_overlap`)

## Fase 2: Cada PR dice si pasa (Historias 1 y 2, P1)

- [X] T002 [P] [US1] `back/.github/workflows/pruebas.yml`:
  - «Pruebas», con el trabajo «Comprobar»;
  - corre en los `pull_request` a `dev` y `main` y en los `push` a `dev`;
  - `ubuntu-24.04` y Node 24;
  - `npm ci --ignore-scripts`, `npm run typecheck` y `npm test`;
  - `contents: read`, sin secretos;
  - `concurrency` con `cancel-in-progress` y 30 minutos como máximo;
  - las acciones fijadas por SHA, como `cron.yml`.
- [X] T003 [P] [US1] `front/.github/workflows/pruebas.yml`: igual, con `npm run build`, `npm run lint` y todas las `check:*`, leídas de `package.json`
- [X] T004 [P] [US2] `front/.github/dependabot.yml`: el ecosistema `github-actions`, como en el backend

## Fase 3: La regla de `main` y el cierre (Historia 3, P2)

- [X] T005 Constitución 1.44.0 en los dos repos (principio IV) y los README (el flujo y los pasos de la regla de `main`)
- [X] T006 Subir a `dev`: las dos corridas del `push` salen en verde, con su tiempo (CE-002, CE-003)
- [X] T007 En cada repo, un PR de prueba (`prueba-045-rojo` → `dev`) con una prueba rota: sale en rojo y dice cuál falló. Después se cierra sin fusionar y se borra la rama (CE-001)
- [X] T008 Reporte final y PR `dev` → `main`. El dueño del producto pone la regla de `main` y fusiona

## Dependencias

- La fase 1 va primero.
- T002, T003 y T004 se pueden hacer a la vez.
- T006 y T007 necesitan los flujos subidos.
- La regla de `main` se pone cuando «Comprobar» ya corrió una vez.
