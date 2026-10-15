# Contratos: El paciente confirma o cancela su cita desde el email

Lo que cambia en la API, en los emails, en los avisos y en las páginas del front. Lo que no está aquí
sigue igual.

## Rutas nuevas (sin sesión)

El token de la ruta es la autorización:
- **del paciente principal:** `payment_token`;
- **de cada otra persona de la sesión:** `appointment_clients.access_token`.

Son 32 caracteres hex.

### `GET /api/public/appointments/:token`

La cita de ese enlace, para la página «Tu cita».

- **Límite:** `mi-cita`, 60 en 15 min por conexión.
- **Cabecera:** `Cache-Control: private, no-store`.

**Respuesta 200:** `PublicAppointment`.

```ts
/** Página «Tu cita» (/cita/:token), sin sesión: el token es la autorización (spec 010). */
export interface PublicAppointment {
  business: Pick<PublicBusiness, "name" | "slug" | "logoUrl" | "phone" | "address" | "lat" | "lng" | "timezone" | "brandColors">;
  serviceName: string;
  professionalName: string;
  date: ISODate;
  startTime: TimeString;
  endTime: TimeString;
  /** En el local, virtual o a domicilio (sin la dirección de la visita ni el enlace de la videollamada). */
  place: ServiceMode;
  status: AppointmentStatus;
  /** Ya empezó o pasó, en la hora del negocio. */
  past: boolean;
  /** Cuándo confirmó que va quien abre el enlace; null: aún no. */
  confirmedAt: ISODateTime | null;
  /** Puede pulsar «Confirmo que voy»: la cita está pendiente o confirmada y aún no empieza. */
  canConfirm: boolean;
  cancellation: {
    /**
     * allowed: puede cancelar aquí · too_late: falta menos que la antelación · disabled: el negocio no
     * permite cancelaciones · not_main: es otra persona de la sesión · closed: cancelada, atendida,
     * no asistió o ya pasó.
     */
    status: "allowed" | "too_late" | "disabled" | "not_main" | "closed";
    /** La antelación del negocio, en horas («Para cancelar con menos de 24 h…»). */
    noticeHours: number;
    /** La política de cancelación del negocio ("" si no permite cancelaciones). */
    policy: string;
  };
  /** Quien abre es el principal y la cita tiene un pago por transferencia pendiente: la página lleva a /pago/:token. */
  payment: boolean;
}
```

**Lo que nunca va:**
- el nombre, el email, el teléfono ni la cédula de ningún paciente;
- las otras personas de la sesión;
- la dirección de la visita a domicilio;
- el enlace de la videollamada;
- el precio;
- las notas;
- la historia clínica.

**Errores:**

| Código | Cuándo |
|---|---|
| 404 `not_found` | «Este enlace no existe o ya no está disponible.». El mismo mensaje si el token no existe, si el negocio no está activo, si pasaron más de 30 días desde la cita o si la persona ya no está en ella. |
| 429 `rate_limited` | «Demasiadas solicitudes desde esta conexión. Espera unos minutos.» |

### `POST /api/public/appointments/:token/confirm`

«Confirmo que voy».

- **Cuerpo:** vacío.
- **Cabeceras:** `X-Requested-With`, como todo `POST` a la API.
- **Límite:** `mi-cita-acciones`, 20 en 15 min por conexión.

**Respuesta 200:** `PublicAppointmentResult`.

```ts
export interface PublicAppointmentResult {
  appointment: PublicAppointment;
  /** Ya estaba confirmada (o cancelada, en /cancel): no se hizo nada. */
  already: boolean;
}
```

- **La primera vez:** guarda la hora y registra `appointment.client_confirmed`.
- **Las siguientes:** `already: true`, sin cambiar la hora ni registrar nada.
- **Sin email y sin ntfy.**

**Errores:**

| Código | Cuándo |
|---|---|
| 404 `not_found` | Igual que en el `GET`. |
| 409 `conflict` | «Esta cita ya no está activa.» si está cancelada, atendida o marcada como No asistió. «Esta cita ya pasó.» si ya empezó. |
| 429 `rate_limited` | El límite. |

### `POST /api/public/appointments/:token/cancel`

«Cancelar mi cita».

- **Cuerpo:** vacío.
- **Cabeceras:** `X-Requested-With`.
- **Límite:** el mismo `mi-cita-acciones`.

