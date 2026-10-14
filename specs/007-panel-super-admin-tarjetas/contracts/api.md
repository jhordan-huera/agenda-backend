# Contrato de la API: Panel del super admin con tarjetas y colores propios

El rediseño no cambia ninguna ruta. Hay una ruta nueva y la sesión gana un campo.

## `PUT /admin/panel-colors` (nueva)

Guarda los colores del panel en la cuenta de **quien hace el pedido**. No acepta el id de otra
cuenta.

**Quién puede:** sólo el super admin. Pasa por el filtro de `/admin`: con la verificación en dos
pasos pendiente responde `two_factor_required`.

```jsonc
// Pedido
{ "colors": { "primary": "#2f6b5e", "highlight": "#ddd4f8" } }
// o, para volver a los de Agenda360:
{ "colors": null }

// Respuesta 200
{ "colors": { "primary": "#2f6b5e", "highlight": "#ddd4f8" } }
```

| Caso | Respuesta |
|---|---|
| Color sin el formato `#rrggbb` o falta uno de los dos | 400 `validation_error` |
| Cuenta de un negocio (propietario, equipo) | 403 `forbidden` |
| Sin sesión | 401 |

No queda en la auditoría: es una preferencia personal (research D3).

## Sesión: `GET /auth/session`, `POST /auth/login`, `POST /auth/login/two-factor`

Las tres devuelven la sesión con un campo nuevo:

```jsonc
{
  // … lo de hoy
  "panelColors": { "primary": "#2f6b5e", "highlight": "#ddd4f8" }   // NUEVO; null sin colores o si no es super admin
}
```

## Datos personales

Ninguno nuevo. Las pantallas usan los mismos datos de hoy: cifras, negocios, cuentas y auditoría.
