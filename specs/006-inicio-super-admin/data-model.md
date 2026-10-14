# Modelo de datos: Inicio del super admin con datos importantes

**Spec**: [spec.md](./spec.md) · **Decisiones**: [research.md](./research.md)

## Migración `db/migrations/034_backup_runs.sql`

### `backup_runs` (tabla nueva)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint, identidad | Clave primaria |
| `ran_at` | timestamptz, obligatorio | `now()` |
| `ok` | boolean, obligatorio | false: la copia falló o se entregó con problemas en la restauración de prueba |
| `size_bytes` | bigint, nulo | Tamaño del archivo cifrado; null si no llegó a hacerse |
| `error` | text, obligatorio, por defecto `''` | Motivo ya limpio (sin URL de la base ni datos), máximo 500 caracteres |

- Índice por `ran_at desc`.
- RLS activada; la usa sólo el backend.
- La escribe `scripts/backup.ts` y la lee el inicio del super admin.

## Tipos compartidos (se editan en agenda-front y se copian con `npm run sync:shared`)

```ts
/** Una cifra del periodo actual y la del mismo periodo del mes pasado. */
interface GrowthPair { current: number; previous: number }

interface PlatformStats {
  // … lo de hoy, sin cambios
  /** NUEVO: crecimiento del mes (D1, D2). Fechas en Ecuador; `to` es hoy. */
  growth: {
    from: ISODate; to: ISODate; previousFrom: ISODate; previousTo: ISODate;
    appointments: GrowthPair; onlineBookings: GrowthPair; newClients: GrowthPair; newBusinesses: GrowthPair;
    /** NUEVO (historia 5): día 1 al mayor entre hoy y el último del mes pasado; null donde no hay día. */
    daily: { day: number; current: DailyCounts | null; previous: DailyCounts | null }[];
  };
  /** NUEVO: salud del sistema (D5). */
  health: {
    emailsToday: { sent: number; failed: number; queued: number };
    cron: { lastRunAt: ISODateTime | null; failures: number } ;
    backup: { ranAt: ISODateTime; ok: boolean; sizeBytes: number | null; error: string } | null;
    security: { failedLogins24h: number; accountsOnAlert: number };
    /** NUEVO (historia 5): emails de los últimos 14 días (hoy el último), en Ecuador. */
    emailsByDay: { date: ISODate; sent: number; failed: number }[];
  };
}

/** Lo de un día: citas agendadas, reservas online y pacientes nuevos (historia 5). */
interface DailyCounts { appointments: number; onlineBookings: number; newClients: number }

interface AdminBusinessSummary {
  // … lo de hoy, sin cambios
  /** NUEVO: citas agendadas del negocio en el periodo actual y en el anterior (D1). */
  growth: GrowthPair;
}
```

`cron.failures` suma los negocios con fallos de recordatorios y los emails que fallaron por última vez
en esa pasada. Sin pasadas registradas: `lastRunAt: null`.
