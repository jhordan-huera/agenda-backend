# Reporte final: Endurecimiento de seguridad

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-14, PR backend #25 y front #23) · **Fecha**: 2026-10-14

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí: `036_security_hardening.sql`

## Resumen

La revisión de seguridad del 2026-10-14 no encontró nada crítico ni grave. Esta entrega cierra los
dos puntos de gravedad media del inicio de sesión y todos los de gravedad baja, sin tocar las
decisiones guardadas.

**Inicio de sesión y cuentas:**
- los topes de intentos ya no se saltan con peticiones simultáneas;
- cada cambio de seguridad en una cuenta de super admin avisa por email y por ntfy.

**Reserva online:** ya no deja saber si alguien es paciente. Con la cédula de un paciente y otros
datos, la reserva sale igual y queda «Por verificar» hasta que el negocio la une a la ficha o la
cancela.

**Sesiones, secretos y configuración:**
- «Recordarme» dura como mucho 30 días (7 el super admin);
- el secreto de la verificación en dos pasos se guarda cifrado;
- en la nube la API no arranca si le falta algo que la protege.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Topes de intentos exactos | P1 | Hecha | Inicio de sesión, código y las cuatro comprobaciones con la sesión abierta |
| H2 – Avisos de cambios en cuentas de super admin | P1 | Hecha | Email al momento y ntfy desde el cron, también tras `db:reset-2fa` |
| H3 – La reserva no da pistas | P1 | Hecha | «Por verificar», unir o cancelar, cliente antiguo y nombres sin enlaces |
| H4 – Los recordatorios siempre salen | P2 | Hecha | Tope del público (150) dentro del total (400) |
| H5 – Sesiones y secretos | P2 | Hecha | Caducidad máxima, secreto cifrado, respuestas públicas sin cookie, firma de la IP (fase 1), RLS |
| H6 – En la nube no arranca desprotegida | P2 | Hecha | Y la cookie va siempre como segura en la nube |
| H7 – Cada uno recibe lo suyo | P2 | Hecha | Bandeja, agendas del rol Profesional y ficha de un usuario |
| H8 – Front | P3 | Hecha | Cerrar sesión, /privacidad y CSP |
| H9 – Registros públicos y ntfy | P3 | Hecha | `BACKUP_EMAIL`, Lambda sólo desde `main` y el teléfono como «***5555» |

## Comprobación

