# Reporte final: La pantalla «Base de datos» del super admin principal

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-18

**Repos**: los dos (la beta no la lleva) · **Migración**: Sí: `047_database_stats.sql`

## Resumen

/admin → Salud → tarjeta «Base de datos» → «Ver detalle» abre `/admin/database`, que sólo ve el super
admin principal. Muestra:
- **La base y los archivos,** frente a sus topes.
- **Cómo crece:** un gráfico de 90 días y la proyección («Crece unos X MB por mes. A este ritmo…»).
- **Qué ocupa:** cada tabla en palabras, con su tamaño, sus filas y cuándo se borra sola, y lo de
  Supabase aparte.
- **Qué la hace trabajar:** por quién y las 10 consultas que más tiempo consumen, en palabras.
- **Mantenimiento:** escrituras, filas muertas, limpieza, índices sin uso y conexiones.

Cada sección dice qué significa y si hay que hacer algo.

**Seguridades:**
- sólo el principal, con la verificación en dos pasos (los demás, 403);
- 20 peticiones cada 15 minutos;
- `no-store`;
- sólo lectura, con un tope de 5 segundos por consulta;
- nunca datos de filas: las consultas salen sin valores.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La pantalla, sólo del principal | Cumple | `database-stats`: el principal entra; otro super admin y un propietario, 403; sin sesión, 401; sin la verificación, `two_factor_required`. Recorrido: el otro super admin no ve el enlace y la ruta le dice «No tienes acceso» |
| RF-002 – Tamaños y qué ocupa | Cumple | Suite y recorrido. Todas las tablas de `public` tienen su nombre y su regla de borrado (si se añade una sin regla, la prueba falla) |
| RF-003 – Qué la hace trabajar | Cumple | Suite con y sin `pg_stat_statements` (57 y 51 comprobaciones). En producción (sólo lectura), las 10 consultas principales salen con su nombre en palabras |
| RF-004 – Mantenimiento | Cumple | Suite y recorrido |
| RF-005 – La foto diaria y la proyección | Cumple | Suite: no guarda antes de las 06:00, guarda una vez al día, borra las de más de 400 días y la proyección coincide con la cuenta a mano |
| RF-006 – Seguridades | Cumple | Suite: 429 en la petición 21, `no-store`, el tope de 5 s y ver la pantalla no va a la actividad. Privacidad: se buscaron 80 emails y nombres de los datos demo en la respuesta y no aparece ninguno; en producción, 0 arrobas y 0 textos entre comillas |
| RF-007 – CPU | Cumple | Se calcula al abrirla. La foto la guarda el cron de GitHub |
| CE-001 a CE-004 | Cumple | Las de arriba. Recorrido: 18, 18, 19 y 19 ✓ en Chromium a 1440 px y WebKit a 390 px, claro y oscuro |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test`: 62 de 62 suites,
  con 2710 ✓ y 0 ✗.
- **Front:** build, lint y `check:contrast` sin errores.

**En producción, sólo con lectura,** el servicio funcionó contra la Supabase real:
- base de 16,2 MB y archivos de 1,1 MB;
- las tablas y las consultas, leídas;
- el historial no se pudo leer, sólo porque falta la migración 047.

## Cambios respecto al plan

- **Los archivos** van en una sección propia, para que un fallo no tape el tamaño.
- **La app** es la cuenta con la que entra la API (`current_user`). El cron se separa por sus consultas
  propias.
- **El texto de las consultas se limpia más:** también se quitan los comentarios y se tapan los
  cuerpos `$$`, los números y los emails.
- **El estado** dice Bien, Atención o Alto, como pide la spec. La tarjeta de Salud sigue con sus
  etiquetas, con los mismos umbrales.
- **Las barras de «Qué ocupa»** usan un solo color en tres intensidades, siempre con la cifra escrita.
- **Dos nombres en palabras** se añadieron después de verlos en producción: «El pooler prepara una
  conexión nueva (lee los tipos)» y «Una pausa a propósito (pg_sleep)».
- **El límite** cuenta también las peticiones que reciben 403.

## Pendientes y riesgos

- **El historial empieza** cuando se publique: el gráfico se llena día a día, y la proyección sale a
  los 7 días.
- **Sin comprobar** el cron en GitHub Actions con la tabla nueva, ni el camino sin la verificación en
  dos pasos en el navegador (sólo en la API).

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | f4e4247 | Spec 024: … (spec, plan, tareas y constitución 1.21.0) |
| agenda-front | 736ba30 | Constitución 1.21.0: la pantalla «Base de datos» (spec 024) |
| agenda-backend | (el de esta entrega) | Spec 024: la pantalla «Base de datos» (backend) y reporte |
| agenda-front | (el de esta entrega) | Spec 024: la pantalla «Base de datos» (front) |

## Cómo publicarlo

1. **La migración 047, como paso aparte,** antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.**
3. **Después:** /admin → Salud → «Base de datos» → «Ver detalle». La primera foto del historial la
   guarda el cron a la mañana siguiente.

## Texto para el PR

Spec 024: la pantalla «Base de datos» (`/admin/database`), sólo para el super admin principal. Muestra:
- el tamaño y los archivos;
- el historial de 90 días y la proyección;
- qué ocupa cada tabla, en palabras y con su regla de borrado;
- qué la hace trabajar (`pg_stat_statements`, sin valores);
- el mantenimiento.

Lleva la verificación en dos pasos, un límite de 20 cada 15 minutos y `no-store`, sólo lee y nunca
muestra datos de filas. La foto diaria la guarda el cron.

**Migración:** `047_database_stats.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/024-base-de-datos-admin/reporte.md
