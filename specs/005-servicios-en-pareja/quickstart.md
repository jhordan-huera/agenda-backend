# Cómo comprobarlo en local: Servicios en pareja o familia y su reserva online

Todo en local (principio IV), con la base de demostración. Nunca en Vercel ni contra Supabase.

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

`tests/couple-booking.test.ts` (nueva) cubre lo siguiente. Los requisitos y las decisiones van
entre paréntesis.

**Servicio:**
- un servicio nuevo nace con 1 persona;
- con el interruptor se guarda 2 o 3;
- sin el interruptor se ignora lo que llegue;
- un `PUT` sin el campo conserva el valor;
- el perfil público manda el valor efectivo (RF-001, RF-002, D2).

**Reserva en pareja:**
- una persona existente y otra nueva: una sola cita `pending`, la existente sin duplicar y la nueva
  creada desde la página;
- las dos existentes, y las dos nuevas (RF-004, RF-006, CE-002).

**Datos de cada persona:**
- la cédula de un paciente con otro email y otro teléfono: 403 con el nombre escrito y sin ningún
  dato de la ficha;
- una cédula repetida: 400;
- con un servicio de 2 personas y sin `extraPatients`: 400, que pide recargar;
- un negocio sin habilitar: 400.

Ninguno de esos casos deja pacientes ni citas (RF-004, RF-005, CE-006).

**Límites:**
- otra persona que ya tiene una cita ese día, como principal o como otra paciente: 409 con su
  nombre (D6);
- el tope de pacientes nuevos cuenta a cada persona nueva;
- la sesión cuenta una vez en el tope de reservas (RF-009).

**Reintento:**
- la misma reserva, con las otras personas en otro orden, devuelve la misma confirmación sin crear
  nada (RF-010, D11).

**Emails:**
- cada persona recibe la solicitud con su saludo;
- la de la otra persona dice quién reservó y no lleva datos de pago;
- sale una sola copia al profesional (RF-007, RF-008).

**Pago en el panel:**
- una cita del panel con dos pacientes y con cuentas: sólo el principal recibe el bloque de pago
  (D9).

**Privacidad (D7):**
- un profesional con «sólo sus pacientes» reserva por la página con una identidad nueva y pone como
  segunda persona a un paciente que ya existe;
- él no ve la ficha ni la historia de ese paciente, sólo su nombre en la cita;
- cuando recepción confirma la cita, sí la ve.

**ntfy:**
- el aviso de la reserva tiene una línea por persona, con los datos a medias (RF-011).

**Tope de emails a pacientes nuevos:**
- cuenta los emails a las otras personas nuevas (D10).

Además, siguen pasando sin cambios:
- `booking-retry`, `booking-limits` y `public-abuse`;
- `client-required-fields`, `booking-alert` y `multi-client-appointments`.

## 2. Recorrido con Playwright (local)

API en un puerto libre contra la base demo local, Vite con `API_PROXY_TARGET` y el navegador
automático. Se revisa en escritorio y a 390 px (motor de Safari), sin desplazamiento horizontal.

1. **Super admin:** activa «Citas con varios pacientes» en la clínica demo.
2. **Panel → Servicios:** aparece «Personas por sesión». Se crea «Terapia de pareja» para 2
   personas. En un negocio sin habilitar, el campo no aparece.
3. **Página de reservas:**
   - la tarjeta dice «Para 2 personas»;
   - en «Tus datos» aparece el bloque de la otra persona;
   - se reserva con un paciente demo existente y una persona nueva;
   - la confirmación muestra a los dos;
   - la pantalla final nombra a los dos;
   - «Recordar mis datos» sólo guardó a quien reservó (se mira en `localStorage`).
4. **Errores en la página:**
   - la misma cédula dos veces: se ve el aviso;
   - la cédula de un paciente existente con otro teléfono: se ve el mensaje con su nombre y ningún
     dato de la ficha.
5. **Panel → Inicio y agenda:** la reserva pendiente sale con los dos nombres. Al confirmarla, el
   registro de emails tiene una confirmación por persona y una sola copia.
6. **Panel → nueva cita con «Terapia de pareja»:**
   - se abre solo el espacio «Paciente 2»;
   - si se deja vacío, aparece el aviso ámbar y se puede guardar.
7. **Interruptor apagado:** la página vuelve a pedir una sola persona y el servicio conserva su
   valor al encenderlo de nuevo.

## 3. Beta

```
cd ~/Documentos/Proyectos/Betas/agenda-beta
npm run build
npm run lint
```

Se repite el recorrido con Playwright en un puerto libre. Los puertos 3000, 4000 y 5173 son del
dueño del producto. La beta no envía emails: se miran en su bandeja simulada.
