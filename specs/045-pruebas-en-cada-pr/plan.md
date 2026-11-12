# Plan de implementación: Pruebas automáticas en cada PR

**Rama**: `dev` · **Fecha**: 2026-11-12 · **Spec**: [spec.md](./spec.md)

**Sin migración ni cambios en la app.** Son dos flujos nuevos de GitHub Actions, uno por repo, la regla de `main` y la
constitución.

## Diseño

1. **El backend** (`back/.github/workflows/pruebas.yml`, nuevo, «Pruebas»):
   - **Cuándo corre** (respuesta 2): `pull_request` a `dev` y a `main`, y `push` a `dev`.
   - **Un solo trabajo, «Comprobar»,** en `ubuntu-24.04`, con 30 minutos como máximo:
     1. baja el código (`actions/checkout`, `persist-credentials: false`);
     2. Node 24, el de producción (`actions/setup-node`, con caché de npm);
     3. `npm ci` (con las dependencias de desarrollo: el chequeo de tipos las necesita);
     4. `npm run typecheck`;
     5. `npm test`.
   - **La base de prueba:** `scripts/test.ts` ya crea un PostgreSQL desechable con `initdb`, y los servidores de
     GitHub traen PostgreSQL 16 en `/usr/lib/postgresql/16/bin`, una de las rutas que busca `scripts/postgres-bin.ts`.
     No hace falta un servicio aparte ni ninguna variable.
   - **Las acciones** van fijadas por SHA, las mismas que `cron.yml`. Dependabot ya las actualiza en este repo.

2. **El front** (`front/.github/workflows/pruebas.yml`, nuevo, «Pruebas»):
   - **Cuándo corre:** igual que el backend.
   - **Un solo trabajo, «Comprobar»:**
     1. `npm ci`;
     2. `npm run build`;
     3. `npm run lint`;
     4. **todas** las comprobaciones `check:*`: se leen de `package.json`, así que una comprobación nueva entra sola.
   - **Sin variables:** sin `VITE_SENTRY_DSN` ni `SENTRY_AUTH_TOKEN`, la compilación no crea mapas ni sube nada,
     como en local.
   - **Dependabot del front** suma el ecosistema `github-actions`, como pide su propio comentario («si se añaden
     workflows, sumar github-actions como en agenda-backend»), para que actualice las acciones del flujo nuevo.

3. **En los dos flujos:**
   - **Permisos mínimos:** `contents: read`. Sin secretos ni `vars`, así que funcionan igual en los PR de Dependabot
     (respuesta 3: los fusiona el dueño del producto, no se agrega nada que los fusione solos).
   - **Se cancela la versión anterior** del mismo PR o de la misma rama (`concurrency` con `cancel-in-progress`).
   - **Los registros son públicos:** las pruebas usan los datos demo de `seed.ts` y claves generadas en cada corrida
     (VAPID, `PROXY_SECRET`). Nada real.
   - **Nada cambia** en `cron.yml`, `backup.yml` ni `deploy-lambda.yml`.

4. **La regla de `main`** (respuesta 1), en los dos repos, en Settings → Rules → Rulesets:
   - un «branch ruleset» para `main` que exija que pase «Comprobar» y no deje forzar ni borrar la rama;
   - **no exige** aprobaciones de otra persona (el dueño del producto trabaja solo);
   - **no exige** el chequeo de GitGuardian: si vuelve a dar una falsa alarma, el dueño del producto decide.

   La pone el dueño del producto con los pasos de abajo, o Claude con `gh api` si le da permiso. Se pone cuando el
   flujo ya corrió una vez, para que GitHub conozca el nombre «Comprobar».

5. **La constitución, 1.44.0, en los dos repos** (principio IV y el flujo de trabajo): cada PR y cada subida a `dev`
   corre las comprobaciones en GitHub Actions; `main` exige que pasen; el local sigue siendo el primer lugar donde se
   prueba.

**No se hace:**
- fusionar solos los PR de Dependabot (respuesta 3);
- las pruebas de la beta;
- vistas previas en Vercel: seguirían gastando su CPU.

## Lo que haces tú, después del primer PR en verde

En cada uno de los dos repos de GitHub:
1. **Settings → Rules → Rulesets → New ruleset → New branch ruleset.**
2. **Ruleset name:** `main protegida`. **Enforcement status:** `Active`.
3. **Target branches:** «Add target» → «Include default branch» (es `main`).
4. **Marca:**
   - «Restrict deletions»;
   - «Block force pushes»;
   - «Require status checks to pass» → «Add checks» → escribe `Comprobar` y elígelo.
5. **No marques** «Require a pull request before merging» con aprobaciones.
6. **Create.**

## Comprobación contra la constitución

| Principio | ¿Cumple? | Cómo |
|---|---|---|
| II. Privacidad | Sí | Sin secretos ni la base de producción; las pruebas usan datos demo y claves de cada corrida. Los registros públicos no llevan nada real |
| IV. Se comprueba en local, nunca en producción | Sí | Las comprobaciones corren en GitHub con una base desechable, nunca en Vercel ni contra producción. El local sigue siendo lo primero |
| VI. Barato de operar | Sí | GitHub Actions es gratis en repositorios públicos. No gasta CPU de Vercel |
| Flujo `dev` → `main` | Sí | `main` sólo recibe el PR de `dev`, ahora con las comprobaciones en verde |
| Sin firma de IA | Sí | Los flujos no comentan ni firman nada |

## Pruebas

- **Antes de subir:** `npm test` con la hora en UTC (la de los servidores de GitHub) en este equipo, para adelantarse
  a pruebas que dependan de la hora de Ecuador.
- **El PR de esta función** sale en verde en los dos repos (CE-002), con su tiempo (CE-003: menos de 20 minutos).
- **El rojo (CE-001):** en cada repo, un PR de prueba a `dev` desde una rama aparte (`prueba-045-rojo`) con una prueba
  rota a propósito. Sale en rojo y dice cuál falló. Después se cierra sin fusionar y se borra la rama.
- **Dependabot (CE-005):** el siguiente PR de Dependabot sale en verde o en rojo solo. Se anota en el reporte.

## Riesgos

- **Una prueba que pase en la Mac y falle en GitHub** (otra hora, otro sistema, menos CPU). Se arregla dentro de esta
  función. La corrida con la hora en UTC se adelanta a lo más probable.
- **El tiempo:** en la Mac, las 73 suites tardan unos minutos. Los servidores de GitHub son más lentos. Si pasan de
  20 minutos, se separan el chequeo de tipos y las pruebas en dos trabajos a la vez.
- **Una caída de GitHub Actions** deja los PR en espera. Se pueden volver a correr cuando vuelva.

## Cómo publicarlo

1. **Sin migración.**
2. **Los PR `dev` → `main`** de los dos repos. Son los primeros en correr las comprobaciones.
3. **Con los dos en verde,** el dueño del producto pone la regla de `main` (arriba) y los fusiona.
