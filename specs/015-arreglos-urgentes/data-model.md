# Modelo de datos: Arreglos urgentes de la plataforma

**Migración**: `db/migrations/042_plan_since.sql` · **Decisiones**: [research.md](./research.md)

## `subscriptions.plan_since` (R5)

Columna `timestamptz not null`. Se rellena así:

```sql
coalesce(current_period_end - interval '30 days', <fecha del alta del negocio>)
```

`current_period_end - 30 días` es justo la hora del último cambio de plan. La columna toma `now()` en
cada cambio de plan. `current_period_end` se queda en la base para el cobro de otra spec.

## Emails: sin columnas nuevas (R1–R3)

La espera usa la cola de hoy: `notifications.status = 'queued'` y `next_attempt_at`. La prioridad sale
del tipo (`EMAIL_PRIORITY`, en `email-limits.ts`).
