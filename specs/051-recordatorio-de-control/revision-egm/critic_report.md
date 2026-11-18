# Etapa 7 — Crítica (EGM)

Tres revisores nuevos sobre [spec.md](../spec.md), archivo completo, con la misma lectura de base que la etapa 5. Fecha: 2026-11-16.

| Revisor | Guía | Resultado |
|---|---|---|
| `egm-design` | `feature-spec-standard` | 1 Blocker, 5 Major, 6 Nit |
| `egm-structural` | `feature-spec-standard` | 1 Blocker, 4 Major, 8 Nit |
| `egm-style` | (su definición) | 9 Major, 17 Nit |

## Bloqueante (diseño y estructural)

**B1 — No hay alternativas evaluadas.** La guía pide las opciones descartadas con su razón, y la spec sólo trae lo elegido. Por ejemplo:
- «Volver en» por servicio o por paciente;
- mejorar «Pacientes que no volvieron» en lugar de una hoja nueva;
- calcular o guardar el control;
- un email o una secuencia;
- cualquier cita por delante o sólo una del mismo servicio;
- el nivel del cupo y si se descarta.

Las specs 046 a 050 tampoco tienen esta sección: es un patrón del proyecto.

## Mayores

**De diseño y comportamiento**
- **M1 — «Vencidos» sin límite ni paginación.** Diseño, estructural y estilo coinciden, igual que las etapas 5 y 6.
  - `findControls` sólo tiene tope hacia adelante.
  - La Agenda pide la lista completa para la cifra, y el cron la recorre cada 10 minutos.
- **M2 — Un control queda marcado como enviado sin que salga el email.** Lo encontraron los dos críticos de la etapa y el catalizador de la etapa 5.
  - En `runControlReminderJob`, `emailed_at` se guarda antes de `queueEmail`.
  - La clave `control:{paciente}:{día}` es única, así que un segundo control del mismo día se descarta en silencio.
- **M3 — La cola frente a la reserva.** Si el email espera en la cola y el paciente reserva, sale igual. No está reconocido como riesgo.
- **M4 — El nivel «paciente» del cupo y sin descarte.** Comparte cupo y orden con los emails urgentes de las citas. A diferencia de la encuesta y la lista de espera, no se descarta nunca. Hay riesgo de spam para la cuenta de los emails de las citas.
- **M5 — El asunto lleva el servicio.** «Te toca tu control de [servicio]» puede ser un dato de salud (psicología, fisioterapia) en la vista previa y en buzones compartidos. Los demás emails usan asuntos genéricos.
- **M6 — /privacidad sólo cubre los emails de la reserva.** Escribir meses después para que vuelva es otra finalidad; que lo decida el dueño.
- **M7 — Falta una sección de riesgos y mitigaciones.** Por ejemplo:
  - el token de la página pública no caduca;
  - el límite de peticiones y el botón de confirmar sólo están en el plan;
  - la escala del cálculo;
  - el cron caído.
- **M8 — No enlaza el plan,** donde está la arquitectura, y las specs 020, 047 y 048 se citan sin enlace.

**De texto y de lo que no coincide con el código**
- **M9 — «La cita Atendida no se corrige (spec 020)» es falso.**
  - El propietario la corrige, y el control pasa a la Atendida anterior o desaparece.
  - La fila ya escrita sigue atada a la cita corregida.
- **M10 — El Estado dice «Aprobada» y «Decisiones para aprobar» sigue en condicional.** Además, falta «Implementada».
- **M11 — Se afirman resultados que nadie mide** («sin que el consultorio tenga que acordarse», «recupera pacientes»). Lo que evita tener que acordarse es la cifra del botón, que sólo está en el plan.
- **M12 — «Escribir» tiene dos sentidos:** el WhatsApp a mano y el email automático. Conviene «se le envió el email» frente a «escribir por WhatsApp».
- **M13 — RF-010 dice «si sigue disponible».** Conviene la condición exacta: el profesional atiende el servicio, está activo y el negocio deja elegirlo.
- **M14 — «Dos controles del mismo día» es ambiguo.** El código y la constitución juntan todo lo de un paciente en cada pasada. Falta el asunto con varios servicios.
- **M15 — «Espera en la cola… como los demás»** no es cierto: la encuesta y la lista de espera sí se descartan.
- **M16 — La baja:** la página pide confirmar con un botón, pero la spec da a entender un clic.
- **M17 — CE-004 («menos de 30 segundos») no dice cómo se mide.**

## Menores (resumen)

**Lo que hace el código y la spec no dice**
- «Hace [tiempo]» usa el intervalo configurado, no el tiempo que pasó de verdad. Con el envío tardío se contradice con la fecha.
- Cambiar «Volver en» o apagar y encender el interruptor reinicia «desde cuándo».
- Reactivar un servicio o un paciente envía lo atrasado de hasta 30 días.
- Ser otra persona de una cita por delante también cuenta como «cita por delante».
- Los botones «Lista de espera» y «Controles» son condicionales.
- El asunto y los botones cambian con varios controles.

**Lo que falta en el panel**
- No hay forma de deshacer «Quitar» ni la baja.
- El panel no muestra quién pidió no recibir los emails.
- La hoja promete un email que no sale para quien se dio de baja, no tiene email o ya estaba vencido.

**Texto**
- Falta «Por qué esta prioridad» en la Historia 3.
- Los escenarios no siguen la plantilla Dado/Cuando/Entonces.
- Entidades no dice que el control se calcula ni nombra el token.
- CE-002 es una verificación técnica, y no hay un criterio que mida si el paciente vuelve.
- Hay redacción que mejorar:
  - «él» sin antecedente y «esta semana»;
  - «a una hora del negocio»;
  - «más el tiempo del servicio»;
  - «a quién llamar»;
  - «abre la cita nueva» (es el formulario);
  - asuntos que no coinciden;
  - redundancias.
- **Supuestos y Fuera de alcance:** hay supuestos que no lo son, «vendrán después» y «la factura del SRI» sobran, y la lista sin verbo.
- Un solo término para las citas con varias personas.

## Comprobado sin hallazgos

Los críticos de diseño y estructural confirmaron que el código cumple RF-001, RF-002, RF-005, RF-007, RF-008, RF-009 (con sus fechas), RF-010 (sin copia) y RF-011, además de:
- el borrado junto con el paciente;
- el permiso de la hoja y el del interruptor;
- que las pruebas cubren CE-001;
- la constitución 1.49.0 en los dos repos.