Todo en local: PostgreSQL desechable para `npm test`; para los recorridos, API en el 4180, front en
el 5199 y una base de prueba con los datos de demostración. Nunca en Vercel ni contra Supabase.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Intento contado antes de comprobar | Cumple | `attempt-limits.test.ts`: de 100 contraseñas equivocadas a la vez se comprueban como mucho 10; de 50 códigos, como mucho 5, y ninguno abre sesión |
| RF-002 – Comprobaciones con la sesión abierta | Cumple | `attempt-limits`: cambiar el email se bloquea al llegar al tope y cada fallo queda registrado; también cambiar la contraseña, desactivar la verificación y los códigos de recuperación |
| RF-003 – Cambio de contraseña en los eventos | Cumple | `account-alerts`: `session.password_changed` con la IP |
| RF-004 – Avisos de cambios de cuenta | Cumple | `account-alerts`: 2 emails por cambio y 1 si es el principal; el cron arma un aviso por cambio, a medias y sin nombres, también tras `db:reset-2fa` |
| RF-005 – Por verificar indistinguible | Cumple | `booking-verify`: la misma respuesta, los mismos emails, la hora ocupada, el mismo reintento y el mismo 429 en el tope. Recorrido: «¡Cita reservada correctamente!» |
| RF-006 – Aparte de la ficha | Cumple | `booking-verify`: paciente sin cédula que apunta a la ficha; la ficha no cambia; el rol Profesional no ve la ficha real |
| RF-007 – Emails al correo escrito | Cumple | `booking-verify`: ningún email a la ficha, ni el recordatorio; la cancelación, al correo escrito |
| RF-008 – Panel | Cumple | Recorrido: la marca en la agenda (día, semana y lista del celular), en la ficha de la cita, en la del paciente y en la lista de pacientes; el aviso nombra a la paciente |
| RF-009 – Unir sin duplicar | Cumple | `booking-verify` y recorrido: las citas pasan a la ficha, con el email nuevo si se marca; el paciente aparte desaparece; queda `client.claim_confirmed`. `couple-booking`: también como otra persona de una sesión |
| RF-010 – ntfy «Por verificar» | Cumple | `booking-verify`: el aviso de la reserva lo dice, sin el nombre de la ficha |
| RF-011 – Cliente antiguo sin cédula | Cumple | `booking-verify` y `cedula`: sin el mismo teléfono no recibe la cédula; con nombre, email y teléfono, sí |
| RF-012 – Nombres sin enlaces | Cumple | `hardening`: salto de línea, «@», `http://`, `www.` y «algo.com» dan 400, en la reserva y en el registro |
| RF-013 – Dos topes de emails | Cumple | `hardening`: con el tope del público alcanzado, la reserva sale sin email y la confirmación del negocio sí sale |
| RF-014 – Tipos de la spec 008 | Cumple | En `THIRD_PARTY_EMAIL_TYPES`; `public-abuse` y `status-notices` pasan |
| RF-015 – Caducidad máxima | Cumple | `hardening`: 10 días vale y 31 no; el super admin, 7 días |
| RF-016 – Secreto cifrado | Cumple | `hardening`: guardado como `v1.…`; uno de antes en claro deja entrar y queda cifrado |
| RF-017 – Públicas sin cookie | Cumple | `hardening`: cuatro rutas públicas sin `Set-Cookie`, con la renovación forzada |
| RF-018 – Firma de la IP | Cumple | `hardening`: válida, vieja, de otra IP y el secreto de antes (fase 1). `proxy-009.mjs`, 8 de 8: `middleware.ts` firma como verifica la API |
| RF-019 – RLS de `schema_migrations` | Cumple | La 036 se aplicó en limpio sobre una base que ya existía (la local de prueba) |
| RF-020 – No arranca desprotegida | Cumple | `hardening`: cinco casos que terminan con el mensaje y sin valores |
| RF-021 – Cookie segura en la nube | Cumple | `hardening`: con `VERCEL=1`, la cookie va `Secure` |
| RF-022 – Bandeja sin emails a la plataforma | Cumple | `hardening` |
| RF-023 – Agendas del rol Profesional | Cumple | `hardening`: las otras en blanco y la suya entera; Recepción las recibe todas |
| RF-024 – Ficha de un usuario con 2FA | Cumple | `hardening` con `SUPER_ADMIN_2FA=required`: la de otro, 403 `two_factor_required`; la suya, 200 |
| RF-025 – Cerrar sesión que falla | Cumple | Recorrido sin conexión: «No se pudo cerrar la sesión…» sin «Sesión cerrada»; «Reintentar» la cierra |
| RF-026 – /privacidad | Cumple | Recorrido: aparecen Nominatim y Vercel Analytics |
| RF-027 – CSP de imágenes | Cumple | `csp-009.mjs` con las cabeceras de `vercel.json`: sin errores de CSP en portada, reservas, panel y /admin, en escritorio y a 390 px. El mapa y un logo `data:` cargan |
| RF-028 – `BACKUP_EMAIL` | Cumple | `backup.yml` usa el secreto (y la variable mientras exista) |
| RF-029 – Lambda sólo desde `main` | Cumple | `deploy-lambda.yml`: `if: github.ref == 'refs/heads/main' && …` |
| RF-030 – Teléfono «***5555» | Cumple | `booking-alert.test.ts` |
| RF-031 – Beta | Cumple | Build y lint. Recorrido `beta-verificar-009.mjs`: 36 de 36 |
| RF-032 – Constitución 1.6.0 | Cumple | Igual en los dos repos (principios II y III y restricciones de seguridad) |
| CE-001 – 100 intentos | Cumple | `attempt-limits` |
| CE-002 – Avisos de cuenta | Cumple | `account-alerts` |
| CE-003 – Indistinguible | Cumple | `booking-verify` |
| CE-004 – Unir sin duplicar ni dar acceso | Cumple | `booking-verify` y `couple-booking` |
| CE-005 – Los recordatorios siguen | Cumple (medido con el aviso del panel) | `hardening`. El recordatorio no se puso a prueba con el tope lleno: usa la misma regla que el aviso |
| CE-006 – Sin cookie; firma vieja inválida | Cumple | `hardening` |
| CE-007 – En la nube no atiende | Cumple | `hardening` |
| CE-008 – Sin volver a activar la 2FA | Cumple (en local) | `hardening`: un secreto de antes deja entrar. En producción se confirma al publicar |
| CE-009 – Pruebas y 390 px | Cumple | Ver abajo; recorridos a 390 px sin desplazamiento horizontal |

