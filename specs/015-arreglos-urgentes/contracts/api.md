# Contratos: Arreglos urgentes de la plataforma

Lo que cambia en la API y en las páginas. Lo que no está aquí sigue igual.

## Salud del super admin (`GET /api/admin/stats`)

Suma `emailQuota: { quota, sent24h, patientLimit, waiting: { patient, business } }`.

Cambia:
- `nearLimit` cuenta los pacientes como `plan-limits.ts`;
- el reparto por plan, sólo los activos.

## Ficha del negocio (`GET /api/admin/businesses/:id`)

Suma `planSince`. La pantalla deja de mostrar `currentPeriodEnd` («Renueva el…»).

## Envío de emails

Ninguna ruta cambia. Cambia **cuándo** sale cada email (R1–R3):
- `queueEmail` ya no marca `failed` por el tope de 400;
- el envío respeta el cupo por niveles.

Variables, opcionales en Vercel, Lambda y GitHub:
- `EMAIL_DAILY_QUOTA` (500);
- `EMAIL_TEAM_RESERVE` (20);
- `EMAIL_PATIENT_RESERVE` (100).

## ntfy

«Agenda360: se llegó al cupo de Gmail», una vez al día, con cifras.

## Páginas

- `/privacidad`: los textos de R4.
- El registro: «Al crear tu cuenta aceptas la política de privacidad», sin los términos.
