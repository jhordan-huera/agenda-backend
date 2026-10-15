# Plan de implementación: Arreglos urgentes de la plataforma

**Rama**: `dev` · **Fecha**: 2026-10-15 · **Spec**: [spec.md](./spec.md)

**Documentos**: [research.md](./research.md) (decisiones R1–R7) · [data-model.md](./data-model.md) ·
[contracts/api.md](./contracts/api.md) · [quickstart.md](./quickstart.md)

## Resumen

El alcance quedó así el 2026-10-15: el dueño aplazó la copia de los archivos clínicos y los términos
con el contrato de encargo, que van en otra spec.

**1. El tope de Gmail** (R1–R3):
- **El cupo de la cuenta** (500 por defecto, configurable) se mira **al enviar**.
- **Tres niveles:**
  - el **equipo** (contraseñas, seguridad, planes), siempre;
  - el **paciente**, hasta el cupo menos 20;
  - el **negocio** (copias al profesional y avisos), hasta el cupo menos 100.
- **Lo que no cabe espera en la cola,** sin perderse ni gastar intentos.
- **Desaparece el tope de 400 que descartaba emails.** Siguen las defensas de la spec 009.
- **Un recordatorio de una cita que ya empezó** no se envía.
- **En Salud:** el cupo y los que esperan, en colores. ntfy avisa una vez al día.

**2. La política de privacidad** dice «semanal» y no promete lo que no existe. El registro deja de
mencionar unos términos que no existen (R4).

**3. El super admin:** «En Pro desde el…», «Cerca del límite» bien contado y el reparto por plan sólo
con los activos (R5).

**4. Los README** al día (R6). **La beta:** la política y el registro (R7).

**Migración 042:** sólo `subscriptions.plan_since`.

**Constitución 1.12.0 (MENOR)**, en los dos repos:
- **Principio III**, en la línea de la copia al profesional:
  > La copia puede esperar en la cola si un día no hay cupo de Gmail, pero nunca se descarta.
- **Restricciones:**
  > El envío respeta el cupo diario de la cuenta de Gmail con tres niveles de prioridad (equipo,
  > paciente, negocio).

## Contexto técnico

- **Lenguaje:** TypeScript.
- **Dependencias:** ninguna nueva.
- **Variables:** sólo las opcionales del cupo.
- **Pruebas:** la suite nueva `email-quota` y las que se actualizan.
- **Restricciones:** la migración 042 va antes del backend; los registros públicos, sin datos.

## Comprobación contra la constitución (1.11.0 → 1.12.0)

| Principio | Cumple | Cómo |
|---|---|---|
| I. Español | Sí | Los textos, los mensajes y los documentos, en español. |
| II. Privacidad | Sí | ntfy y los registros sólo llevan cifras. |
| III. Decisiones | Sí, con una aclaración | La copia al profesional puede **esperar**, pero no se descarta (1.12.0). |
| IV. Local | Sí | Todo en local. |
| V. Compartido | Sí | Los tipos nuevos se editan en el front y se copian con `sync:shared`. |
| VI. Barato | Sí | Sin dependencias ni servicios nuevos. |
| VII. Diseño | Sí | Salud y la ficha, con los tokens de hoy, a 390 px. |
| Restricciones | Sí | La migración 042 va antes del backend. |

## Cambios respecto a la spec

1. **Desaparece el tope de 400 a terceros:** lo reemplaza el cupo de la cuenta, que espera en vez de
   descartar. Las defensas de la spec 009 no cambian.
2. **El registro** deja de mencionar los términos hasta que existan.

## Estructura

```text
agenda-backend
  .specify/memory/constitution.md         1.12.0
  db/migrations/042_plan_since.sql         NUEVO
  src/config.ts                            EMAIL_DAILY_QUOTA, EMAIL_TEAM_RESERVE, EMAIL_PATIENT_RESERVE
  src/services/email-limits.ts             EMAIL_PRIORITY; quita el tope de 400; deja las defensas de la spec 009
  src/services/mailer.ts                   claimBatch por niveles con el cupo; esperar sin sumar el intento;
                                           descartar el recordatorio de una cita que ya empezó; aviso al llegar al cupo
  src/services/notifications.ts            queueEmail sin el tope de 400
  src/services/admin-service.ts            planSince, emailQuota, nearLimit y el reparto por plan
  src/services/subscriptions.ts, business-factory.ts   plan_since
  tests/email-quota.test.ts                NUEVO
  tests/…                                  las que miraban el tope de 400 y las del admin
  README.md                                el cupo y las correcciones de R6

agenda-front
  .specify/memory/constitution.md         1.12.0
  src/pages/privacy-page.tsx               los textos de R4
  src/features/auth/register-form.tsx      sin los términos
  admin-overview, admin-business-detail    el cupo de emails y «En Pro desde…»
  types/index.ts                           los campos nuevos
  README.md                                las correcciones de R6

agenda-beta
  la política y el registro
```

## Publicación

1. **La migración 042,** como paso aparte, antes del PR del backend:

   ```
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.**
3. **No hay variables obligatorias nuevas.** El cupo usa 500 si no se pone nada.
4. **Después:** `/api/health` `"ok":true` y, en Salud de /admin, el cupo de emails.

## Riesgos

- **El cupo de Gmail es una estimación.** Si Gmail corta antes, los emails esperan y se reintentan,
  como hoy.
- **Copias que llegan al día siguiente:** en un día con muchísimos emails, la copia al profesional
  puede llegar tarde. Es lo que decidió el dueño: primero el paciente.

## Decisiones del dueño del producto (2026-10-15)

1. **Tope de Gmail:** primero lo del paciente. Las copias y los avisos esperan; las contraseñas y la
   seguridad, siempre.
2. **La política:** corregir a «semanal», sin cambiar la copia de la base.
3. **Aplazados al ver el plan:** la copia de los archivos y los términos con el contrato de encargo.

## Preguntas para el dueño del producto

Ninguna: las decisiones cubren el diseño.
