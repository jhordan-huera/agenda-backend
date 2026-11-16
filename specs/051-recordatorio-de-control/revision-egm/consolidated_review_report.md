# Revisión consolidada de la spec 051 (Elephant-Goldfish Model)

**Fecha:** 2026-11-16.

**Pedido del dueño del producto:**
- «instala este modelo para desarrollar»;
- «si esta probado y funciona bien aprueba nomas el 051».

**Resultado:** la función está bien planteada y estaba probada. La revisión encontró dos fallas reales, que ya se
corrigieron con sus pruebas. Con eso, la spec 051 queda **aprobada**, y sigue sólo en `dev` hasta que el dueño pida
publicarla.

## Cómo se hizo

Se siguió el modo «reporte consolidado» de `egm-review`, con una ronda por etapa.
- **Los revisores («peces dorados»):** nuevos, sin la conversación.
- **La resolución:** la hizo la sesión que conoce el proyecto (el «elefante»).
- **La etapa 9 (si está lista para implementar) no aplica:** la spec no tiene un plan dentro y la función ya está implementada.

| Etapa | Revisores | Informe |
|---|---|---|
| 5. Vista general | arquitecto escéptico y catalizador | [zoom_out_report.md](zoom_out_report.md) |
| 6. Comprensión | lector nuevo, sólo el documento | [comprehension_report.md](comprehension_report.md) |
| 7. Crítica | diseño, estructural y estilo | [critic_report.md](critic_report.md) |
| 8. Vista general intermedia | arquitecto escéptico, con los informes anteriores | [intermediate_zoom_out_report.md](intermediate_zoom_out_report.md) |
| Resolución | el elefante | [goldfish_review_report.md](goldfish_review_report.md) |

## Lo que se corrigió en el código

| # | Prioridad | Qué | Dónde | Prueba |
|---|---|---|---|---|
| 1 | 🔴 | Un segundo control del mismo paciente, aparecido en otra pasada del mismo día, quedaba marcado como enviado sin email. La clave era `control:{paciente}:{día}` y se descartaba en silencio | `src/services/control-reminders.ts`: la clave es la cita del primer control | `tests/control-reminders.test.ts`: dos pasadas el mismo día. Falla con la clave anterior y pasa con la nueva |
| 2 | 🟡 | La lista «Vencidos» no tenía límite: la hoja y la cifra «Controles (N)» sólo crecían | `findControls` con `dueFrom`; la hoja, los últimos 90 días (`CONTROL_LIST_DAYS_BEHIND`, compartida); el cron usa el mismo límite | Vencido hace 100 días: no sale en la hoja y sí en la ficha |
| 3 | 🟢 | La hoja prometía el email a todos | `control-reminders-sheet.tsx` (front) | `check:control-reminders` |

## Lo que se corrigió en la spec

Ahora la spec dice lo que hace el código:
- la corrección de una cita Atendida;
- un email por pasada;
- que no se descarta;
- «se le envió el email»;
- el botón de confirmar la baja;
- los reinicios de «desde cuándo» y por qué existen (el cupo);
- la cita por delante mientras existe;
- la cifra del botón;
- el control que se calcula.

Además:
- el Estado y «Decisiones aprobadas» están al día;
- los enlaces al plan, al reporte y a la spec 020;
- la sección «Revisión del EGM».

## Lo que decide el dueño (no se aplicó)

1. Descartar el email si espera demasiado en la cola, como la encuesta.
2. El asunto sin el servicio: «Te toca volver a [negocio]».
3. Que la ficha muestre el control aunque haya una cita por delante.
4. Una frase en /privacidad sobre estos emails.
5. «Hace [tiempo]» con el tiempo real, o sin esa frase.

## Matriz de trazabilidad

| Hallazgo original | Etapa · revisor | Acción |
|---|---|---|
| Vencidos sin límite | 5 · zoom-out M1, catalizador M1 · 6 · N13 · 7 · diseño M2, estructural (menor), estilo N15 · 8 · M1 | Código #2 |
| Clave del email | 5 · catalizador N5 · 7 · diseño N8, estructural M5 · 8 · M2 | Código #1 |
| Promesa de la hoja | 7 · diseño N10 · 8 · N4 | Código #3 |
| Spec 020 | 5 · zoom-out N3, catalizador N6 · 6 · M5 · 7 · los tres · 8 · N8 | Texto |
| Email en la cola / cupo | 5 · catalizador M2 y M3 · 7 · diseño M3, estructural M2 · 8 · N3 | Opción del dueño (1) o rechazado (nivel nuevo) |
| Asunto y privacidad | 7 · diseño M4 y M5 · 8 · N5 | Opciones del dueño (2 y 4) |
| Ficha con cita por delante | 5 · zoom-out N5 · 8 · N6 | Opción del dueño (3) |
| «Sólo en dev» no aísla | 5 · zoom-out M2 · 8 · M7 | Texto (Estado) |
| Sin alternativas ni riesgos | 7 · diseño B1, estructural B1 y M2 | Rechazado en la 051; aplicado desde la 052 |
| Términos, enlaces y forma | 6 · N6 a N15 · 7 · estilo | Texto en parte |

## Comprobación después de los cambios

Los resultados están en el [reporte](../reporte.md), en «Revisión del EGM».
