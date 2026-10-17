# Modelo de datos: Modo oscuro

## `users.theme_mode` (migración 044)

| Campo | Tipo | Regla |
|---|---|---|
| `theme_mode` | `text not null default 'auto'` | `check (theme_mode in ('light', 'dark', 'auto'))` |

- **Las cuentas que ya existen** quedan en `'auto'` por el `default` de la propia migración, sin otro
  `update`.
- **Es de la persona, no del negocio.** No se copia a otras cuentas ni a los negocios.
- **Sin índice:** nunca se busca por este campo.

## Tipos compartidos (front → `sync:shared`)

- `type ThemeMode = "light" | "dark" | "auto"`;
- `Session.themeMode: ThemeMode`;
- `THEME_MODE_LABELS: Record<ThemeMode, string>`, con «Claro», «Oscuro» y «Automático»;
- `themeModeSchema = z.object({ mode: z.enum(["light", "dark", "auto"]) })`.

## La actividad

| Campo | Valor |
|---|---|
| `action` | `user.theme_mode_changed` |
| `entity_type` / `entity_id` | `user` / su id |
| `business_id` | su negocio; `null` para el super admin (la plataforma) |
| `summary` | «Cambió el modo de pantalla de «Automático» a «Oscuro»» |
| `changes` | `[{ field: "Modo de pantalla", from: "Automático", to: "Oscuro" }]` |

## En el aparato (no es un dato del sistema)

`localStorage["agenda360:modo-pantalla"]` guarda la última elección: `light`, `dark` o `auto`.
- **Para qué:** sólo para el arranque sin destello y para las pantallas de antes de iniciar sesión.
- **Lo que manda** es la cuenta.
- **Si no hay** o el navegador no deja leerlo, se toma «Automático».
