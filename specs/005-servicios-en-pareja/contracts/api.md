# Contrato de la API: Servicios en pareja o familia y su reserva online

Todas las rutas conservan su forma. Cambian:
- un campo nuevo en el servicio;
- un campo nuevo en el cuerpo de la reserva pública;
- algunos mensajes de error;
- el contenido de algunos emails.

## Servicio

### Respuesta (panel: `GET /businesses/:businessId/services` y las demás que devuelven servicios)

```jsonc
{
  "id": "…",
  "peoplePerSession": 2,   // NUEVO: 1, 2 o 3 (el guardado, aunque el interruptor esté apagado)
  "…": "resto de campos sin cambios"
}
```

### `POST` y `PUT /businesses/:businessId/services[/:serviceId]`

El cuerpo es el de hoy más `peoplePerSession`, que es opcional.

| Caso | Resultado |
|---|---|
| Negocio habilitado y `peoplePerSession` de 1 a 3 | Se guarda |
| Negocio habilitado y no llega `peoplePerSession` | Crear: 1. Editar: se conserva el que tenía |
| Negocio sin habilitar | Se ignora lo que llegue. Crear: 1. Editar: se conserva el que tenía |
| Fuera de 1 a 3 | 400 `validation` |

### Perfil público (`GET /public/businesses/:slug`)

Cada servicio trae `peoplePerSession` con su **valor efectivo**: 1 si el negocio no tiene el
interruptor. El interruptor sigue sin salir en el perfil.

## Reserva pública: `POST /public/businesses/:slug/bookings`

### Cuerpo

```jsonc
{
  "serviceId": "…", "date": "2026-10-20", "startTime": "10:00",
  "documentId": "…", "name": "Ana Torres", "email": "…", "phone": "…",   // quien reserva (principal), como hoy
  "extraPatients": [                                                     // NUEVO, opcional, 0 a 2
    { "documentId": "…", "name": "Carlos Pérez", "email": "…", "phone": "…" }
  ],
  "notes": "", "homeVisit": null, "isVirtual": false, "professionalId": null, "captchaToken": "…"
}
```

### Respuesta

`BookingConfirmation`, sin cambios. La pantalla final toma los nombres de lo que escribió la
página.

### Errores nuevos o con texto nuevo

| Caso | Respuesta |
|---|---|
| Cédula repetida entre las personas | 400 `validation`: «Cada persona debe tener su propia cédula.» |
| Servicio de N personas con menos de N − 1 en `extraPatients` (p. ej. un front anterior) | 400 `validation`: «Este servicio es para {N} personas: faltan los datos de {la otra persona / las otras personas}. Recarga la página e inténtalo de nuevo.» |
| Más personas que las del servicio, o negocio sin habilitar con `extraPatients` no vacío | 400 `validation`: «Este servicio es para una persona.» (o «para {N} personas») |
| Cédula inválida de otra persona | 400 `validation`: el mensaje de hoy de `documentIdError`, con el nombre de la persona |
| La cédula de otra persona existe y no coinciden ni su email ni su teléfono | 403 `forbidden`: «No pudimos confirmar los datos de {nombre}. Revisa su email y su teléfono o escríbenos por WhatsApp.» |
| Otra persona ya alcanzó el límite de citas de ese día | 409 `daily_limit`: «{Nombre} ya tiene una cita ese día con {negocio}. Si necesitan otra, escríbanle al negocio o elijan otro día.» (con un límite mayor que 1: «ya tiene N citas») |
| Quien reserva: los mismos casos | Los mensajes de hoy, sin cambios |
| Topes del día, del plan, CAPTCHA, hora ocupada | Los mensajes de hoy, sin cambios. Si se rechaza, no se crea nada |

`{nombre}` es el nombre tal como lo escribió quien reserva. Nunca se muestra un dato de la ficha.

### Reintento

La misma reserva dentro de 30 minutos devuelve la confirmación de hoy (`repeated`). Es la misma si
coinciden:
- la cédula y el contacto de quien reserva;
- las cédulas de las otras personas, sin importar el orden;
- el servicio, la fecha, la hora y la modalidad.

## Emails

| Email | Quién lo recibe | Qué cambia |
|---|---|---|
| Solicitud recibida (`booking_created`), al reservar en pareja | Cada persona con su saludo | El de cada persona que no es la principal dice «{quien reservó} reservó para ti una cita en {negocio}» y no lleva datos de pago |
| Cualquier email al paciente (confirmación, cambio, restablecida, cancelación) | Cada paciente de la cita | Sólo el principal recibe los datos de pago y el enlace del comprobante. Vale también para las citas del panel |
| Copia al profesional | Una sola, con todos los nombres | Sin cambios: muestra lo que recibe el principal |
| Nueva reserva al negocio (`booking_received`) | Email del negocio | Nombra a todas las personas |
| Recordatorio | Cada paciente | Sin cambios |

## Aviso por ntfy (cron)

Una línea por persona, con el principal primero:
```
Paciente nuevo: Carlos P. · ca***@gmail.com · +593***4567
Ya era paciente: Ana T. · an***@gmail.com · +593***8901
```
Los demás datos son los de hoy.
