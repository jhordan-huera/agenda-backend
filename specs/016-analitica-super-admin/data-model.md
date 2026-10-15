# Modelo de datos: Analítica del super admin

**Migración**: `db/migrations/043_analytics_snapshots.sql`

## `analytics_snapshots`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid, clave | |
| `period_days` | integer | `check (period_days in (30, 90))` |
| `computed_at` | timestamptz | `not null default now()` |
| `day` | date | `not null`: el día de la foto, en la hora de Ecuador |
| `data` | jsonb | `not null`: `AnalyticsSnapshot` (abajo) |

Clave única `(period_days, day)`: una foto por periodo y día. RLS activado. El cron borra las de más de
30 días.

## `AnalyticsSnapshot` (tipo compartido, `src/types/index.ts`)

```ts
interface AnalyticsSnapshot {
  computedAt: ISODateTime;
  periodDays: 30 | 90;
  businesses: BusinessAnalytics[];   // una por negocio (activos y suspendidos; el front filtra)
  categories: CategoryAnalytics[];   // una por tipo, más «Sin tipo»
  platform: PlatformTotals;          // totales y adopción de cada función
}

interface BusinessAnalytics {
  id; name; category; plan; status; createdAt;
  owner: { name; phone; email } | null;
  appointments; previousAppointments; growth: number | "new";
  onlineRate; noShowRate; cancelRate; confirmRate;   // null si «pocos datos»
  activeClients; newClients;
  estimatedRevenue; collected; averageTicket;
  planUsage: { appointments: { used; limit | null }; clients: { used; limit | null } };
  agendas: { active; contracted | null };
  lastTeamLoginAt | null;
  health: { score; group: "healthy" | "risk" | "critical"; reasons: string[] };
  upsell: string[];                                    // los motivos de R5
  features: Record<FeatureKey, boolean>;
  value: { appointments; online; reminders; confirmations; timelyCancellations;
           noShowBefore | null; noShowAfter | null };
  fewData: boolean;
}
```

`CategoryAnalytics` tiene `{ id, name, businesses, medians: {...}, averageTicket, appointmentsPerAgenda,
topDays, topHours, fewData }`.
