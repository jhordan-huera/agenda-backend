# Reporte final: Tarjeta de fidelización

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev; en el PR de `dev` a `main` del 2026-11-18 (antes, las migraciones 059 y 060) · **Fecha**: 2026-11-16

**Repos**: los dos · **Migración**: Sí: `059_tarjeta_de_fidelizacion.sql` y `060_tarjeta_por_negocio.sql` (después de la 058)

## Resumen

Cada consultorio puede armar su tarjeta de fidelización, con sus propios beneficios. Cada cita atendida suma un sello y,
al llegar a un beneficio, el paciente gana su premio con un código, que Recepción canjea (si es un descuento, baja el
precio de la cita). El paciente puede crear una cuenta con su teléfono y una contraseña. En su cuenta ve su tarjeta
(diseño B, «Tarjeta clara») y tiene un QR que el profesional escanea en la cita: la primera vez lo une a su ficha, y
después marca la cita como atendida. Reservar sigue igual, sin cuenta.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – El consultorio arma su programa | P1 | Hecha | «Fidelización» en el menú (propietario y administrador) |
| H2 – Las citas atendidas suman sellos | P1 | Hecha | Por cualquier camino; corrección, ciclos y niveles |
| H3 – La cuenta y la tarjeta del paciente | P1 | Hecha | /mi-tarjeta, diseño B, colores de cada negocio |
| H4 – «Escanear» | P1 | Hecha | Cámara del navegador o lector de respaldo; también la cámara del celular con /q/:token |
| H5 – El canje | P2 | Hecha | En la ficha, en la cita y en «Recompensas» |
| H6 – Avisos y contraseña | P2 | Hecha | Email «Ganaste un premio» con copia; progreso en el de seguimiento; enlace por WhatsApp |
| H7 – Las cifras | P3 | Hecha | Cifras, «Pacientes» y «Recompensas» con filtros y código |
| H8 – Las redes | P3 | Hecha | Configuración → Negocio, página de reservas y tarjeta |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Un programa por negocio, apagado al empezar | Cumple | `loyalty.test.ts` (apagado, quién lo configura, la actividad) |
| RF-002 – Beneficios sin límite, sin repetir citas entre los activos | Cumple | `loyalty.test.ts` (tres beneficios, 409 con citas repetidas, validaciones) |
| RF-003 – Editar, activar, borrar o archivar | Cumple | `loyalty.test.ts` (desactivar y activar, borrar sin historial, archivar ganado) |
| RF-004 – La recompensa guarda el beneficio como era | Cumple | `loyalty.test.ts` (editar no cambia lo ganado) |
| RF-005 – Un sello por paciente y cita Atendida, desde que se enciende | Cumple | `loyalty.test.ts` (la ficha, «Marcar todas», el QR, grupo, no dos veces, no lo anterior) |
| RF-006 – Desbloqueo de varios a la vez, sin duplicados | Cumple | `loyalty.test.ts` (2 y 4 a la vez; dos cierres a la vez, un solo premio) |
| RF-007 – La corrección quita el sello y anula lo no canjeado | Cumple | `loyalty.test.ts` |
| RF-008 – Niveles con «Empezar una tarjeta nueva» | Cumple | `loyalty.test.ts` (Plata en la segunda tarjeta, lo ganado se conserva) |
| RF-009 – Estados Disponible, Canjeada, Vencida y Anulada | Cumple | `loyalty.test.ts` (vencida y anulada no se canjean) |
| RF-010 – Nadie suma ni quita sellos a mano | Cumple | No hay ninguna ruta para eso; sólo los cambios de estado de la cita |
| RF-011 – Canje una vez, quién puede | Cumple | `loyalty.test.ts` (Recepción sí, Profesional y otro negocio no, 409 la segunda vez) |
| RF-012 – El canje ajusta el precio de una cita sin pagar | Cumple | `loyalty.test.ts` ($40 a $20; una pagada no cambia) y el recorrido ($35 a $17,50) |
| RF-013 – Cuenta con teléfono (+593) y contraseña, opcional | Cumple | `patient-accounts.test.ts` (los dos formatos del teléfono, 409 si ya existe) |
| RF-014 – Sesión del paciente aparte | Cumple | `patient-accounts.test.ts` (no entra a /businesses; la del equipo no sirve en /patient) |
| RF-015 – Contraseña cifrada, límite de intentos, CAPTCHA | Cumple | bcrypt 12, 10 intentos por teléfono cada 15 min (prueba), el límite por conexión, CAPTCHA al crear la cuenta y al entrar, sin contraseñas comunes |
| RF-016 – QR propio que se puede cambiar | Cumple | `patient-accounts.test.ts` (el anterior responde 404) |
| RF-017 – La cuenta se une sólo con el escaneo | Cumple | `patient-accounts.test.ts` (sólo con una cita de hoy que el usuario ve; una cuenta con el teléfono de otro no ve nada) |
| RF-018 – El QR marca la cita de hoy por el mismo camino | Cumple | `patient-accounts.test.ts` (Atendida, el sello, las dos entradas de la actividad, 409 la segunda vez) |
| RF-019 – El paciente ve sólo sus tarjetas | Cumple | `patient-accounts.test.ts` (sin datos de otros pacientes) |
| RF-020 – Enlace de contraseña del consultorio | Cumple | `patient-accounts.test.ts` (un uso, cierra las sesiones, el aviso, la actividad, otro negocio no) |
| RF-021 – Cambiar contraseña, salir y eliminar la cuenta | Cumple | `patient-accounts.test.ts` (al eliminarla, el negocio conserva la ficha y los sellos) |
| RF-022 – Email del premio con copia; progreso en el de seguimiento | Cumple | `loyalty.test.ts` (asunto sin el servicio, el código, la copia, «Llevas 1 sello… te falta 1 cita…») |
| RF-023 – «Fidelización»: cifras, pacientes, recompensas | Cumple | `loyalty.test.ts` y el recorrido con capturas |
| RF-024 – Las redes del negocio | Cumple | `patient-accounts.test.ts` (@usuario a enlace, otro dominio no, Recepción no, página de reservas) y `check:loyalty` |
| RF-025 – La actividad | Cumple | Las pruebas cuentan las entradas de cada acción |
| RF-026 – Los textos de «sin cuenta» y /privacidad | Cumple | `check:landing` y la sección nueva de /privacidad |
| CE-001 – Las 16 pruebas del pedido | Cumple | `loyalty.test.ts` y `patient-accounts.test.ts` (numeradas en cada línea) |
| CE-002 – Un escaneo y un toque | Cumple | El recorrido del panel: el QR abre la cita de hoy con «Marcar como atendida» |
| CE-003 – Una cuenta con el teléfono de otro no ve nada | Cumple | `patient-accounts.test.ts` |
| CE-004 – 390 y 1440 px, claro y oscuro, sin desplazamiento | Cumple | Recorridos con Playwright (desborde 0 en todas las pantallas) |
| CE-005 – Lo que ya existía sigue igual | Cumple | Backend 79 de 79 suites; front build, lint y 13 de 13 `check:*` |

