# Plan de implementación: La pantalla «Base de datos»

**Rama**: `dev` · **Fecha**: 2026-10-18 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **`src/services/database-stats-service.ts`** (nuevo): todo en una transacción `begin read only`
   con `set local statement_timeout = '5s'`, sin ningún `SET` de sesión, por el pooler 6543.
   - **`size`:**
     - `pg_database_size` frente a `config.databaseLimitBytes`;
     - los archivos: `sum((metadata->>'size')::bigint)` de `storage.objects`, por bucket, frente a
       `FILES_LIMIT_MB` (nuevo, 1024 por defecto).
   - **`tables`:**
     - de `pg_class` y `pg_namespace`: el total, los datos, los índices, los textos largos (toast) y
       las filas estimadas;
     - las de `public` llevan nombre y regla de borrado desde un mapa del código
       (`TABLE_INFO: { notifications: { label: "Emails (cola e historial)", retention: "El contenido a
       los 30 días; queda el registro" }, … }`);
     - las que no estén en el mapa salen con su nombre técnico;
     - las demás, agrupadas por esquema, en «Lo que trae Supabase».
   - **`work`:**
     - de `pg_stat_statements` (en el esquema donde esté la extensión): el total, por rol (la app es
       `postgres`; las conexiones, `pgbouncer`; Supabase, `authenticator`, `supabase_admin` y los
       demás) y las 10 primeras;
     - **el texto de cada consulta:** normalizado, con los textos entre comillas tapados (`'…'`) y
       recortado a 160 caracteres;
     - **el nombre en palabras,** por patrones conocidos (`QUERY_LABELS`): «El cron revisa su última
       pasada», «El cron guarda su resumen», «Se busca la sesión de cada petición», «Supabase lee su
       esquema», «El pooler autentica una conexión»…;
     - si la extensión no está, `null`.
   - **`maintenance`:** de `pg_stat_user_tables` (escrituras, filas vivas y muertas, último vacuum),
     `pg_stat_user_indexes` (los índices sin uso, sin los únicos ni las claves) y `pg_stat_activity`
     (las conexiones por rol y estado, sin el texto de las consultas).
   - **Cada sección** va en su propio `try`: si falla, sale `{ error: "No se pudo leer ahora" }` y lo
     demás sigue.
2. **La ruta** `GET /admin/database`, en `platform-routes.ts`:
   - `requireSuperAdminTwoFactor`, como el resto de /admin;
   - además, `platformOwner`: si no lo es, 403 «Sólo el super admin principal ve la base de datos.»;
   - `limitRequests({ name: "base-de-datos", windowMinutes: 15, max: 20 })`;
   - `Cache-Control: no-store`.
3. **El historial:**
   - **migración 047,** `database_stats`, con `day date primary key`, `size_bytes`, `files_bytes` y
     `tables jsonb` (las 10 tablas que más ocupan: nombre y bytes), y RLS como las demás tablas;
   - **el cron** (`scheduled-tasks.ts`), después de las 06:00 de Ecuador, si no hay foto de hoy, la
     guarda y borra las de más de 400 días. La línea del registro dice «base de datos: foto guardada
     (16,2 MB)», sólo con la cifra;
   - **la ruta** suma `history`, los últimos 90 días, y `projection`: con 7 días o más, una regresión
     lineal simple da los MB por mes y los meses hasta el 70 % y hasta el 100 %.
4. **El front:**
   - **la página** `src/pages/admin/admin-database-page.tsx`, en `/admin/database`;
   - **el enlace** «Ver detalle» en la tarjeta «Base de datos» de Salud, sólo si `session.platformOwner`;
   - **arriba,** dos tarjetas: la base y los archivos;
   - **el gráfico** de 90 días, con la librería de gráficos que ya está;
   - **la proyección,** en una frase;
   - **«Qué ocupa»:** barras horizontales por tabla (datos, índices y textos largos), con su nombre,
     filas y regla de borrado, y el grupo «Lo que trae Supabase» plegado;
   - **«Qué la hace trabajar»:** el reparto por quién y la lista de las 10 consultas;
   - **«Mantenimiento»:** tablas pequeñas, que en el celular se desplazan dentro de su recuadro;
   - **una frase de ayuda** en cada sección;
   - **sin el principal,** la ruta muestra «No tienes acceso».
5. **Constitución** (MENOR), en el principio III: «La pantalla «Base de datos» de /admin sólo la ve el
   super admin principal, con la verificación en dos pasos; sólo muestra nombres de tablas, tamaños y
   cifras, nunca datos de filas (2026-10-18)».

**Migración:** 047. **Variables:** `FILES_LIMIT_MB` (opcional, 1024).

## Pruebas

**Backend** (`tests/database-stats.test.ts`, nueva, contra la base desechable):
- **Quién la ve:**
  - el principal recibe todas las secciones;
  - otro super admin, 403;
  - un propietario, 403;
  - sin sesión, 401.
- **El límite:** 20 cada 15 minutos.
- **`no-store`** en la respuesta.
- **Privacidad:**
  - ningún email ni nombre de paciente de los datos demo aparece en toda la respuesta (se busca cada
    uno);
  - ningún texto entre comillas en las consultas.
- **El cron** guarda una foto al día y no la repite.
- **La proyección:**
  - con 10 días simulados, la cifra sale como se calculó a mano;
  - con 3 días, «Hacen falta unos días».
- **Si falta la extensión,** `work` es `null` y lo demás sale igual.

**Front:**
- build, lint y `check:contrast`;
- el recorrido, en los dos modos y a 390 px, con los datos demo y una foto simulada:
  - el principal entra desde Salud;
  - otro super admin no ve el enlace y la ruta le dice «No tienes acceso».

## Publicación

1. **La migración 047,** como paso aparte, antes del backend.
2. **Primero el backend y después el front.**
3. **La primera foto** la guarda el cron a la mañana siguiente. La proyección sale a los 7 días.
