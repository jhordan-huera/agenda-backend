# Especificación: La pantalla «Base de datos» del super admin principal

**Carpeta**: `specs/024-base-de-datos-admin` (rama de trabajo: `dev`) · **Creada**: 2026-10-18

**Estado**: Implementada (2026-10-18)

**Repos**:
- **agenda-backend:** las consultas de lectura, la ruta y la foto diaria en el cron.
- **agenda-front:** la pantalla en /admin.
- **La beta:** no, porque no tiene base real.

## Pedido

El dueño del producto, el 2026-10-18, a partir de la tarjeta «Base de datos» de Salud: «quisiera tener
una pantalla que sólo el super admin vea, pon las seguridades que sean, y pon a detalle qué es lo que
consume la base de datos».

**Decisiones del dueño del producto (2026-10-18):**
1. **Sólo la ve el super admin principal** (la cuenta principal de la plataforma), con la verificación
   en dos pasos. Los demás super admins del equipo de soporte no la ven ni pueden pedir sus datos.
2. **Con historial y proyección:** el cron guarda cada día el tamaño, y la pantalla muestra cómo crece
   y «a este ritmo, se llena en…».

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Qué ocupa la base, en detalle (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** /admin → Salud → tarjeta «Base de datos» → «Ver detalle» (o la ruta `/admin/database`),
   **entonces** se ve, arriba:
   - el tamaño total frente al tope del plan, con su estado (Bien, Atención o Alto, como la tarjeta);
   - los archivos (comprobantes, historias clínicas e imágenes) frente a su tope de 1 GB, aparte,
     porque no cuentan en la base.
2. **Dado** la sección «Qué ocupa», **entonces** se ve cada tabla con:
   - su nombre en palabras: «Emails (cola e historial)», «Actividad», «Registro del cron»,
     «Citas»…;
   - su tamaño (datos, índices y textos largos) y cuántas filas tiene;
   - si se borra sola y cuándo: «el contenido a los 30 días», «5 meses», «30 días», «nunca»;
   - lo de Supabase (inicio de sesión, almacenamiento y lo interno) en un grupo aparte, «Lo que trae
     Supabase».
3. **Dado** la sección «Qué la hace trabajar», **entonces** se ve:
   - el tiempo total de trabajo desde que se reiniciaron las estadísticas;
   - el reparto por quién: la app, el cron, las conexiones (el pooler) y Supabase;
   - las 10 consultas que más tiempo consumen, con su % y cuántas veces corrieron, en palabras cuando
     se reconocen («El cron revisa su última pasada») y si no, el texto de la consulta sin valores.
4. **Dado** la sección «Mantenimiento», **entonces** se ve:
   - las tablas con más escrituras y filas muertas, y su última limpieza (vacuum);
   - los índices que nunca se usaron;
   - las conexiones abiertas ahora.
5. **Dado** cada sección, **entonces** lleva una frase que explica qué significa y si hay que hacer
   algo, en español sencillo.

### Historia 2 - Cómo crece y cuándo se llenaría (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** que el cron corre después de las 06:00 de Ecuador, **entonces** una vez al día guarda el
   tamaño de la base, de los archivos y de las tablas principales.
2. **Dado** la pantalla, **entonces** un gráfico muestra el tamaño de los últimos 90 días.
3. **Dado** al menos 7 días de historial, **entonces** dice «Crece unos X MB por mes. A este ritmo,
   llega al 70 % en N meses y se llena en M». Con menos días: «Hacen falta unos días de datos para
   calcularlo».

### Historia 3 - Las seguridades (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** un super admin que no es el principal, **entonces** no ve el enlace ni la página, y la API
   le responde 403.
2. **Dado** el principal sin la verificación en dos pasos activa, **entonces** la API responde
   `two_factor_required`, como el resto de /admin.
3. **Dado** cualquier dato de la pantalla, **entonces** sólo son nombres de tablas, tamaños y cifras:
   nunca el contenido de una fila, un paciente, un email ni una clave. El texto de las consultas sale
   normalizado (`$1`) y además se tapan los textos entre comillas.
4. **Dado** muchas peticiones seguidas, **entonces** hay un límite: 20 cada 15 minutos.
5. **Dado** la respuesta, **entonces** no se guarda en ninguna caché (`no-store`).

### Casos límite

- **Si la estadística de consultas no está disponible,** esa parte dice «No disponible» y lo demás se
  ve igual.
- **Si una consulta tarda,** hay un tope de 5 segundos. Esa sección dice «No se pudo leer ahora» y lo
  demás se ve igual.
- **El historial empieza** el día que se publica: los primeros días no hay proyección.
- **A 390 px y en los dos modos.**

## Requisitos *(obligatorio)*

- **RF-001**: /admin DEBE tener la pantalla «Base de datos», a la que se llega desde la tarjeta de
  Salud, sólo para el super admin principal con la verificación en dos pasos.
- **RF-002**: DEBE mostrar el tamaño total y el de los archivos frente a sus topes, qué ocupa cada tabla
  (en palabras, con su tamaño, filas y regla de borrado) y lo de Supabase aparte.
- **RF-003**: DEBE mostrar qué la hace trabajar: el total, por quién y las 10 consultas principales,
  sin valores.
- **RF-004**: DEBE mostrar el mantenimiento: escrituras, filas muertas, limpieza, índices sin uso y
  conexiones.
- **RF-005**: El cron DEBE guardar una foto diaria del tamaño. La pantalla DEBE mostrar los últimos 90
  días y la proyección con 7 días o más.
- **RF-006**: Las seguridades: 403 a los demás, la verificación en dos pasos, el límite de peticiones,
  `no-store`, sólo lectura con tope de tiempo y nunca datos de filas.
- **RF-007**: No DEBE gastar CPU de Vercel sin motivo: se calcula sólo al abrirla, y la foto diaria la
  hace el cron de GitHub.

## Criterios de éxito *(obligatorio)*

- **CE-001**: En menos de un minuto, el dueño sabe qué tabla ocupa más, qué la hace trabajar y cuándo
  se llenaría.
- **CE-002**: Un super admin que no es el principal no obtiene nada (403). Lo comprueban las pruebas.
- **CE-003**: Ninguna respuesta lleva datos de filas, emails ni textos entre comillas. Lo comprueban
  las pruebas.
- **CE-004**: Las pruebas pasan, y la pantalla se ve bien en los dos modos y a 390 px.

## Supuestos

- **El tope de los archivos** es 1 GB, el del plan gratis de Supabase. Va como variable, igual que
  `DATABASE_LIMIT_MB`.
- **Ver la pantalla no va a la actividad,** porque es una consulta. La regla «auditar todo» es para lo
  que cambia datos.
- **La constitución sube** con una línea en el principio III.
