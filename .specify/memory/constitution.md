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
- Los avisos por ntfy y en el celular llevan al paciente sólo a medias (`masking.ts`: "Juan P.",
  "ju***@gmail.com", "***5555", sólo los últimos 4 dígitos del teléfono desde el 2026-10-14). Los
  del celular sólo llevan el nombre a medias: nunca su contacto, su cédula ni nada de la historia
  clínica.
- En la campana del panel (spec 014) el paciente va con su nombre completo, porque está dentro del
  panel, donde el equipo ya lo ve. Nunca su contacto, su cédula ni nada de la historia clínica
  (2026-10-15).
- La analítica (Vercel Analytics / Speed Insights) recibe rutas sin identificadores ni tokens y sin
  parámetros.
- Las páginas públicas (reservas, pago y «Tu cita») no exponen datos internos del negocio ni de otros pacientes.
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
- Si la cédula de una reserva online es de un paciente y no coinciden ni su email ni su teléfono, la
  reserva se acepta igual que con una cédula nueva (nadie de fuera nota la diferencia) y queda «Por
  verificar»: un paciente aparte, sin cédula, que no da acceso a la ficha. El negocio la une a la
  ficha o la cancela; el rol Profesional no la une. Vale para cada persona de una sesión
  (2026-10-14).
- Las sesiones con «Recordarme» duran como mucho 30 días desde que se inician, y 7 las del super
  admin (2026-10-14).
- Las fechas de consentimiento y de las evoluciones clínicas las pone el sistema.
- Cada email al paciente sobre su cita, también los recordatorios, sale con copia al profesional
  (los recordatorios, desde el 2026-10-13).
- Una cita puede tener hasta 3 pacientes (sesiones de pareja), sólo en los negocios que el super
  admin habilite con su interruptor; el negocio no lo cambia. Cada paciente recibe sus avisos, la
  copia al profesional sale una vez y la hora se ocupa una sola vez (2026-10-13).
- Con ese interruptor, un servicio puede ser para 2 o 3 personas. La página de reservas pide los
  datos de cada una y reconoce a cada persona por su cédula como a quien reserva (si no coinciden
  su email o su teléfono, no se usa su ficha y queda «Por verificar»); las que no existen se registran como nuevas. Quien
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
- El paciente confirma o cancela su cita desde «Tu cita», el enlace privado que traen los emails
  de una cita activa, sin iniciar sesión. El del paciente principal es el mismo del pago, y cada
  otra persona de una sesión tiene el suyo. «Confirmo que voy» es una marca aparte: no cambia el
  estado (confirmar la cita sigue siendo decisión del negocio), no avisa por ntfy (al celular del
  propietario sí, desde el 2026-10-15) y se borra si cambian la fecha, la hora o el profesional, o
  si la cita se cancela; la actividad dice cuándo se borró. Cancelar desde ahí sólo lo
  puede el paciente principal, si el negocio tiene «Permitir cancelaciones» y falta más que su
  antelación; si no, la página da el WhatsApp o el teléfono del negocio. La cancelación avisa
  como todo cambio de estado, y la copia al profesional no lleva los botones del paciente
  (2026-10-14).
- Una cita del panel se puede repetir cada semana, cada 2 semanas o cada mes (el mismo día del mes;
  si no existe, el último), de 2 a 24 citas. Antes de crearlas se ve la lista de fechas: las que
  chocan con otra cita o pasan el cupo del plan no se crean a esa hora; las de un bloqueo, un día sin
  atención o fuera del horario quedan marcadas y se pueden agendar igual. A cada una se le cambia la
  hora o se quita. El paciente recibe un solo email con todas las fechas (con copia al profesional) y
  ntfy avisa una vez por serie. Cada cita sigue siendo una cita normal y se cambia sola; desde su
  ficha se cancelan ella y las siguientes con un solo email, con la casilla «Avisar al paciente». La
  reserva online no crea series (2026-10-14).