**Pruebas automáticas:**
- backend: `typecheck` y `npm test`, 79 de 79 suites (2 nuevas);
- front: `tsc`, `lint`, `build` y 13 de 13 `check:*` (con `check:loyalty`, nueva).

**Recorridos:** con la API real en local:
- programa, beneficios, tres citas atendidas, la cuenta, el escaneo, unir y marcar;
- capturas de «Mi tarjeta» (390 px, claro y oscuro), el QR, «Entrar», «Fidelización» y la ficha (1440 px).

El panel y la app del paciente se recorrieron además por separado, incluida la cámara con un video falso, con el lector del
navegador y con el de respaldo.

## Cambios respecto al plan

- **El CAPTCHA al entrar:** se pide siempre (no sólo desde el tercer intento), además del límite por teléfono y por conexión.
- **Menos CPU** (pedido del dueño, 2026-11-16):
  - guardar un beneficio busca con una consulta sólo las tarjetas que ganan un premio, en lugar de revisarlas todas;
  - el desbloqueo usa una consulta liviana;
  - «Pacientes» y la ficha agrupan los conteos.
- **La cámara en Vercel:**
  - `Permissions-Policy` pasa de `camera=()` a `camera=(self)`;
  - la CSP suma `'wasm-unsafe-eval'` para el lector de respaldo de Safari y Firefox (sólo permite compilar WebAssembly).
