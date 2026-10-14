# Cómo comprobarlo en local: Endurecimiento de seguridad

Todo en local, con la base de demostración. Nunca en Vercel ni contra Supabase. Los servidores de
prueba van en puertos propios (por ejemplo 4180, 5199 y 3199) y se detienen por puerto o PID.

## 1. Pruebas automáticas

```
cd ~/Documentos/Proyectos/Backend/agenda-backend
npm run typecheck
npm test
```

```
cd ~/Documentos/Proyectos/Frontend/agenda-front
npm run build
npm run lint
```

### Suites nuevas

**`tests/attempt-limits.test.ts`:**
- **Inicio de sesión:** 100 contraseñas equivocadas a la vez contra una cuenta, desde una conexión.
  - como mucho 10 llegan a comprobarse (cuentan los `session.login_failed`);
  - el resto recibe 429;
  - después, la contraseña correcta también recibe 429 hasta que pase la ventana.
- **Paso intermedio de la verificación:** 50 códigos equivocados a la vez. Como mucho 5 se comprueban
  y el paso deja de servir.
- **Con la sesión abierta:** al cambiar el email con contraseñas equivocadas, se bloquea al llegar
  al tope y cada fallo queda registrado. Lo mismo al cambiar la contraseña, al desactivar la
  verificación y al generar códigos de recuperación.
- **Uso normal:** un fallo y después la contraseña correcta deja entrar y pone a cero los contadores
  de la cuenta.

**`tests/account-alerts.test.ts`:**
- **Activar y desactivar la verificación, y cambiar la contraseña, de un super admin de prueba.** Cada
  cambio deja:
  - un email `account_security_changed` a la cuenta y otro al principal;
  - uno solo, si es el principal.
- **`session.password_changed`** queda con IP y navegador.
- **El cron, con un ntfy falso,** arma «Agenda360: cambio en una cuenta de super admin»:
  - con la cuenta a medias y sin nombres en el título;
  - lo mismo después de `db:reset-2fa`.

**`tests/booking-verify.test.ts`:**
- **Dos reservas comparadas:** una con la cédula de un paciente y otro email y otro teléfono, otra con
  una cédula nueva. Deben coincidir en:
  - el código de respuesta y los campos de `BookingConfirmation`;
  - los emails en cola (tipo y destinatario: el correo escrito);
  - la hora ocupada.
- **El paciente aparte:**
  - tiene `claimedClientId` y la cédula vacía;
  - la ficha real no cambia y no recibe ningún email, ni el recordatorio.
- **Topes:** con el negocio en su tope de pacientes nuevos, las dos dan el mismo 429.
- **Reintento:** reenviar la misma reserva da 200 «repetida», igual que con una cédula nueva.
- **Reservar otro día con los mismos datos** reutiliza el mismo paciente aparte.
- **Sesión en pareja:** la segunda persona por verificar queda aparte y la primera, en su ficha.
- **Rol Profesional con «sólo sus pacientes»:** ve al paciente aparte, no ve la ficha real y no puede
  unir (403).
- **Unir, desde Recepción:**
  - las citas pasan a la ficha, el email y el teléfono se actualizan sólo si se pidió;
  - el paciente aparte desaparece y la actividad registra `client.claim_confirmed`;
  - si el paciente aparte ya tenía historia clínica, da 409.
- **Cancelar:** la cancelación sale al correo escrito.
- **ntfy:** el aviso de la reserva dice «Por verificar».
- **Cliente antiguo sin cédula:** con el mismo nombre y email pero otro teléfono, no recibe la cédula.

**`tests/hardening.test.ts`:**
- **«Recordarme»:** una sesión de hace 31 días (la de un super admin, de 8) ya no vale aunque se haya
  usado ayer. Una de hace 10 días sí vale.
- **Secreto de la verificación:**
  - al activarla, lo guardado empieza por `v1.`;
  - un secreto en claro de antes sigue dejando entrar y queda cifrado después del código.
- **Respuestas públicas:** con una cookie de sesión válida, `GET /public/businesses/:slug`,
  `/public/platform-settings`, `/public/categories` y `/public/captcha` responden sin `Set-Cookie`.
