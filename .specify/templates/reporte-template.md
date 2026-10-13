# Reporte final: [NOMBRE DE LA FUNCIÓN]

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: [Implementada en dev | Publicada (AAAA-MM-DD, PR #N)] · **Fecha**: [AAAA-MM-DD]

**Repos**: [agenda-front | agenda-backend | los dos] · **Migración**: [No | Sí: `NNN_nombre.sql`]

## Resumen

[De 2 a 4 frases para el dueño del producto: qué cambia para quien usa la app. Sin detalles
técnicos.]

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| [H1 – título] | P1 | [Hecha / Parcial / Fuera] | |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| [RF-001 – resumen] | [Cumple / No cumple / Sin comprobar] | [prueba, medida o captura] |
| [CE-001 – resumen] | [Cumple (medido: …)] | |

**Pruebas automáticas**: [comandos y resultado, p. ej. `npm run build` y `npm run lint` sin
errores; `npm test` 39/39].

## Cambios respecto al plan

- [Qué se hizo distinto y por qué, o "Ninguno".]

## Pendientes y riesgos

- [Lo que quedó fuera, riesgos aceptados o pasos del dueño del producto, o "Ninguno".]

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| [agenda-front] | [abc1234] | [mensaje] |

## Cómo publicarlo

1. [Si hay migración: el dueño del producto la aplica antes con `npm run db:migrate` en
   agenda-backend.]
2. [PR `dev` → `main` en cada repo, en orden: primero el backend si el front depende de su API.]
3. [Qué mirar después de publicar, sólo leyendo: p. ej. que el despliegue de Vercel esté "Ready".]

## Texto para el PR

[De 3 a 5 líneas para pegar en la descripción del PR: qué cambia, si hay migración y el enlace a
este reporte.]
