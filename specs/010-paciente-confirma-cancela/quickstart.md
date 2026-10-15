# Cómo comprobarlo en local: El paciente confirma o cancela su cita desde el email

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

### Suite nueva: `tests/appointment-page.test.ts`

**Preparación:** el token del principal sale de `paymentToken` en la respuesta del panel. El de las
otras personas sale con `sql(...)` de `appointment_clients.access_token`. Las citas se crean a horas
relativas a «ahora» en la zona del negocio.

- **Página (`GET`):**
  - devuelve el servicio, la fecha, la hora, el profesional, la modalidad y el negocio;
  - en la respuesta no aparece el nombre, el email, el teléfono ni la cédula de ningún paciente.
    También se comprueba la dirección de una cita a domicilio y el enlace de una virtual;
  - responde lo mismo, 404 con el mismo mensaje, en estos casos:
    - un token inventado;
    - un token mal formado;
    - una cita de hace 31 días;
    - una persona quitada de la sesión;
    - un negocio suspendido;
  - lleva `Cache-Control: private, no-store` y no lleva `Set-Cookie`.
- **Confirmar:**
  - **La primera vez:** guarda la hora, el estado no cambia y queda `appointment.client_confirmed` con
    autor «Paciente (desde su email)».
  - **La segunda:** `already: true`, la hora no cambia y no hay otra actividad.
  - **Sin la cabecera `X-Requested-With`:** 403, y no confirma.
  - **Una cita cancelada o que ya empezó:** 409.
  - **Sin email ni aviso:** no sale ningún email, y el cron con un ntfy falso no manda aviso de la
    confirmación.
- **Borrar la confirmación:**
  - **Cambiar la fecha, la hora o el profesional** desde el panel la borra, también la de las otras
    personas. Cambiar las notas o el precio no.
  - **Cancelar desde el panel y reactivar:** queda sin confirmar, y se puede volver a confirmar.
  - **Atendida:** la conserva.
- **Cancelar (CE-002):**
  - **Con «Permitir cancelaciones» y la cita a 25 h** (antelación de 24 h): cancela.
    - La cita queda Cancelada y la hora aparece libre en `GET /public/businesses/:slug`.
    - Sale `appointment_cancelled` a cada persona y una `appointment_copy`.
    - La actividad registra `appointment.client_cancelled`, con «Estado» en los cambios.
  - **La cita a 23 h:** 409 «Para cancelar con menos de 24 h…», y la cita sigue igual.
  - **Con la antelación en 0:** cancela hasta el inicio.
  - **Con «Permitir cancelaciones» apagado:** 409, y el `GET` dice `disabled`.
  - **Otra persona de la sesión:** 409, y el `GET` dice `not_main`. Sí puede confirmar.
  - **Cancelar dos veces:** la segunda da `already: true`, sin otro email.
  - **Dos cancelaciones a la vez:** una sola cancela, y sale un solo juego de emails.
- **Cambiar el paciente principal desde el panel:**
  - el enlace viejo da 404, también en `/public/payments/:token`;
  - el `paymentToken` nuevo abre la página, sin confirmación.
- **«Por verificar» (spec 009):**
  - el enlace llega al correo escrito al reservar y funciona;
  - después de «unir a la ficha», el mismo enlace sigue funcionando y la confirmación se conserva,
    también la de otra persona de la sesión.
- **Límites:** 61 `GET` seguidos desde una IP dan 429, y lo mismo 21 `POST`.
- **ntfy:** con un ntfy falso, el cron arma «Agenda360: cita cancelada por el paciente»:
  - con «Cancelada por el paciente desde su email»;
  - con el paciente a medias;
  - sin el negocio en el título.

### Suites que se actualizan

