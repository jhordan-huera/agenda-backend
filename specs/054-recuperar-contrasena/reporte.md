# Reporte final: Recuperar la contraseña con una contraseña temporal

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-11-20

**Repos**: los dos · **Migración**: Sí: `061_recuperar_contrasena.sql`

## Resumen

El propietario, los profesionales, recepción, los administradores y el super admin ya pueden recuperar su acceso
solos: «¿Olvidaste tu contraseña?» les envía una contraseña temporal por email, que sirve una vez y vence en 1 hora, y
al entrar con ella crean la suya. La contraseña que pone el soporte también es temporal y, además del email, el super
admin puede enviarla por WhatsApp con el mensaje ya escrito. Cualquier cuenta cambia su contraseña en Configuración →
Perfil. Los pacientes siguen igual.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Recupera su acceso con una contraseña temporal | P1 | Hecha | |
| H2 – Crea su contraseña nueva al entrar | P1 | Hecha | |
| H3 – La contraseña del soporte también es temporal (con WhatsApp) | P2 | Hecha | «Enviar por WhatsApp» pedido mientras se escribía la spec |
| H4 – Cambia su contraseña cuando quiera | P2 | Hecha | En modo soporte no se muestra (sería la del super admin) |
| H5 – El super admin, con su verificación en dos pasos | P1 | Hecha | |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – misma respuesta y mismo tiempo | Cumple | `password-recovery.test.ts`: 204 con email existente, inexistente y desactivado; el inexistente tarda parecido |
| RF-002 – email con la temporal, oculta en el registro | Cumple | Prueba: 10 caracteres del alfabeto, «••••••••» en el registro y la contraseña sólo en `secret`; `check:password-recovery` |
| RF-003 – la de siempre sigue; sólo la última; una vez; 1 hora | Cumple | Prueba: entrar con la de siempre anula la temporal, la anterior no sirve, la usada no sirve, la vencida no sirve |
| RF-004 – sesión que sólo crea la contraseña | Cumple | Prueba: 403 `password_change_required` en /businesses, /users, /admin, /push, /auth/two-factor y change-password; recorrido local |
| RF-005 – la nueva: 8, coincide, distinta; sesiones y email | Cumple | Prueba: los tres errores, la otra sesión cerrada, la cookie de dispositivo nueva, «Cambiaste tu contraseña» |
| RF-006 – la del soporte y las altas, temporales | Cumple | Prueba: «Cambiar contraseña» y el alta de un miembro quedan marcadas; distinta de la del soporte |
| RF-007 – cambiarla en Perfil, cualquier cuenta | Cumple | Prueba con recepción: la actual incorrecta cuenta como intento fallido; recorrido local |
| RF-008 – super admin con 2FA y avisos | Cumple | Prueba: pide el código, email de seguridad y el aviso de ntfy (`findAccountChanges`) |
| RF-009 – topes | Cumple | Prueba: 3 por hora y 5 por día por email (sin email, misma respuesta); 10 por hora por conexión (429) |
| RF-010 – actividad sin la contraseña | Cumple | Prueba: pedidos (también de un email no registrado) y entradas en Seguridad; ninguna contraseña en `audit_logs` |
| RF-011 – pacientes sin cambios | Cumple | `patient-accounts.test.ts` y `loyalty.test.ts` pasan sin tocarlos |
| RF-012 – constitución | Cumple | 1.52.0 en los dos repos (principio III) |
| RF-013 – «Generar una» y WhatsApp sin que la API devuelva la contraseña | Cumple | Recorrido local: el enlace `wa.me` con el mensaje; la API sólo responde 204 |
| CE-001 – pruebas del backend | Cumple | `tests/password-recovery.test.ts`: 62 comprobaciones |
| CE-002 – typecheck, test, build, lint y check:* | Cumple | Ver abajo |
| CE-003 – computador y celular (390 px) | Cumple | Recorrido local con Playwright: pedirla, entrar, crearla, Perfil y el diálogo del soporte; sin desplazamiento horizontal |
| CE-004 – volver a entrar en menos de 3 minutos | Cumple | El recorrido local toma menos de un minuto sin contar la espera del email |
| CE-005 – el email en una dirección de prueba | Sin comprobar | En local no hay Gmail: se comprobó el contenido en la cola y con `check:password-recovery` |

**Pruebas automáticas**: back: `npm run typecheck` sin errores; `npm test` 81 de 81 suites (con la nueva `password-recovery.test.ts`). Front: `npm run build`
y `npm run lint` sin errores; las 14 `check:*` pasan (con la nueva `check:password-recovery`). La migración 061 se
aplicó sobre una base nueva con las 60 anteriores.

## Cambios respecto al plan

- **`newPassword` va en `auth-service.ts`** y no en `password-recovery.ts`: necesita crear la sesión libre y la cookie
  del dispositivo, que viven ahí. `password-recovery.ts` tiene el pedido y la comprobación de la temporal.
- **El email del cambio para las cuentas del equipo** es la plantilla nueva `ownPasswordChanged` («Cambiaste tu
  contraseña», con «Recuperar el acceso»); el super admin sigue con `accountSecurityChanged`, a él y al dueño.
- **Al entrar con una temporal no sale «¡Bienvenido de nuevo!»**: la pantalla pide crear la contraseña.
- **Las pruebas anteriores que crean cuentas** dan por creada la contraseña del soporte (`acceptSupportPassword` en
  `tests/helpers/business.mjs`); la temporal del soporte se prueba en `password-recovery.test.ts`. Los agentes de
  `smoke` y `passwords` guardan varias cookies, como un navegador.

## Pendientes y riesgos

- **Riesgo aceptado (en la constitución):** el super admin podría usar una contraseña temporal antes que la persona;
  ésta ya no podría entrar con ella y lo notaría.
- **El email puede llegar al correo no deseado:** la página lo dice y muestra el contacto del soporte.
- **Sin teléfono en la cuenta**, «Enviar por WhatsApp» pide elegir el contacto. En la ficha del negocio el diálogo no
  tiene el teléfono de la persona (la lista de Usuarios sí).

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | f5334cf | Spec 054: la contraseña temporal, la sesión que sólo crea la nueva, la del soporte temporal, el cambio en Perfil, migración 061 y pruebas |
| agenda-front | 5ad1014 | Spec 054: «¿Olvidaste tu contraseña?», «Crea tu contraseña nueva», Perfil y «Enviar por WhatsApp» en el diálogo del soporte |

## Cómo publicarlo

1. El dueño del producto aplica la migración 061 en producción con `npm run db:migrate` en agenda-backend, **antes**
   del PR del backend.
2. PR `dev` → `main`: primero el backend (sin él, «¿Olvidaste tu contraseña?» del front nuevo respondería 404) y
   después el front.
3. Después de publicar: pedir una contraseña temporal con una cuenta propia y comprobar que llega el email.

## Texto para el PR

«¿Olvidaste tu contraseña?» con una contraseña temporal por email (1 hora, una vez) y «Crea tu contraseña nueva» al
entrar; la contraseña del soporte también es temporal, con «Enviar por WhatsApp»; cualquier cuenta cambia la suya en
Perfil. **Con migración 061** (aplicarla antes). Reporte: specs/054-recuperar-contrasena/reporte.md.
