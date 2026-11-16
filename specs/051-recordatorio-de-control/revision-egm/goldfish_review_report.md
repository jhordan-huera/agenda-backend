# Resolución de los hallazgos (EGM, el «elefante»)

La resolución la hizo la sesión que conoce el proyecto (el «elefante»), el 2026-11-16, con la autorización del dueño
del producto: «si esta probado y funciona bien aprueba nomas el 051».

**Cómo se clasificó cada hallazgo:**
- **CORREGIDO:** el cambio ya está aplicado.
- **TEXTO:** sólo se corrigió la spec.
- **OPCIÓN DEL DUEÑO:** queda para que él decida y no se aplicó.
- **RECHAZADO:** no se hace, con la razón al lado.

| Hallazgo | Etapas | Decisión | Qué se hizo |
|---|---|---|---|
| Un control queda marcado como enviado sin email (clave «paciente y día») | 5, 7, 8 | **CORREGIDO** | `dedupeKey` = `control:{cita del primer control}`. Prueba nueva de dos pasadas el mismo día: falla con la clave anterior y pasa con la nueva |
| «Vencidos» sin límite | 5, 6, 7, 8 | **CORREGIDO** | `findControls` con `dueFrom`: la hoja muestra los vencidos de los últimos 90 días (`CONTROL_LIST_DAYS_BEHIND`); el cron usa el mismo límite en lugar del filtro en memoria; la ficha, todos. Prueba nueva. El orden aprobado no cambia |
| La hoja promete el email a todos | 7, 8 | **CORREGIDO** | «A quien tiene email y no pidió dejar de recibirlos, le escribimos el día que le toca». El grupo se llama «Vencidos en los últimos 90 días» |
| «La cita Atendida no se corrige» es falso | 5, 6, 7, 8 | **TEXTO** | Se recalcula con la Atendida anterior o desaparece |
| «Dos controles del mismo día» ambiguo | 5, 6, 7, 8 | **TEXTO** | Un email por paciente en cada pasada; uno que aparece después, en su propio email |
| «Como los demás emails» (no se descarta) | 7, 8 | **TEXTO** | Dice que, a diferencia de la encuesta y la lista de espera, no se descarta |
| «Escribir» con dos sentidos | 6, 7, 8 | **TEXTO** | «Se le envió el email»; el WhatsApp es a mano y no se marca |
| La baja con un clic | 7, 8 | **TEXTO** | Página con un botón de confirmar |
| «Desde cuándo»: cambiar el plazo o volver a encender | 5, 6, 7, 8 | **TEXTO** | También reinician; reactivar no; RF-009 dice por qué (el cupo de Gmail) |
| La cita por delante, ¿para siempre? | 6, 8 | **TEXTO** | Mientras exista; si pasa o se cancela, el control vuelve |
| La cifra del botón no está en la spec | 5, 7, 8 | **TEXTO** | RF-003 incluye «Controles (N)» |
| Estado y «Decisiones para aprobar» | 5, 6, 7, 8 | **TEXTO** | Implementada y aprobada tras la revisión; «Decisiones aprobadas»; si hay que publicar antes, la 058 primero y la función apagada |
| Entidades no dice que el control se calcula | 7 | **TEXTO** | Se calcula; se guarda el envío, «Quitar» y el token |
| El email que espera en la cola sale aunque reserve o pida no recibirlos | 5, 7 | **OPCIÓN DEL DUEÑO** | La etapa 8 lo ve innecesario: en el caso normal sale en minutos, la encuesta tiene la misma propiedad y está publicada. El seguro barato (descartarlo por antigüedad, como la encuesta) cambia una línea aprobada |
| Nivel del cupo de Gmail | 5, 7 | **RECHAZADO** | Sin datos de que se llene el cupo; si pasa, se arregla en el mailer para todos los emails que pueden esperar (etapa 8) |
| El asunto lleva el servicio | 7, 8 | **OPCIÓN DEL DUEÑO** | Cambia un texto aprobado; la regla de privacidad de la spec lo permite |
| /privacidad no nombra estos emails | 7, 8 | **OPCIÓN DEL DUEÑO** | Una frase en esa página |
| La ficha esconde el control con una cita por delante | 5, 8 | **OPCIÓN DEL DUEÑO** | La constitución dice que quien tiene una cita por delante no tiene control |
| Que caduque el token de la baja | 7 | **RECHAZADO** | Un enlace para no recibir más tiene que seguir funcionando; ya tiene límite de peticiones, `no-store` y botón |
| Marcar el WhatsApp, deshacer «Quitar» o la baja, mostrar la baja | 6, 7 | **RECHAZADO** | No hace falta para una función en prueba (la lista de espera tampoco lo hace) |
| Paginar u optimizar la consulta | 7 | **RECHAZADO** | Sin cuello de botella; la ventana de 90 días ya acota |
| Unificar los enlaces de reservar entre repos | 5 | **RECHAZADO** | Una línea en cada repo, mismo patrón que la lista de espera |
| Interruptor guardado en dos lugares | 5 | **RECHAZADO** | Patrón de la encuesta; se mantienen juntos en el mismo cambio |
| Sin alternativas ni riesgos (Blocker de la guía) | 7 | **RECHAZADO** para la 051 | No es un bloqueante del proyecto (046 a 050 no las tienen) y la spec ya está implementada. Sí se aplica desde la spec 052 |
| «Hace [tiempo]» usa el intervalo y no lo transcurrido | 7 | **OPCIÓN DEL DUEÑO** | Con el envío tardío se contradice con la fecha; se puede calcular lo real o quitar «Hace» |
| El resto de la forma (enlaces, glosario, plantilla, CE medibles, «él», SRI) | 6, 7 | **TEXTO en parte** | Enlaces al plan, al reporte y a la spec 020; sin «él»; lo demás queda como está |

**Convergencia:** se hizo una ronda por etapa, en modo «reporte consolidado», sin repetir las rondas hasta dos limpias.
Después de los cambios no quedan hallazgos Blocker ni Major abiertos que no estén corregidos, decididos o en manos del
dueño.
