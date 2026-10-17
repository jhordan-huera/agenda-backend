# Contrato: el modo de pantalla

## `GET /auth/session` (ya existe)

Suma un campo:

```json
{ "...": "lo de hoy", "themeMode": "auto" }
```

- **Valores:** `"light"`, `"dark"` o `"auto"`.
- **El front** toma su ausencia (un backend antiguo) como `"auto"`.

## `PUT /auth/theme-mode` (nueva)

**Pide:** `{ "mode": "dark" }`

**Responde:**

| Caso | Respuesta |
|---|---|
| Cambio guardado | `200 { "mode": "dark" }` y la entrada en la actividad ([data-model](../data-model.md)) |
| El mismo modo que ya tenía | `200 { "mode": "dark" }`, sin entrada nueva en la actividad |
| `mode` falta o no es uno de los tres | `400 validation` |
| Sin sesión | `401` |

**Reglas:**
- **Sólo cambia la cuenta de quien lo pide.** No hay forma de cambiar la de otro.
- **Lo pueden usar todos los roles del negocio y el super admin.** El super admin también en modo
  soporte, y su entrada va a la actividad de la plataforma.
- **No pasa por la verificación en dos pasos del super admin:** es una preferencia de su pantalla.