**Respuesta 200:** `PublicAppointmentResult`, con `appointment.status = "cancelled"`.

- **La primera vez:**
  - la cita pasa a Cancelada y la hora queda libre;
  - sale el email de cancelación a cada persona, con copia al profesional (como un cambio de estado
    del panel, spec 008);
  - se registra `appointment.client_cancelled`;
  - el cron avisa por ntfy.
- **Si ya estaba cancelada:** `already: true`, sin repetir nada.

**Errores:**

| Código | Cuándo |
|---|---|
| 404 `not_found` | Igual que en el `GET`. |
| 409 `conflict` | Fuera de plazo: «Para cancelar con menos de 24 h, escríbele a {negocio}.». |
| 409 `conflict` | El negocio no permite cancelaciones: «{negocio} no permite cancelar desde aquí: escríbele para avisarle.». |
| 409 `conflict` | No es el principal: «Para no asistir, escríbele a {negocio}.». |
| 409 `conflict` | La cita ya pasó, se atendió o se marcó como No asistió: «Esta cita ya no está activa.». |
| 429 `rate_limited` | El límite. |

La regla es `canCancelOnline` (compartida) y se comprueba con la cita bloqueada, así que nunca se
cancela fuera de plazo (CE-002).

## Rutas que cambian

### `GET /api/businesses/:id/appointments`, `GET /api/businesses/:id/appointments/:appointmentId` y las respuestas de crear, editar y cambiar el estado

- **Cada `Appointment` gana `clientConfirmations`:** `{ clientId, confirmedAt }[]`, sólo con quienes
  confirmaron, el principal primero.
- **`PUT /api/businesses/:id/appointments/:appointmentId`** borra la confirmación si cambian la fecha,
  la hora o el profesional (lo hace la base).
- **Si cambia el paciente principal,** la respuesta trae un `paymentToken` nuevo.

### `PATCH /api/businesses/:id/appointments/:appointmentId/status`

- **Pasar a Cancelada** borra las confirmaciones (lo hace la base).

### `POST /api/businesses/:businessId/clients/:clientId/confirm-claim` (spec 009)

- **Sin cambios para quien la llama.** Por dentro, conserva el enlace y la confirmación de cada
  persona que mueve.

## Emails

**Enlaces:**
- **`{url}`:** `https://<app>/cita/<token de esa persona>`.
- **«Confirmo que voy»:** lleva además `?confirmar=1`.

**Qué va en cada email:**

| Email (plantilla) | Al paciente | En la copia al profesional |
|---|---|---|
| Solicitud de reserva (`bookingCreated`) | Enlace a «Tu cita» | Nada |
| Confirmación (`appointmentConfirmed`) | Enlace a «Tu cita» | Nada |
| Cambio de fecha, hora, profesional o lugar (`appointmentUpdated`) | Enlace a «Tu cita» | Nada |
| Restablecida (`appointmentRestored`) | Enlace a «Tu cita» | Nada |
| Vuelve a quedar pendiente (`appointmentPending`) | Enlace a «Tu cita» | Nada |
| Recordatorio (`appointmentReminder`) | Botón «Confirmo que voy» y el enlace. Si ya confirmó: «Ya nos confirmaste que vienes. ¡Gracias!» y el enlace. | Nada |
| Cancelación (`appointmentCancelled`) | Como hoy, sin enlace a «Tu cita» | Como hoy. Si la canceló el paciente, la nota dice: «La canceló el paciente desde su email.» |
| Gracias por tu visita, Te esperábamos | Como hoy | Como hoy |

**El enlace:**
- **Dónde va:** debajo del recuadro «Tu cita» y antes del pago y la política.
- **Cómo se ve:** es un enlace (bloque `link`), no un botón.
- **Qué dice:**
  - **«Ver o cancelar mi cita»:** si esa persona podrá cancelar cuando salga el email (es el principal,
    el negocio permite cancelaciones y aún está en plazo);
  - **«Ver mi cita»:** si no.

**En texto plano:** «Confirmo que voy: https://…/cita/…?confirmar=1» y «Ver o cancelar mi cita:
https://…/cita/…».

**Cada persona de una sesión recibe su propio enlace.** Los avisos al negocio (`bookingReceived`,
`paymentReceiptReceived`) y al profesional (`professionalNewAppointment`, `professionalDailyAgenda`)
no lo llevan nunca.

