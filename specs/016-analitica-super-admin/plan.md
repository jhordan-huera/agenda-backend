# Plan de implementación: Analítica del super admin

**Rama**: `dev` · **Fecha**: 2026-10-15 · **Spec**: [spec.md](./spec.md)

**Documentos**:
- [research.md](./research.md) (decisiones R1–R9)
- [data-model.md](./data-model.md)
- [contracts/api.md](./contracts/api.md)
- [quickstart.md](./quickstart.md)

## Resumen

**Cómo funciona:**
- **Cada mañana,** después de las 06:00 de Ecuador, el cron de GitHub prepara una «foto» con todas las
  cifras de 30 y de 90 días.
- **La foto se guarda en la base** (migración 043). La página la lee, sin calcular nada, así que no
  gasta la CPU de Vercel (R1).
- **/admin → «Analítica»** tiene cuatro pestañas:
  - **Comparar:** la tabla de todos los negocios, ordenable, con filtros, CSV y enlace a la ficha
    (R2).
  - **Por tipo de negocio:** la mediana de cada tasa, la demanda por día y hora, y cada negocio frente
    a su tipo (R3).
  - **Salud y ventas:** la puntuación de 0 a 100 con sus motivos, la lista «En riesgo» con el contacto
    del propietario, y «Listos para subir de plan» (R4, R5).
  - **Uso y valor:** qué funciones usa cada negocio, la adopción de cada función, el valor del
    periodo, las inasistencias antes y después, y los totales para ventas (R6, R7).
- **La ficha del negocio** suma la tarjeta «Frente a su tipo», con su salud.

**Sin datos de pacientes** (R9), y los negocios no ven nada de esto. **Sin la beta** (decisión del
dueño).

## La puntuación de salud (para que la revises)

Se parte de 100 y se resta:
- **Nadie del equipo entra:**
  - hace más de 14 días: −30;
  - hace entre 7 y 14 días: −15.
- **Sin citas en el periodo:** −30.
- **Citas frente al periodo anterior:**
  - −50 % o peor: −25;
  - entre −20 % y −50 %: −15.
- **Más de 10 citas pasadas sin cerrar:** −10.
- **Sin reservas online:** −5.
- **Inasistencias muy por encima de su tipo:** −5.

Grupos: de 70 a 100, **sano**; de 40 a 69, **en riesgo**; menos de 40, **crítico**. Un negocio de
menos de 14 días sólo resta por el último acceso.

**«Listos para subir de plan»:**
- un Free al 80 % de su tope;
- crecer +30 % con 20 o más citas;
- un Pro con los 3 usuarios usados, o con 120 o más citas al mes en una sola agenda;
- un Business con todas sus agendas en uso.

## Contexto técnico

- **Lenguaje:** TypeScript.
- **Dependencias:** ninguna nueva. Los gráficos usan la librería que ya tiene el front.
- **Migración 043:** `analytics_snapshots`.
- **Variables nuevas:** ninguna.
- **Pruebas:** la suite nueva `tests/analytics.test.ts`, con cifras conocidas, y el recorrido del
  quickstart.
- **Restricciones:** la CPU de Vercel, porque todo se calcula en GitHub, y la privacidad.

## Comprobación contra la constitución (1.12.0 → 1.13.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | La página, los motivos y los documentos, en español. |
| II. Privacidad | Sí | Sólo cifras por negocio. El único contacto es el del propietario, que el super admin ya ve. Una prueba revisa que la foto no lleve datos de pacientes. |
| III. Decisiones | Sí | Sólo la ve el super admin. Los negocios siguen sin ver planes ni precios. «Negocios para vender» del Inicio no cambia. |
| IV. Local | Sí | `npm run analytics:refresh` y el recorrido, en local. |
| V. Compartido | Sí | Los tipos de la foto se editan en el front y se copian con `sync:shared`. |
| VI. Barato | Sí | Sin servicios ni dependencias. El cálculo corre en GitHub, no en Vercel. |
| VII. Diseño | Sí | Los componentes y colores de /admin. A 390 px, la tabla se desplaza dentro de su recuadro. |
| Restricciones | Sí | La migración 043 va antes del backend. |

**Constitución 1.13.0 (MENOR):** una línea en el principio III:
> La analítica de /admin (spec 016) sólo la ve el super admin, sólo con cifras por negocio, nunca con
> datos de pacientes, y se prepara una vez al día con el cron (2026-10-15).

## Estructura

```text
agenda-backend
  .specify/memory/constitution.md          1.13.0
  db/migrations/043_analytics_snapshots.sql NUEVO
  src/services/analytics-service.ts         NUEVO: buildSnapshot(days) (las consultas por negocio y por tipo,
                                            la salud, las oportunidades, las funciones y el valor), saveSnapshot,
                                            latestSnapshot, cleanup
  src/jobs/scheduled-tasks.ts, scripts/cron.ts   la foto de cada mañana y la línea del registro
  scripts/analytics-refresh.ts             NUEVO: npm run analytics:refresh
  src/routes/platform-routes.ts            GET /admin/analytics
  src/services/admin-service.ts            analytics en la ficha del negocio
  src/db/seed.ts                           la tabla nueva en TABLES
  tests/analytics.test.ts                  NUEVO
  README.md                                la analítica

agenda-front
  .specify/memory/constitution.md          1.13.0
  src/types/index.ts                       AnalyticsSnapshot y los tipos de R2–R7
  src/lib/data/repository.ts, api-repository.ts, hooks/queries   el pedido de la foto
  src/pages/admin/admin-analytics-page.tsx  NUEVO: las cuatro pestañas y el selector de periodo
  src/features/admin/analytics/            NUEVO: la tabla (ordenar, filtrar, CSV), los tipos, la salud, las funciones
  src/pages/admin/admin-business-detail-page.tsx   «Frente a su tipo»
  src/components/layout/nav-items.ts, src/app/router.tsx   «Analítica» en el menú
  README.md
```

## Publicación

1. **Constitución 1.13.0,** al aprobar este plan, en los dos repos.
2. **La migración 043,** como paso aparte:

   ```
   npm run db:migrate
   ```

3. **Primero el PR del backend y después el del front.**
4. **La primera foto** la prepara el cron en su siguiente pasada, si ya pasaron las 06:00. Si no, a la
   mañana siguiente. Para no esperar, se puede lanzar a mano el cron en GitHub → Actions → «Run
   workflow».

## Riesgos

- **Los pesos de la salud son una primera versión.** Se ajustan con la experiencia: son constantes en
  un solo archivo.
- **Las cifras son de la mañana:** lo que pasa durante el día sale al día siguiente.
- **Con muchos negocios,** preparar la foto tarda más. Corre en GitHub, con margen.

## Decisiones del dueño del producto (2026-10-15)

1. **Los cuatro bloques:** tabla comparativa, por tipo, salud y ventas, y uso y valor.
2. **La beta no lleva la analítica.**
3. **Aprobó los valores por defecto de la spec:** la página con cuatro pestañas, 30 o 90 días, sólo
   los activos por defecto, «pocos datos» con menos de 10 citas, una foto al día y nada para los
   negocios.

## Preguntas para el dueño del producto

Sólo una: la fórmula de la salud y los criterios de venta de arriba. Si te parecen bien, se usan tal
cual.
