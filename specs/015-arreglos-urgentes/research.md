# Investigación: Arreglos urgentes de la plataforma

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-10-15

Decisiones R1–R7. La copia de los archivos y los términos (antes R4–R10) los aplazó el dueño al ver el plan: van en otra spec. Cada una dice qué se eligió, por qué y qué se descartó.

## R1. El tope de Gmail se aplica al enviar, no al poner en cola

- **Hoy:** `thirdPartyEmailHold` (`email-limits.ts`) mira el tope de 400 al **poner en cola**. Si se
  pasó, el email se guarda como `failed` y no sale nunca. Las copias y los avisos al negocio no se
  cuentan.
- **Decisión:**
  - **El cupo de la cuenta** se aplica en el **envío** (`claimBatch` de `mailer.ts`): cada lote mira los
    `sent` de las últimas 24 h frente a `EMAIL_DAILY_QUOTA` (500 por defecto, configurable).
  - **Lo que no cabe** no se descarta: se queda `queued` con `next_attempt_at` 30 minutos después, sin
    sumar un intento. Así «espera» hasta que la ventana de 24 h libera cupo.
  - **El tope de 400 al poner en cola desaparece,** porque lo reemplaza el cupo.
  - **Siguen como hoy, al poner en cola, los topes contra el abuso** (spec 009):
    - lo provocado por el público (`PUBLIC_EMAILS_PER_DAY`, 150);
    - 20 pacientes nuevos por negocio y día.

    Son defensas, no un cupo: está bien que fallen.
- **Por qué:** RF-001 a RF-003 y CE-002. La copia al profesional se retrasa pero nunca se descarta.
- **Descartado:** dejar el tope al poner en cola, subiéndolo a 500 y contando todo. Seguiría
  descartando emails en vez de esperar.

## R2. Tres niveles de prioridad por tipo de email

| Nivel | Tipos | Cupo que pueden usar |
|---|---|---|
| **Equipo** (siempre) | `password_reset`, `team_invite`, `account_security_changed`, `platform_admin_added`, `business_suspended`, `business_reactivated`, `plan_change_*`, `plan_changed`, `business_created` | Todo el cupo |
| **Paciente** | `welcome`, `booking_created`, `appointment_confirmed`, `appointment_updated`, `appointment_cancelled`, `appointment_reminder`, `appointment_pending`, `appointment_completed`, `appointment_no_show`, `appointment_series`, `appointment_series_cancelled` | El cupo menos la reserva del equipo (20) |
| **Negocio** | `appointment_copy`, `booking_received`, `professional_new_appointment`, `professional_daily_agenda`, `payment_receipt_received`, `patient_cancelled` | El cupo menos la reserva del paciente (100) |

- **Las reservas** se configuran: `EMAIL_TEAM_RESERVE` = 20 y `EMAIL_PATIENT_RESERVE` = 100.
  Además, en cada lote se toman primero los del equipo, después los del paciente y al final los del
  negocio (y, dentro de cada nivel, los más antiguos).
- **La tabla vive en un solo sitio** (`EMAIL_PRIORITY`, en `email-limits.ts`). Una prueba exige que
  cada `EmailType` tenga su nivel: un tipo nuevo no se olvida.
- **Por qué:** «primero lo del paciente» (decisión 1). La reserva de 100 deja sitio a los recordatorios
  de la noche aunque por la tarde haya habido muchas copias.

## R3. Recordatorios que ya no llegan a tiempo, Salud y ntfy

- **Recordatorios tardíos:** un recordatorio cuya cita ya empezó se descarta («La cita ya pasó»). Se
  hace en el mismo sitio donde hoy se descarta un recordatorio que ya no es de la fecha actual de la
  cita (`reminderCurrent`).
- **Salud:** `getStats` devuelve `emailQuota: { quota, sent24h, waiting: { patient, business } }`.
  - Se pinta en ámbar desde el 80 % del cupo.
  - En rojo al llegar al cupo del paciente (el cupo menos 20).
- **ntfy:** «Agenda360: se llegó al cupo de Gmail», una vez al día y sólo con cifras (`alertOnce`, que
  ya existe).

## R4. La política de privacidad dice la verdad

- **Decisión:**
  - **La copia de la base:** «una copia de seguridad semanal» (antes, «diaria»).
  - **La portabilidad:** la solicitud se atiende escribiendo a soporte, en el plazo de la ley, sin
    prometer una descarga automática que no existe.
  - **El borrado definitivo:** se aclara que las copias de seguridad de la base (por email) guardan
    los datos hasta que se borran.
  - **Los avisos de cambios:** se avisará en el panel, en vez del email masivo que hoy no existe.
  - **No se mencionan unos «términos del servicio»** que no existen, ni en la política ni en el
    registro («Al crear tu cuenta aceptas la política de privacidad»).

  El reporte lista cada frase cambiada.

## R5. Los datos del super admin

- **«En Pro desde el…»:** columna nueva `subscriptions.plan_since`.
  - Se rellena con `current_period_end - 30 días`, que es justo la hora del último cambio de plan, o
    con la fecha del alta.
  - Al cambiar de plan se pone `now()`.
  - La ficha deja de mostrar «Renueva el…». `current_period_end` se queda en la base para el cobro de
    otra spec.
- **«Cerca del límite»:** cuenta los pacientes con la misma regla que `plan-limits.ts`, una sola
  función.
- **El reparto por plan del Inicio:** sólo cuenta los negocios activos, como «N negocios activos».

## R6. Documentación

Se corrigen en los dos README:
- Configuración → Suscripción;
- MRR e ingresos;
- las imágenes, que ya van al bucket;
- el formato por servicio;
- quién cambia los colores;
- el comentario de `ClinicalProfile` sobre el super admin.

## R7. Beta

- **Decisión:** la política corregida y el texto del registro, copiados del front. El tope de Gmail no
  aplica: la beta no envía emails reales.