- **La analítica:** el token del enlace de contraseña (base64url) se tapa por su ruta en `anonymize-url.ts`.
- **«Escanear» en la Agenda y en Inicio:** entre 640 y 1536 px muestra sólo el ícono, para no empujar «Nueva cita».
- **Cambios pedidos por el dueño después de probar (2026-11-16):**
  - al escanear salen primero las fichas con el mismo teléfono que la cuenta y se unen sin cita; «Paciente nuevo» crea
    la ficha con el teléfono de la cuenta (`/scan/new-client`, que reutiliza `insertClient`);
  - la ficha dice si la cuenta está unida, creada con su teléfono y sin unir, unida a otra ficha o no existe
    (`ClientLoyalty.account`);
  - al escanear o al unir, la única cita de hoy por atender queda Atendida sola (`completedNow`);
  - la contraseña del paciente desde 4 caracteres (un PIN), sin los fáciles, con el bloqueo creciente en
    `rate_limits` (sin migración);
  - «QR para tus pacientes» en Fidelización y en Escanear: la lámina PNG con el logo del negocio (o el de Agenda360)
    en el centro del QR (corrección alta), copiar el enlace y compartir por WhatsApp; el QR abre
    `/mi-tarjeta?consultorio=<slug>` con el logo, el nombre y los colores del consultorio y «Crear mi cuenta» primero
    (`GET /api/patient/invite/:slug`, una consulta). La lámina de reservas usa ahora las mismas funciones
    (`src/lib/qr-sheet.ts`);
  - `npm run dev:https` en el front (`@vitejs/plugin-basic-ssl` 2.3.0, sólo en desarrollo) para probar la cámara desde
    el celular, y el aviso de «página segura» cuando la cámara no se puede usar por `http`.

## Revisión de seguridad (2026-11-16)

La hizo un revisor nuevo, que no vio cómo se construyó, sobre los commits de los dos repos. Encontró problemas reales,
y casi todos se corrigieron con sus pruebas (backend d124414, front 9b66a70):

| Hallazgo | Severidad | Qué se hizo |
|---|---|---|
| Con el enlace de contraseña, un empleado (o alguien con un negocio propio y una foto del QR) entraba a la cuenta y veía las visitas del paciente en **otros** consultorios | Alta | Después de un enlace del consultorio X, la cuenta ve sólo la tarjeta de X y las de los consultorios que la vuelvan a escanear en persona. Prueba en `patient-accounts.test.ts` |
| La unión cuenta–ficha se decidía por el nombre, que escribe el dueño de la cuenta, y no se podía deshacer | Media | El escaneo muestra los 4 últimos dígitos del teléfono de la cuenta y marca las fichas con el mismo teléfono. «Desunir la cuenta» en la ficha, con la actividad. Pruebas |
| Entrar no pedía CAPTCHA (lo pedía la spec) | Media | CAPTCHA al entrar; se rechazan las contraseñas más comunes |
| Cambiar la contraseña sin límite de intentos; eliminar la cuenta sin la contraseña | Baja | Límite de intentos; eliminar pide la contraseña. Prueba |
| Los enlaces de contraseña no se anulaban entre sí | Baja | Un enlace nuevo, cambiar o restablecer la contraseña anulan los anteriores. Prueba |
| El Profesional («sólo sus pacientes») podía unir una ficha fuera de su alcance | Baja | Se comprueba el alcance al unir |
| Un nombre de 81 a 120 caracteres daba error 500; `/api/patient` mal etiquetado en los avisos de errores | Informativo | Nombre hasta 80; `/api/patient` en los avisos |