**Pruebas automáticas**:
- **Backend:**
  - `npm run typecheck` sin errores;
  - `npm test`: 48 de 48 suites y 1550 comprobaciones;
  - las suites nuevas: `attempt-limits` (18), `account-alerts` (14), `booking-verify` (28) y `hardening` (43);
  - después se añadieron 2 comprobaciones a `couple-booking`, que pasa con 68.
- **Front:** `npm run build` y `npm run lint` sin errores.
- **Beta:** `npm run build` y `npm run lint` sin errores; el build da los 2 avisos de siempre.
- **Recorridos** (en el scratchpad):
  - `verificar-009.mjs`: 30 de 30;
  - `csp-009.mjs`: 2 de 2;
  - `proxy-009.mjs`: 8 de 8;
  - `beta-verificar-009.mjs`: 36 de 36.

## Cambios respecto al plan

- **Topes de intentos:** se para en el primer tope superado. Así lo que ya bloqueó una conexión no
  suma en el contador de toda la cuenta, y desde una sola IP no se puede dejar al dueño fuera en sus
  conexiones nuevas, que es lo que el diseño de hoy quiere evitar.
- **2FA simultánea:** al bloquearse la conexión también se borra el paso intermedio. En una ráfaga
  pueden no llegar a comprobarse ni los 5 códigos, lo que es aún más seguro.
- **`DATABASE_SSL` en la nube:** se exige sólo con una base remota. En la nube nunca hay una base en
  `localhost`, y así las pruebas que imitan la nube no necesitan TLS local.
- **Desactivar la verificación:** el código se comprueba antes de la transacción, para poder
  registrar el fallo.
- **Añadidos pequeños:**
  - **Paciente por verificar:** si el negocio le escribe su propia cédula, deja de estar por
    verificar.
  - **Lista de pacientes:** también muestra la marca.
  - **Lista de citas en el celular:** las marcas van bajo el título. Con el comprobante y el estado
    al lado, el título ya se cortaba antes de esta spec.
  - **/privacidad:** decía «copia de seguridad diaria» y es semanal; ntfy menciona también el
    teléfono a medias.
- **Pruebas:** un módulo común nuevo, `tests/helpers/harness.ts`.
- **Beta:**
  - la marca en el email al negocio también va, a su estilo (plantillas de texto);
  - la beta no reconoce reintentos, así que no lo necesita;
  - copia previa en `beta-src-antes-009.tgz`.

## Pendientes y riesgos

- **Fase 2 de la firma de la IP:** hecha en `dev` el 2026-10-14, después de publicar.
  - **Qué cambia:** el front ya no manda el secreto fijo y el backend ya no lo acepta (`client-ip.ts`,
    incluida la guarda de Lambda).
  - **Pruebas:** las que simulaban la IP con el secreto ahora la firman (`tests/helpers/proxy.mjs`).
    `hardening` y `public-abuse` comprueban que el secreto de antes ya no vale.
  - **Publicación:** sin migración ni variables nuevas, y en cualquier orden, porque las dos versiones
    publicadas ya usan la firma.
