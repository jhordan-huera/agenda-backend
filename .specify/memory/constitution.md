# Constitución de Agenda360

Agenda360 es un SaaS de agenda y reservas online para profesionales (psicólogos, odontólogos,
nutricionistas, estilistas…). Son dos repositorios públicos que trabajan juntos:
**agenda-backend** (API Express 5 + PostgreSQL en Supabase) y **agenda-front** (React + Vite +
Tailwind v4 + shadcn/Radix). Esta constitución es la misma en los dos.

## Principios

### I. Todo en español

- La interfaz, los emails, los avisos, la documentación y los commits se escriben en español.
- Las especificaciones de SDD (`spec.md`, `plan.md`, `tasks.md`, checklists) también: el dueño del
  producto las lee y las aprueba, y no entiende bien el inglés. Sólo quedan en inglés los nombres
  técnicos citados tal cual (archivos, comandos, mensajes de error).

### II. Privacidad de los pacientes (NO NEGOCIABLE)

Agenda360 guarda datos de salud (historia clínica, citas, contacto de pacientes).

- Los repositorios y los registros de GitHub Actions son públicos: nunca se imprimen emails,
  teléfonos, cédulas ni nombres completos de pacientes en logs, títulos de avisos ni commits.
- Los avisos por ntfy llevan al paciente sólo a medias (`masking.ts`: "Juan P.", "ju***@gmail.com",
  "099***5555").
- La analítica (Vercel Analytics / Speed Insights) recibe rutas sin identificadores ni tokens y sin
  parámetros.
- Las páginas públicas (reservas, pago) no exponen datos internos del negocio ni de otros pacientes.
- Nunca se copian datos de producción a local ni a pruebas, ni siquiera anonimizados.
- La base de producción sólo se consulta en lectura desde el equipo; las migraciones las aplica el
  dueño del producto.
- Ninguna clave, contraseña ni token se escribe en el código, en la documentación ni en mensajes.

### III. Las decisiones de producto se respetan

Las decisiones ya tomadas no se cambian como "arreglo" ni como mejora de seguridad sin preguntar.
Si una tiene un riesgo, se menciona como riesgo aceptado. Vigentes:

- Las contraseñas las pone siempre el super admin y van por email: no hay "olvidé mi contraseña"
  automático ni enlaces para definirla; mínimo 8 caracteres.
- Sólo el super admin agrega miembros de equipo, cambia planes y categorías de negocio.
- En modo soporte el super admin tiene permisos de propietario y ve la historia clínica; no se
  avisa al negocio de la entrada ni se registran sus consultas, sólo lo que crea o cambia.
- La verificación en dos pasos es obligatoria para el super admin.
- Los negocios no ven planes ni precios (ni en el panel ni en la portada).
- Los pacientes se identifican por cédula (sólo números) dentro de cada negocio. La reserva
  online no reconoce al paciente por la cédula ni muestra sus datos: siempre pide nombre, email y
  teléfono.
- Las fechas de consentimiento y de las evoluciones clínicas las pone el sistema.
- Cada email al paciente sobre su cita, también los recordatorios, sale con copia al profesional
  (los recordatorios, desde el 2026-10-13).
- Una cita puede tener hasta 3 pacientes (sesiones de pareja), sólo en los negocios que el super
  admin habilite con su interruptor; el negocio no lo cambia. Cada paciente recibe sus avisos, la
  copia al profesional sale una vez y la hora se ocupa una sola vez (2026-10-13).
- Con ese interruptor, un servicio puede ser para 2 o 3 personas. La página de reservas pide los
  datos de cada una y reconoce a cada persona por su cédula como a quien reserva (si no coinciden
  su email o su teléfono, no se usa su ficha); las que no existen se registran como nuevas. Quien
  reserva es el paciente principal y sólo él recibe los datos de pago. En el panel, si faltan
  pacientes, se avisa sin bloquear (2026-10-13).
- El panel del super admin va en tarjetas, con botón para pasar a lista en Negocios y Usuarios, y
  la ficha de cada negocio en pestañas. Cada super admin elige los colores de su panel en su cuenta:
  no se aplican a los negocios ni a otros super admins (2026-10-14).
- Todo cambio de estado de una cita se le avisa al paciente por email (con copia al profesional) y
  el panel ofrece el WhatsApp ya escrito. La ficha de la cita tiene la casilla «Avisar al paciente»
  (marcada) para no avisar al corregir un error. «Atendida» y «No asistió» van con el interruptor
  «Seguimiento» (encendido) y sólo para citas de los últimos 7 días. El dueño del producto recibe por
  ntfy cada cambio de estado (2026-10-14).
- En la portada no hay testimonios, cifras ni precios inventados.

### IV. Se comprueba en local, nunca en producción

- Toda prueba se hace en local: `npm run dev:local` (API + PostgreSQL propio con datos demo) y el
  front con `npm run dev`. Nunca en Vercel ni contra la base de producción.
- Backend: `npm test` (PostgreSQL desechable) y `npm run typecheck` deben pasar. Vercel compila con
  `@vercel/express` y los errores de tipos son fatales: si se tocan tipos de librerías, se
  comprueba con ese builder en local.
- Front: `npm run build` y `npm run lint` deben pasar.
- Cambios de interfaz: se revisan en un navegador real, también a 390 px de ancho (iPhone, motor de
  Safari), sin desplazamiento horizontal.