Lo que la revisión encontró bien resuelto:
- las sesiones separadas;
- la protección CSRF;
- las cookies y los tokens;
- el inicio de sesión sin revelar si hay cuenta;
- que no se pueda leer datos de otro negocio cambiando un identificador;
- el doble canje;
- SQL, XSS y las redirecciones;
- la analítica y Sentry sin tokens;
- RLS en las tablas nuevas.

## Segunda revisión (2026-11-16, después de los cambios del dueño)

Dos revisores nuevos (seguridad y lógica) sobre los commits ca97c37 y e641f76 (backend) y 0cf110f y a73d1e6 (front).
El dueño pidió corregir todo «según como sea mejor»; se aplicaron las tres recomendaciones:

- **Un QR que llega como enlace no se escanea solo** (`/q/:token`, `?qr=`): pide «El paciente está aquí: escanear» y el
  código se quita de la dirección, así recargar o volver atrás no repite el escaneo. Antes, mandar el enlace por
  WhatsApp bastaba para dejar la cita atendida, para volver a mostrar tarjetas ocultas tras un enlace de contraseña o
  para unir con un toque una cuenta con el teléfono de otro.
- **La cita se marca sola sólo si es la única pendiente o confirmada, de un solo paciente y desde una hora antes de su
  inicio** (`completesOnScan`, `startsSoon`); las demás, con «Marcar como atendida». El aviso dice que sólo el
  propietario la corrige («Corregir estado»).
- **«Tu cuenta quedó unida»** al email de la ficha cuando se une una cuenta (`loyalty_linked`, sin copia al
  profesional: no es de una cita).
- **El bloqueo ya no se salta en paralelo** (`checkPassword`, una transacción con `for update`) y vale también para
  cambiar la contraseña y eliminar la cuenta.
- `normalizePhone` quita el 0 después del +593 («+593 099…»); las fichas inactivas salen marcadas y no se unen; aviso de
  la tarjeta apagada en «QR para tus pacientes»; «Paciente nuevo» advierte si ya hay una ficha con su teléfono y explica
  qué hacer si su ficha tiene otro; la lámina de reservas vuelve a su corrección de errores de antes; el resultado del
  escaneo no espera las recargas; `/mi-tarjeta?consultorio=` espera el consultorio sin saltos; los QR y el enlace de
  reservas usan la dirección pública del sitio en lo que se publica (`src/lib/public-url.ts`).
- Las citas de prueba ya no dependen de la hora a la que se corre la suite.

## Sólo en los negocios que habilite el super admin (2026-11-18)

Pedido del dueño: la tarjeta sólo para los negocios que la soliciten, y sólo el super admin la habilita. Migración 060
(`businesses.loyalty_allowed`, apagada en todos; la conservan los que ya la tenían encendida, sólo en bases de prueba).

- Super admin → el negocio → Ajustes → «Tarjeta de fidelización» (`PUT /admin/businesses/:id/loyalty-allowed`, en la
  actividad del negocio). El negocio no puede cambiarlo.
- Sin ella: sin «Fidelización», «Escanear» ni «QR para tus pacientes» (el menú, los botones y las páginas lo dicen); la
  API responde 403 en el programa, los beneficios, las cifras y Escanear, y 404 en la invitación del QR.
- Al quitarla (decisión del dueño, «se apaga todo»): también se apaga el programa, deja de sumar sellos y sus pacientes
  dejan de ver la tarjeta. Los sellos, los premios y las cuentas unidas se guardan; lo ya ganado se canjea desde la ficha.
  Volver a habilitarla no la enciende: lo hace el propietario.
- Pruebas: tests/loyalty.test.ts («Sólo en los negocios que habilita el super admin» y «Al quitarla») y
  tests/patient-accounts.test.ts; recorrido en el navegador del super admin y del propietario.

## Pendientes y riesgos

- **Queda (bajo):** alguien puede registrar primero el teléfono de otra persona.
  - No ve nada de ningún consultorio, pero el dueño real ya no puede crear su cuenta con ese número.
  - Hoy no hay forma de liberarlo. Se propone que el super admin pueda borrar una cuenta sin fichas unidas.