## Avisos por ntfy (cron)

**Cancelación desde «Tu cita»:**
- **Título:** «Agenda360: cita cancelada por el paciente».
- **Mensaje:**
  - `{negocio} · {fecha} {hora}`;
  - las personas a medias;
  - el servicio;
  - «De Confirmada a Cancelada»;
  - **«Cancelada por el paciente desde su email»,** en lugar de «Cambiado desde el panel…»;
  - los emails: «Al paciente → ma***@gmail.com» y «Copia al profesional → …».

**La confirmación no manda aviso.**

## Página «Tu cita» del front

- **Ruta:** `/cita/:token`, sin sesión. Con `?confirmar=1`, confirma al abrir y quita el parámetro
  de la dirección.
- **Arriba:** el logo y el nombre del negocio, y el título «Tu cita».
- **La tarjeta de la cita:** servicio, fecha larga, hora, profesional y modalidad. En el local, con la
  dirección y «Cómo llegar».

| Situación | Lo que muestra |
|---|---|
| Recién confirmada | «¡Gracias! Te esperamos el martes 20 de octubre a las 10:00.» |
| Ya estaba confirmada (`already`) | «Ya nos habías confirmado que vienes. Te esperamos el martes 20 de octubre a las 10:00.» |
| Activa, sin confirmar | Botón «Confirmo que voy». |
| Activa y confirmada antes | «Confirmaste que vas el 14 oct a las 18:20.» |
| Pendiente para el negocio | Además: «{negocio} aún debe confirmar la cita: te avisaremos por email.» |
| Se puede cancelar | La política del negocio y el botón «Cancelar mi cita». Pide confirmarlo: «¿Seguro que quieres cancelar tu cita del martes 20 de octubre a las 10:00?», con el texto «La hora quedará libre para otra persona.». Los botones dicen «Sí, cancelar mi cita» y «Volver». |
| Fuera de plazo | «Para cancelar con menos de 24 h, escríbele a {negocio}.», con «Escribir por WhatsApp» (mensaje ya escrito) y «Llamar». |
| El negocio no permite cancelaciones | «Si no puedes asistir, escríbele a {negocio}.», con WhatsApp y teléfono. Sin botón de cancelar. |
| Otra persona de la sesión | «Para no asistir, escríbele a {negocio}.», con WhatsApp y teléfono. |
| Recién cancelada | «Tu cita quedó cancelada. Te enviamos un email con la cancelación.», con el botón «Elegir otra hora» (`/book/:slug`). |
| Cancelada antes | «Esta cita fue cancelada.», con «Elegir otra hora». Sin botones sobre la cita. |
| Ya pasó, atendida o No asistió | «Esta cita ya pasó.», con «Reservar otra cita». Sin botones sobre la cita. |
| Con pago pendiente (sólo el principal) | Botón «Pagar la cita», que abre `/pago/:token`. |
| Enlace que no existe, caducado o de un negocio suspendido | «Este enlace no está disponible». Abajo: «Revisa que el enlace esté completo o escríbele al negocio.». Es lo mismo en los tres casos. |
| Sin conexión o error | `ErrorState` con «Reintentar». |

**Sin teléfono del negocio:** el contacto dice «comunícate con {negocio}», sin botones.

## Página de pago (`/pago/:token`)

- **Gana** el enlace «Ver o cancelar mi cita», que abre `/cita/:token`. El resto no cambia.

## Panel

| Dónde | Qué se ve |
|---|---|
| Bloque de la agenda (día y semana) | Icono `UserCheck`, y en el lector de pantalla «…, confirmó el paciente». |
| Lista del celular | Marca «Confirmó el paciente», o «Confirmaron todos» o «Confirmó 1 de 2» con varias personas. |
| Ficha de la cita | Arriba, «Confirmó el paciente · 14 oct, 18:20». Con varias personas, bajo cada una: «Confirmó que va el 14 oct a las 18:20» o «Aún no confirma». |
| Inicio: «Lo que queda de hoy» y «Tu siguiente cita» | Marca «Confirmó». |
| Configuración → Agenda | Los textos y el aviso de [research.md](../research.md#r11-configuración--agenda). |
| Actividad | El filtro «Reservas online» pasa a «Pacientes (página y emails)». |
