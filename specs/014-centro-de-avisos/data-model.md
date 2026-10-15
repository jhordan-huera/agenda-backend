# Modelo de datos: Centro de avisos en el panel

**Migración**: `db/migrations/041_panel_notices.sql` · **Decisiones**: [research.md](./research.md) R1–R3, R7, R9, R13

## `panel_notices`: un aviso por suceso

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid, clave | `gen_random_uuid()` |
| `business_id` | uuid, nulo = plataforma | `references businesses on delete cascade` |
| `kind` | text | `check (kind in (...))` con los 11 tipos de R13; los 7 del negocio con `business_id`, los 4 de la plataforma sin él (`check`) |
| `appointment_id` | uuid, nulo | `references appointments on delete cascade`: obligatorio en `booking`, `receipt`, `patient_confirm`, `patient_cancel`, `new_appointment` y `unclosed` |
| `client_id` | uuid, nulo | `references clients on delete cascade`: quién confirmó (`patient_confirm`, puede ser otra persona de la sesión) |
| `professional_id` | uuid, nulo | `references professionals on delete cascade`: sólo en `evening_summary` de una agenda; vacío en el del negocio |
| `actor_user_id` | uuid, nulo | `references users on delete set null`: quien lo provocó (no lo ve); hoy sólo `new_appointment` |
| `data` | jsonb | `not null default '{}'`. Ver la tabla «Qué guarda `data`», más abajo |
| `title`, `body`, `url` | text, nulo | Sólo los de la plataforma: el texto ya armado (no tienen pacientes, R3). `url` empieza por `/` |
| `dedupe_key` | text, nulo | `unique`: los del cron y la serie no se repiten si se reintenta la pasada |
| `created_at` | timestamptz | `not null default now()` |

Qué guarda `data`:

| Aviso | `data` |
|---|---|
| `new_appointment` de una serie | `{ "count": 8 }` |
| `evening_summary` | `{ "date": "2026-10-15", "count": 3 }` |
| `unclosed` | `{ "endsAt": "…" }` |

Índices:
- `(business_id, created_at desc)`, para la campana del negocio;
- `(created_at desc) where business_id is null`, para la de /admin;
- `(created_at)`, para el borrado de los 30 días.

RLS activado, como todas las tablas: la API entra con su propio usuario y nadie más.

## `panel_notice_reads`: quién leyó cada uno

| Columna | Tipo | Regla |
|---|---|---|
| `user_id` | uuid | `references users on delete cascade` |
| `notice_id` | uuid | `references panel_notices on delete cascade` |
| `read_at` | timestamptz | `not null default now()` |

Clave `(user_id, notice_id)`: leerlo otra vez no hace nada (`on conflict do nothing`).

## `panel_notice_state`: «Marcar todo como leído»

| Columna | Tipo | Regla |
|---|---|---|
| `user_id` | uuid, clave | `references users on delete cascade` |
| `read_all_at` | timestamptz | `not null`: todo lo creado hasta esta hora cuenta como leído |

## Sin leer

Un aviso está **sin leer** para una persona si cumple todo esto:
- lo puede ver (la regla de abajo);
- se creó después de su `read_all_at`;
- no tiene fila suya en `panel_notice_reads`.

## Quién lo ve (R2), al leer

Para la persona `U` en el negocio `B`:
- **Su rol** es `bu.role`, de `business_users`.
- **Es el propietario** si `businesses.owner_id = U`.
- **Su agenda** `P` es el profesional activo de `B` con `user_id = U` (puede no tener).
- **Desde** es `bu.created_at`.

Un aviso de `B` le llega si **no lo provocó ella**, se creó **en los últimos 30 días** y **después de
que entrara**, y además se cumple uno de estos casos:

| Caso | Avisos |
|---|---|
| Propietario | `booking`, `receipt`, `patient_confirm`, `patient_cancel` y `unclosed` de todas las agendas; `new_appointment` de su agenda (`a.professional_id = P`); `evening_summary` del negocio (`professional_id` vacío) |
| Administrador o Recepción | `booking`, `receipt`, `patient_confirm` y `patient_cancel` de todas las agendas |
| Cualquiera con agenda `P` | `booking`, `receipt`, `patient_confirm`, `patient_cancel`, `new_appointment` y `unclosed` cuya cita es de su agenda (`a.professional_id = P`); `evening_summary` de su agenda (`professional_id = P`, si no es el propietario) |

- **«La cita es de su agenda»** se mira en la cita **de hoy** (join con `appointments`), no cuando se
  creó el aviso.
- **Los de la plataforma** los ve cada super admin activo. «Desde» es `users.created_at`.

La misma tabla va como constante compartida, `NOTICE_AUDIENCE` (`src/lib/constants/notices.ts`). La
beta la usa tal cual y las pruebas comparan la consulta con ella.

## Tipos compartidos (`src/types/index.ts`, copiados con `sync:shared`)

```ts
type NoticeKind = Exclude<PushKind, "test">;

interface PanelNotice {
  id: string;
  kind: NoticeKind;
  title: string;      // «Nueva reserva»
  body: string;       // «Mañana 16:00 · Limpieza · Juan Pérez»
  url: string;        // «/dashboard/calendar?date=…&appointment=…»
  createdAt: ISODateTime;
  read: boolean;
}

interface PanelNoticePage {
  notices: PanelNotice[];
  unread: number;
  /** Para «Cargar más»: el createdAt y el id del último; null si no hay más. */
  nextCursor: string | null;
}
```