- **Queda (bajo):** quien tenga el QR de un paciente y cree un negocio propio puede unirlo a una ficha falsa y cambiarle
  la contraseña.
  - Ya no ve nada de sus consultorios.
  - Sí puede dejarlo fuera de su cuenta hasta que su consultorio le mande otro enlace.
  - El paciente puede pedir un QR nuevo.
- **Riesgo aceptado de la spec:** una foto del QR sólo sirve para unir con una cita de hoy o con la ficha de su mismo
  teléfono, y el QR se puede cambiar.
- **Unir por teléfono sin cita (2026-11-16):** quien escanea debe comprobar que la persona es la de la ficha (sale el
  final de su cédula). Si une a otra persona con el teléfono del paciente, la ficha lo dice y se puede desunir.
- **Queda (bajo):** la ficha dice si un teléfono tiene cuenta. Alguien con un negocio propio podría consultar teléfonos
  así; saber eso vale poco.
- **Queda (bajo):** quien sepa el teléfono de un paciente puede dejar su cuenta esperando hasta 24 horas con intentos
  fallidos. El enlace del consultorio la desbloquea.
- **Queda (bajo, CPU):** buscar la ficha por teléfono recorre las fichas del negocio, sólo la primera vez que se escanea
  una cuenta (milisegundos con miles de fichas). Si crece mucho, un índice de expresión sobre el teléfono.
- **El PIN de 4 números (2026-11-16):** 10.000 combinaciones. Lo cuidan el bloqueo creciente (con un fallo al día como
  mucho, adivinar uno que no sea de los fáciles tomaría años), el CAPTCHA y que se rechazan los fáciles.
- **Escanear marca la cita (2026-11-16):** desde una hora antes de su inicio queda Atendida y sale el email de
  seguimiento. Si no correspondía, sólo el propietario la corrige («Corregir estado»; el sello se quita solo).
- **Las preguntas frecuentes de la portada que dicen que el paciente no crea cuenta siguen siendo ciertas** (hablan de reservar). Se pueden matizar si el dueño quiere.

## Commits

- **agenda-backend:**
  - e5965e6 (spec);
  - cbdd2bf (plan);
  - 9ad6f34 (parte 1);
  - a067149 (parte 2);
  - 114259c (constitución 1.50.0);
  - 7fae5a2 (menos CPU);
  - d124414 (revisión de seguridad);
  - 2aafc8d (reporte);
  - ca97c37 (cambios del dueño al probarla);
  - e641f76 (la invitación del QR);
  - fc1d841 (segunda revisión);
  - 7087a98 (sólo en los negocios que habilite el super admin);
  - 23fa487 (contraseñas de prueba al azar).

  El 2026-11-18 se reescribieron los cuatro commits desde ca97c37 para cambiar un valor de prueba que marcó GitGuardian
  (sólo esa línea de tests/patient-accounts.test.ts).
- **agenda-front:**
  - 78213cf (lo compartido);
  - 186688b (base);
  - c73525a (constitución);
  - c9ddb23 (panel y app del paciente);
  - 4b63419 («Te falta 1 cita»);
  - 9b66a70 (revisión de seguridad);
  - 0cf110f (cambios del dueño al probarla);
  - a73d1e6 («QR para tus pacientes»);
  - 59a4be0 (segunda revisión);
  - 45f97ec (sólo en los negocios que habilite el super admin).

## Cómo publicarlo (cuando el dueño lo pida)

1. Aplicar en producción la migración 058 (si todavía no está), después la 059 y después la 060.
2. Abrir el PR de `dev` a `main` del backend y después el del front.
3. Todo sale apagado: el super admin habilita la tarjeta en los negocios que la pidan (Negocios → el negocio →
   Ajustes → «Tarjeta de fidelización») y cada uno la enciende en «Fidelización».
4. Después de publicar, probar «Escanear» en un iPhone (Safari usa el lector de respaldo).