- Importar pacientes desde un Excel (.xlsx) o un CSV es del propietario, los administradores y el
  super admin en modo soporte; Recepción y el rol Profesional no lo ven. Cada fila pasa las mismas
  reglas que el formulario del negocio. Un paciente cuya cédula ya existe no se cambia, los
  importados no reciben emails y quedan con origen «importado». El archivo se lee en el navegador y
  no se guarda, y lo que lee el Excel se carga sólo en esa pantalla. La actividad registra una
  entrada por importación y ntfy avisa una vez, con la cifra y sin nombres (2026-10-14).
- Los avisos en el celular (Web Push estándar, sin tiendas de aplicaciones) son sólo para el
  propietario de cada negocio y para los super admin; Recepción, los administradores y el rol
  Profesional no los reciben, y el super admin en modo soporte no recibe los del negocio. Al entrar
  al panel se ofrecen una vez por aparato («Ahora no» lo deja 7 días) y vienen con todos los tipos
  encendidos; en Configuración se apaga cada tipo o se desactivan en ese aparato, y cerrar sesión
  los pausa en él. El propietario recibe al momento las reservas online (también «Por verificar»),
  los comprobantes de pago, las confirmaciones («Confirmo que voy», desde el 2026-10-15) y las
  cancelaciones del paciente desde su email, y las citas nuevas en su agenda que agendó otra
  persona (una sola por serie); desde el cron, cada cita que terminó hace 30
  minutos y sigue Pendiente o Confirmada y, a las 8 de la noche en la hora del negocio, el resumen
  de las de hoy sin cerrar. El super admin recibe al momento los negocios nuevos y las solicitudes
  de plan, y desde el cron los cambios de seguridad en cuentas de super admin y los intentos
  fallidos, además de ntfy. Si los avisos fallan, la reserva y los emails siguen igual (2026-10-14).
- Todo lo que cambia datos queda en la actividad, con quién, qué y cuándo: lo que hace el equipo en
  el panel, lo que hace el paciente desde su enlace, las importaciones, las series y los avisos en
  el celular (activarlos en un aparato, cambiar sus tipos, desactivarlos y el aviso de prueba). Lo
  que pasa solo (la puesta al día del aparato al abrir el panel, la pausa al cerrar sesión, los
  envíos del cron) y las consultas no se registran (2026-10-15).
- El panel del negocio y el de /admin tienen una campana con los avisos de los últimos 30 días, sin
  tener que activar nada; cada persona ve lo suyo y lleva su propio leído:
  - el propietario, todo el negocio, y «Cita nueva» y el resumen de su agenda;
  - Recepción y los administradores, las reservas, los comprobantes, las confirmaciones y las
    cancelaciones del paciente de todas las agendas;
  - quien tiene una agenda, lo de su agenda (también «Cita nueva», si la agendó otra persona, y las
    citas por cerrar);
  - el super admin, sus cuatro avisos en /admin, y en modo soporte no ve la del negocio.

  Leer no se registra en la actividad (2026-10-15).
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
- Avisos en el celular con Web Push y claves VAPID propias (`VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`) en Vercel, Lambda y los secretos de GitHub. Sin ellas la API arranca igual y
  no hay avisos. Sólo se envían a los servicios de avisos de los navegadores (Google, Apple, Mozilla
  y Microsoft).
- Seguridad vigente: bloqueo de login por intentos (contado antes de comprobar, exacto también con
  intentos simultáneos), CAPTCHA (Turnstile) en reservas y registro, registros de auditoría no
  editables, cabeceras y CSP en `vercel.json`, la IP del proxy firmada con caducidad y el secreto
  de la verificación en dos pasos cifrado. En la nube la API no arranca si falta algo que la protege
  (claves del CAPTCHA, `PROXY_SECRET`, TLS a la base, `TWO_FACTOR_KEY`).
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

**Versión**: 1.10.0 | **Ratificada**: 2026-10-13 | **Última modificación**: 2026-10-15
