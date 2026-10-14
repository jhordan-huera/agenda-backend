# Contrato de la API: Aviso al paciente en cada cambio de estado de su cita

## `PATCH /businesses/:businessId/appointments/:appointmentId/status`

Gana `notify`, que es opcional y vale `true` por defecto. Las versiones anteriores del panel siguen
funcionando igual.

```jsonc
{ "status": "pending", "notify": true }    // con los interruptores encendidos, avisa al paciente
{ "status": "completed", "notify": false } // corrige un error: no sale ningún email
```

- **Respuesta:** la cita, igual que hoy.
- **Con `notify: false`:** no sale ningún email al paciente ni copia al profesional, y la actividad
  dice «(sin avisar al paciente)».
- **`notify` que no es sí o no:** 400 `validation_error`.

## Configuración de notificaciones (`PATCH /businesses/:id`, `notificationSettings`)

Gana `followUps` (sí o no). Si no se envía, vale `true`.

```jsonc
"notificationSettings": { "confirmations": true, "reminders": true, "cancellations": true,
  "reminderHoursBefore": 24, "whatsappOnStatusChange": true, "whatsappFollowUps": true,
  "followUps": true }
```

## Tipos de email nuevos (bandeja de emails)

| Tipo | Cuándo |
|---|---|
| `appointment_pending` | La cita pasa a Pendiente desde Confirmada, Atendida o No asistió |
| `appointment_completed` | La cita pasa a Atendida (de hace 7 días o menos) |
| `appointment_no_show` | La cita pasa a No asistió (de hace 7 días o menos) |

Cada uno sale con su copia al profesional (`appointment_copy`), como los de hoy.

## Aviso por ntfy (lo manda el cron, no la API)

Uno por cada cambio de estado, con hasta 10 por pasada:

```
Agenda360: cita cancelada
<negocio> · mar 20 oct 10:00
Paciente: An* Pé*** · an***@gmail.com · 099•••4567
Consulta · 30 min · $25,00
De Confirmada a Cancelada
Por Elena Suárez (Recepción)

Emails:
• Cancelación → an***@gmail.com (enviado)
• Copia al profesional → va***@demo.com (enviado)
```

## Aviso de WhatsApp (`POST …/appointments/:id/whatsapp-notice`)

El tipo de aviso acepta `"unconfirmed"`: la cita pasó a Pendiente desde un estado que no era
Cancelada.