- **Riesgo al publicar:** si en Vercel faltan las claves del CAPTCHA, `PROXY_SECRET` o
  `TWO_FACTOR_KEY`, la API dejará de atender. Por eso los pasos de publicación empiezan
  comprobándolas.
- **Secretos de la verificación de antes:** quedan en claro hasta que cada super admin entre con su
  código, como mucho 7 días con la caducidad nueva.
- **No probado en producción:**
  - los buckets, el RLS real de `schema_migrations` y las variables, que son la consulta y los pasos
    del dueño;
  - las imágenes del bucket de Supabase con la CSP nueva, cuyo dominio es el mismo que ya se usa para
    subirlas.
- **Por verificar:** se esperan pocas citas así, y el negocio tiene que revisarlas.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 9b04be5 | Spec 009: endurecimiento de seguridad (backend) |
| agenda-front | 306fdf1 | Spec 009: endurecimiento de seguridad |

## Cómo publicarlo

**El orden importa:** una variable que falte deja la API sin atender, y la migración va antes del
código que la usa.

1. **Comprobar el CAPTCHA del backend publicado.** Abrir esta dirección y ver `"captcha":true`:

   ```
   https://agenda-backend-lemon.vercel.app/api/health
   ```

   Si dice `false`, poner antes `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` en el proyecto del
   backend en Vercel.
2. **Comprobar las variables del backend en Vercel:**
   - existe `PROXY_SECRET`;
   - `DATABASE_SSL` vale `true`;
   - `DATABASE_URL` no lleva `sslmode`.

   Lo mismo en Lambda, si se usa.
3. **Crear la clave del cifrado** con este comando:

   ```
   openssl rand -base64 48
   ```

   Ponerla como `TWO_FACTOR_KEY` en el backend en Vercel (Production) y en Lambda si se usa.
   Guardarla también en un lugar seguro.
   - **En el `.env` local, sólo después de publicar el backend.** Con la clave, `npm run dev:prod`
     cifra el secreto de la verificación al entrar como super admin, y la versión publicada antes
     no sabe leerlo: el super admin no podría entrar con la app.
   - **Mientras tanto:** no entres como super admin con `dev:prod` ni actives la verificación desde
     ahí. Sin la clave en el `.env`, `dev:prod` no lo permite.
4. **Pasar `BACKUP_EMAIL` a secreto en GitHub.** El primer comando pide el valor:

   ```
   gh secret set BACKUP_EMAIL --repo jhordan-huera/agenda-backend
   ```

   ```
   gh variable delete BACKUP_EMAIL --repo jhordan-huera/agenda-backend
   ```

5. **Migración 036,** como paso aparte:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

6. **PR `dev` → `main` del backend.** Después, sólo mirando:
   - `/api/health` responde;
   - el inicio de sesión con código del super admin funciona.
7. **PR `dev` → `main` del front.**
8. **Fase 2 de la firma,** cuando los dos estén publicados (ver «Pendientes»).
9. **Pasos opcionales:**
   - `GMAIL_TRANSPORT=api` con un token sólo para enviar;
   - `NTFY_TOPIC` largo y aleatorio;
   - el rol de IAM de Lambda sólo para `main`;
   - la consulta de sólo lectura en Supabase.

## Texto para el PR

Endurecimiento de seguridad (spec 009):
- topes de intentos exactos;
- avisos por email y ntfy de los cambios en cuentas de super admin;
- reserva «Por verificar» (la página ya no deja saber si alguien es paciente);
- «Recordarme» con tope;
- secreto de la verificación cifrado;
- respuestas públicas sin cookie;
- firma de la IP con caducidad (fase 1);
- arranque seguro en la nube;
- topes de emails;
- CSP más estricta;
- cerrar sesión que avisa si falla.

**Migración 036 antes del backend, y `TWO_FACTOR_KEY` y las claves del CAPTCHA en Vercel antes de
publicar.** Reporte: `specs/009-endurecimiento-seguridad/reporte.md`.