### V. Una sola fuente para el código compartido

Tipos, validaciones, constantes y plantillas de email se editan sólo en agenda-front
(`src/types`, `src/lib/{email,validations,constants}`) y se copian al backend con
`npm run sync:shared`. Nunca se edita la copia de `agenda-backend/src/shared`.

### VI. Sencillo y barato de operar

- Vercel Hobby tiene un tope de CPU: lo que pueda esperar (recordatorios, reintentos, limpieza,
  avisos por ntfy) lo hace el cron de GitHub Actions, no la API.
- Se cuida el arranque en frío (p. ej. importar `date-fns/format`, no el paquete entero).
- No se añaden servicios externos ni de pago sin aprobación; si se añade uno, se permite en la CSP
  de `vercel.json` del front.
- Se prefiere lo que ya existe en el proyecto antes que una dependencia nueva.

### VII. Diseño coherente, accesible y para el celular

- Letra Sora. Estilo SaaS claro: lienzo `--canvas`, tarjetas blancas, degradado azul → lila de la
  marca.
- Los colores salen de los tokens del tema (`--ink`, `--primary`, `--accent`…): cada negocio, y
  cada super admin para su panel, personaliza los suyos, así que no se fijan colores que ignoren la
  marca.
- Primero el celular: las cuadrículas llevan `grid-cols-1` de base y nada se sale de la pantalla.
- Accesible: cada campo con su etiqueta, foco visible, contraste suficiente, `prefers-reduced-motion`
  respetado y textos que tengan sentido con lector de pantalla.

## Restricciones técnicas y de seguridad

- Backend: Express 5 + PostgreSQL (Supabase, pooler). Node ejecuta `.ts` directamente.
- Front: React + Vite + TanStack Query + Tailwind v4 + shadcn/Radix; PWA con service worker.
- Despliegue: los dos repos en Vercel; sólo se publica la rama `main`.
- Migraciones: archivos numerados en `agenda-backend/src/db/migrations`. El dueño del producto las
  aplica en Supabase (`npm run db:migrate`) **antes** de publicar el código que las usa; el plan
  siempre lo dice como paso aparte.
- Emails por Gmail con cola en la tabla `notifications`; los secretos (contraseñas) no quedan en el
  registro de emails.
- Seguridad vigente: bloqueo de login por intentos, CAPTCHA (Turnstile) en reservas y registro,
  registros de auditoría no editables, cabeceras y CSP en `vercel.json`.
- La beta (`agenda-beta`, datos de prueba, sin git) no sigue este flujo: si un cambio debe pasar
  también a la beta, el plan lo dice.

## Flujo de trabajo (SDD)

Las funciones nuevas y los cambios grandes siguen Spec Kit:

1. `/speckit-specify`: qué se quiere y por qué, con criterios de aceptación, sin código. El dueño
   del producto la aprueba.
2. `/speckit-clarify` si quedan dudas.
3. `/speckit-plan`: archivos, tablas, migración, repos afectados y comprobación contra esta
   constitución. El dueño del producto lo aprueba antes de escribir código.
4. `/speckit-tasks` (y `/speckit-analyze` si el cambio es grande).
5. `/speckit-implement`, y `/speckit-converge` para cerrar lo que falte.
6. `/speckit-reporte`: el reporte final (`reporte.md`) con lo entregado, la comprobación de cada
   requisito con su prueba, los cambios respecto al plan, los commits y cómo publicarlo. Una
   función no está terminada sin su reporte.

Reglas del flujo:

- Cada spec vive en `specs/NNN-nombre/` del repo que toca. Si toca los dos, vive en el repo del
  cambio principal (el backend si hay migración o API nueva) y el plan nombra los archivos del otro
  repo.
- Arreglos pequeños y directos (un error, un texto, un estilo puntual) no necesitan spec.
- Se trabaja en la rama `dev` (sin rama por función). Publicar es un PR `dev` → `main`, sólo
  cuando el dueño del producto lo pide.
- La descripción de cada PR a `main` nombra las funciones que incluye con el enlace a su
  `reporte.md` y avisa si hay migración. Al fusionarse, el reporte pasa a "Publicada" con la fecha
  y el número de PR.
- No se usan ramas por función ni issues de GitHub: el avance se sigue en `tasks.md` y el cierre
  en `reporte.md`.
- Los commits y PR no llevan firma de herramientas de IA (sin `Co-Authored-By`).
- Los comandos que se le pasan al dueño del producto van sin comentarios `#`.
- Los servidores de prueba se detienen por puerto o PID, nunca por patrón; los puertos 4000, 5173
  y 3000 son los del dueño del producto y no se tocan.

## Gobierno

- Esta constitución manda sobre los hábitos y las plantillas. Cada `plan.md` incluye la
  comprobación contra ella y justifica cualquier excepción.
- Sólo el dueño del producto la cambia. Un cambio se aplica en los dos repos a la vez y sube la
  versión: MAYOR si se quita o redefine un principio, MENOR si se añade o amplía, PARCHE si sólo se
  aclara la redacción.
- Las decisiones de producto nuevas (principio III) se añaden aquí cuando se toman.

**Versión**: 1.5.0 | **Ratificada**: 2026-10-13 | **Última modificación**: 2026-10-14
