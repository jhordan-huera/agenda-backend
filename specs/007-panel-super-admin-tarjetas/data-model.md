# Modelo de datos: Panel del super admin con tarjetas y colores propios

**Spec**: [spec.md](./spec.md) · **Decisiones**: [research.md](./research.md)

## Migración `db/migrations/035_panel_colors.sql`

### `users` (columna nueva)

| Campo | Tipo | Notas |
|---|---|---|
| `panel_colors` | jsonb, nulo | `{ "primary": "#rrggbb", "highlight": "#rrggbb" }`; null = colores de Agenda360 |

- La comprobación es igual a la de `businesses.brand_colors` (018): nula, o los dos colores con el
  formato `^#[0-9a-f]{6}$`.
- Sólo se usa en cuentas de super admin. La ruta exige ese rol y la sesión no la lee para el resto.
- No necesita índice: se lee por la clave primaria.
- Las cuentas que ya existen quedan con `null`. Sin cambios para nadie hasta que elija colores.

## Validación compartida (agenda-front `src/lib/validations/admin.ts` → `npm run sync:shared`)

```ts
/** Colores del panel del super admin; null vuelve a los de Agenda360. */
export const panelColorsSchema = z.object({ colors: brandColorsSchema });
export type PanelColorsInput = z.infer<typeof panelColorsSchema>;
```

`brandColorsSchema` ya es `.nullable()`, en `lib/validations/business.ts`.

## Sesión (a mano en los dos lados, como hoy)

Backend `src/services/auth-service.ts` y front `src/lib/auth/types.ts`:

```ts
interface Session {
  // … lo de hoy, sin cambios
  /** NUEVO: colores del panel de plataforma del super admin (null: Agenda360; siempre null si no es super admin). */
  panelColors: BrandColors | null;
}
```

## Repositorio del front (`src/lib/data/repository.ts`)

```ts
interface PlatformAdminRepository {
  // … lo de hoy
  /** NUEVO: guarda los colores del panel en la cuenta del super admin que lo pide. */
  updatePanelColors(input: PanelColorsInput): Promise<{ colors: BrandColors | null }>;
}
```

## Navegador (no se guarda en la base)

| Clave | Valores | Uso |
|---|---|---|
| `agenda360.admin.vista.negocios` | `"tarjetas"` · `"lista"` | Vista de Negocios en este equipo |
| `agenda360.admin.vista.usuarios` | `"tarjetas"` · `"lista"` | Vista de Usuarios en este equipo |

Si no se puede leer o escribir (navegación privada, almacenamiento bloqueado), se usan tarjetas.

## Beta (`src/lib/data/mock/store.ts`)

- `panelColors: { userId: string; colors: BrandColors }[]`, vacía si los datos guardados en el
  navegador no la traen.
- Guardar `null` borra la fila de esa cuenta.