| Suite | Qué cambia |
|---|---|
| `email-templates.test.mjs` | El enlace en los seis emails de cita activa y no en los otros tres. «Ver mi cita» con `canCancel: false`. El botón «Confirmo que voy» y su `?confirmar=1` en el recordatorio, y «Ya nos confirmaste…» si ya confirmó. La copia (`professionalCopy`) sin ningún `/cita/`. La nota «La canceló el paciente…». El bloque `link` en HTML y en texto. |
| `status-notices.test.ts` | El email de cancelación de un cambio de estado lleva su copia sin enlace. La cancelación desde «Tu cita» sale en ntfy como del paciente. |
| `booking-alert.test.ts` | `statusChangeNotice` con `byPatient`. |
| `reminders.test.ts` | El recordatorio de cada persona lleva su propio enlace. Con los ajustes de fábrica (24 h y 24 h) dice «Ver mi cita». Con antelación de 12 h, «Ver o cancelar mi cita». La copia del recordatorio no lleva enlaces. |
| `multi-client-appointments.test.ts`, `couple-booking.test.ts` | Cada persona recibe un enlace distinto, y sólo el principal tiene `payment`. |
| `booking-verify.test.ts` | `confirmClaim` conserva `access_token` y `confirmed_at`. |
| `payments.test.ts` | La página de pago sigue igual con el mismo token. |

## 2. Recorrido con Playwright (local, escritorio y 390 px)

**API, front y datos:**
- la API local en el 4180, con `FRONTEND_URL=http://localhost:5199`, para que los enlaces de los
  emails apunten a ese front;
- el front con Vite en el 5199, con `API_PROXY_TARGET=http://localhost:4180`;
- la demo, con «Permitir cancelaciones» y 24 h.

**Pasos:**
1. **Crear una cita para pasado mañana** desde el panel, a un paciente con email.
   - En Configuración → Notificaciones → Emails enviados, la confirmación lleva «Ver o cancelar mi
     cita: http://localhost:5199/cita/…».
   - Su copia al profesional no lo lleva.
2. **Abrir ese enlace a 390 px de ancho:**
   - se ven el servicio, la fecha, la hora, el profesional, la modalidad y el negocio, sin el nombre
     del paciente;
   - no hay desplazamiento horizontal.
3. **Abrir el mismo enlace con `?confirmar=1`:**
   - sale «¡Gracias! Te esperamos el …» y la dirección queda sin `?confirmar=1`;
   - al recargar, la página dice que ya estaba confirmada.
4. **En el panel:**
   - la cita lleva la marca en el bloque de la semana, en la lista del celular y en la ficha (con la
     hora);
   - si la cita es de hoy, también en «Lo que queda de hoy»;
   - el estado no cambió;
   - la actividad lo registra.
5. **Mover la cita a otra hora** arrastrándola: la marca desaparece y el email del cambio lleva otra
   vez el enlace.
6. **«Cancelar mi cita»:**
   - pide confirmarlo;
   - sale «Tu cita quedó cancelada» con «Elegir otra hora», que abre la página de reservas, donde esa
     hora está libre;
   - el panel la muestra Cancelada, y la actividad dice «Cancelada por el paciente desde su email».
7. **Una cita de mañana a primera hora** (a menos de 24 h): la página no tiene botón de cancelar y
   ofrece WhatsApp y llamar al negocio.
8. **Apagar «Permitir cancelaciones»:** el botón desaparece, y aparece el aviso de Configuración →
   Agenda cuando la antelación es igual o mayor que las horas del recordatorio.
9. **Una sesión en pareja** (negocio con el interruptor de varias personas): cada persona tiene su
   enlace.
   - Las dos pueden confirmar, y la ficha dice quién.
   - Sólo el principal ve «Cancelar mi cita» y «Pagar la cita».
10. **Un enlace inventado:** sale «Este enlace no está disponible».
11. **Lector de pantalla** (árbol de accesibilidad de Playwright):
    - el bloque dice «…, confirmó el paciente»;
    - el resultado de confirmar se anuncia.

## 3. Beta (puerto 3199)

1. `npm run build` y `npm run lint`.
2. **En la bandeja de emails simulada,** el enlace de «Tu cita» de un email de cita se puede abrir. En
   la página se confirma y se cancela como en el recorrido anterior.
3. **La agenda de la beta:**
   - muestra la marca en las citas demo ya confirmadas;
   - la quita al mover una cita.
