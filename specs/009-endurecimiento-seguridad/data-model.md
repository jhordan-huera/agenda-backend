# Modelo de datos: Endurecimiento de seguridad

## Migración 036 (`db/migrations/036_security_hardening.sql`)

Es una sola migración, que el dueño aplica antes de publicar el backend.

1. **Protección de filas en la tabla de control de las migraciones.** En las bases nuevas ya la crea
   `migrate.ts`; esto la añade en las que ya existen.

   ```sql
   alter table if exists schema_migrations enable row level security;
   ```

2. **Paciente «por verificar».** Es la ficha que reclama un paciente creado por la reserva pública
   (R4).

   ```sql
   alter table clients
     add column claimed_client_id uuid references clients(id) on delete set null,
     add constraint clients_claim_check
       check (claimed_client_id is null or (document_id = '' and claimed_client_id <> id));
   create index clients_claimed_idx on clients (claimed_client_id) where claimed_client_id is not null;
   ```

   - **Sin `not null` y sin valor por defecto:** las fichas de hoy quedan igual.
   - **`on delete set null`:** si se borra la ficha reclamada, el paciente aparte pasa a ser un
     paciente normal sin cédula.
   - **El check:** un paciente por verificar nunca lleva cédula, así que no choca con el índice único
     de cédula por negocio de la 006.

No hay más cambios de esquema. Las sesiones, los contadores y los emails usan columnas que ya
existen (ver abajo).

## Entidades

### Paciente (`clients`, tipo `Client`)

- **Gana `claimedClientId: string | null`:** la ficha cuya cédula escribió quien reservó.
  - `null`: paciente normal.
  - Con valor: «Por verificar».
- **La lista y la ficha lo devuelven** a quien ya puede ver al paciente.
- **El nombre de la ficha reclamada** no viaja con el paciente. El panel lo busca en su lista de
  pacientes, y si el usuario no puede verla, el aviso no nombra a nadie.

**Ciclo de vida:**

```text
reserva pública con cédula de paciente y otro email y teléfono
        │
        ▼
 paciente aparte (cédula vacía, claimed_client_id = ficha)  ──► cancelar la cita: queda aparte, sin cédula
        │
        ▼  «Es el mismo paciente: unir a su ficha»
 citas pasan a la ficha · (opcional) email y teléfono nuevos en la ficha · se borra el paciente aparte
```

**Reglas:**
- **Una misma reclamación con los mismos datos** (ficha, y email o teléfono iguales) reutiliza el
  mismo paciente aparte.
- **Unir no está permitido:**
  - al rol Profesional;
  - si el paciente aparte ya tiene historia clínica (409).

### Cita (`appointments`, tipo `Appointment`)

- **Sin columnas nuevas.** «Por verificar» se deduce de sus pacientes: el principal o alguno de
  `extraClientIds` tiene `claimedClientId`.

### Sesión (`sessions`)

- **Sin columnas nuevas.** La caducidad máxima sale de `created_at`, `remember` y
  `users.platform_role` (R6):

  | Sesión | Al crearla | Al renovarla (cada 5 min de uso) | Tope desde `created_at` |
  |---|---|---|---|
  | Sin «Recordarme» | 12 h | 12 h sin uso | 24 h (como hoy) |
  | «Recordarme», negocio | 14 días | 14 días | 30 días |
  | «Recordarme», super admin | 7 días | 7 días | 7 días |

### Secreto de la verificación (`users.two_factor_secret`, `two_factor_pending_secret`)

- **Mismas columnas.** Cambia el contenido:
  - **Nuevo:** `v1.<base64url(IV 12 bytes | etiqueta 16 | cifrado)>`, con AES-256-GCM y la clave
    sha256 de `TWO_FACTOR_KEY`.
  - **De hoy:** base32 en claro. Se lee igual y se vuelve a guardar cifrado con el siguiente código
    correcto.

### Intentos de acceso (`rate_limits`, de la migración 029)

- **Claves nuevas,** con ventana de 15 minutos (R1). La huella es el sha256 del email en minúsculas.

  | Clave | Tope |
  |---|---|
  | `acceso:cuenta-ip:<huella>:<ip>` | 10 |
  | `acceso:ip:<ip>` | 50 |
  | `acceso:cuenta:<huella>` | 30, sólo desde conexiones nuevas para la cuenta |

- **Paso intermedio** (`login_challenges.attempts`): se suma antes de comprobar el código, hasta 5.

### Email (`notifications`)

- **Tipo nuevo:** `account_security_changed`, el aviso de un cambio en una cuenta de super admin
  (R3). `businessId` va en null y no cuenta como email a terceros.
- **Cuentan como emails a terceros:** los tres tipos de la spec 008.
- **Emails «del público»:** son la bienvenida y los emails de una cita reservada en la página
  creados en la misma transacción. No necesitan columna nueva (R11).

### Registro de actividad (`audit_logs`)

**Acciones nuevas:**

| Acción | Tipo de entidad | Cuándo |
|---|---|---|
| `session.password_changed` | `session` | El super admin cambia su propia contraseña, con IP y navegador. |
| `client.claim_confirmed` | `client` | Se une un paciente por verificar a la ficha. El resumen nombra a los dos y los cambios dicen el email y el teléfono actualizados. |

**Fallos de contraseña o código con la sesión abierta:** se registran como `session.login_failed`,
con un resumen propio (R2).

## Configuración nueva

| Variable | Dónde | Qué |
|---|---|---|
| `TWO_FACTOR_KEY` | Vercel y Lambda (backend), y el `.env` local para `dev:prod` | Clave del cifrado del secreto, de 32 caracteres o más. Obligatoria en la nube. |
| `PUBLIC_EMAILS_PER_DAY` | Opcional | Tope diario de emails que provoca el público. Por defecto 150, dentro de los 400 de `THIRD_PARTY_EMAILS_PER_DAY`. |

**Obligatorias en la nube desde esta spec** (si falta una, la API no atiende):
- las claves de Turnstile;
- `PROXY_SECRET`;
- `DATABASE_SSL=true`;
- `DATABASE_URL` sin `sslmode`;
- `TWO_FACTOR_KEY`.