- **Firma de la IP:**
  - una firma válida da la IP en los eventos de sesión;
  - una de hace más de 120 s, o con otra IP, no;
  - el secreto de hoy sigue valiendo (fase 1).
- **Arranque en la nube** (`VERCEL=1`), quitando cada variable de la lista por turno: el proceso
  termina, con un mensaje que nombra lo que falta y no muestra ningún valor.
- **Datos de más:**
  - la bandeja del propietario no muestra los emails a los super admin;
  - el rol Profesional recibe en blanco el email, la sala y las cuentas de las otras agendas, y la
    suya entera;
  - un super admin sin verificación recibe `two_factor_required` al pedir a otro usuario.
- **Nombres en la reserva y el registro:** con salto de línea, «@», `http://`, `www.` o «algo.com»,
  da 400.
- **Topes de emails:** con `PUBLIC_EMAILS_PER_DAY` bajo, las reservas nuevas se frenan y los
  recordatorios y avisos del panel siguen saliendo.
- **ntfy:** el teléfono sale como «***5555».

### Suites que se actualizan

| Suite | Qué cambia |
|---|---|
| `cedula.test.mjs`, `couple-booking.test.ts` | El 403 de «No pudimos confirmar…» pasa a ser «por verificar». |
| `booking-alert.test.ts` | El formato del teléfono. |
| `two-factor.test.ts` | Lee el secreto de la respuesta de `setup`, no de la base. |
| `security-sessions.test.ts` | Los topes nuevos. |
| `public-abuse.test.ts` | Los dos topes de emails. |
| `cron.test.mjs` | La línea del registro. |

## 2. Recorrido con Playwright (local, escritorio y 390 px)

**API, front y datos:**
- la API local en el 4180;
- el front con Vite en el 5199, con `API_PROXY_TARGET=http://localhost:4180`;
- la demo.

**Pasos:**
1. **Reservar en la página de la clínica demo** con la cédula de un paciente y otro email y otro
   teléfono. Debe salir la pantalla «¡Cita reservada correctamente!», igual que con una cédula nueva.
2. **En el panel, como Recepción:**
   - la cita lleva «Por verificar» en la agenda (día, semana y lista del celular) y en la ficha del
     paciente;
   - su ficha muestra el aviso con el nombre del paciente de la ficha.
3. **«Es el mismo paciente: unir a su ficha»,** marcando «actualizar el email»:
   - la cita pasa a la ficha y la marca desaparece;
   - la actividad lo registra.
4. **Otra reserva por verificar y «Cancelar la cita»:** queda cancelada.
5. **Como Valeria (rol Profesional):** ve el aviso sin el nombre de la ficha y no puede unir.
6. **Cerrar sesión con la red cortada** (Playwright `context.setOffline(true)`):
   - sale «No se pudo cerrar la sesión…» con «Reintentar» y el panel no dice «Sesión cerrada»;
   - con la red de vuelta, «Reintentar» cierra la sesión.
7. **/privacidad:** aparecen Nominatim y Vercel Analytics.
8. **El panel y la ficha de la cita a 390 px:** sin desplazamiento horizontal.

## 3. CSP y proxy del front

- **CSP:**
  1. `npm run build`;
  2. servir `dist/` con un servidor estático del scratchpad que aplique las cabeceras de
     `vercel.json` y reenvíe `/api` a la API local;
  3. recorrer la portada, la página de reservas (logo, fotos, mapa y CAPTCHA de prueba), el panel
     (avatares, QR de la página de reservas, mapa del local) y /admin.

  La consola no debe mostrar ningún error de CSP.
- **Proxy:** un script de Node llama a la función de `middleware.ts` con una `Request`. Comprueba
  que:
  - borra las cabeceras `x-agendo-*` que manda el navegador;
  - pone la IP, la hora y una firma que la API local acepta.

## 4. Beta (puerto 3199)

1. `npm run build` y `npm run lint`.
2. Reservar con la cédula de un paciente de prueba y otros datos: la reserva sale bien.
3. En el panel aparece «Por verificar», y se puede unir a la ficha o cancelar.
