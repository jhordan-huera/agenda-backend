# Etapa 8 — Vista general intermedia (EGM)

Revisor nuevo `egm-zoom-out` sobre [spec.md](../spec.md), con los informes de las etapas 5, 6 y 7. Fecha: 2026-11-16.

Comprobó los hallazgos en el código. Además de lo de la etapa 5, leyó:
- `notifications.ts` (`queueEmail`);
- la migración 022;
- `business-data-service.ts` y `account-service.ts`;
- `templates.ts`;
- en el front: la hoja, la Agenda, «Pacientes que no volvieron» y /privacidad.

## Conclusión

La función tiene el tamaño justo y reutiliza bien lo que ya existe:
- el control se calcula;
- la tabla guarda sólo lo que pasó;
- el envío copia el patrón de la encuesta;
- la hoja copia la de la lista de espera.

RF-009 sostiene el cupo de Gmail, y la spec debe decir ese porqué.

**Sólo dos cosas importan de verdad para que funcione bien:**
1. **Major — «Vencidos» sin tope.**
   - Propone el arreglo más simple: un límite de fecha hacia atrás en `findControls`. Acota la hoja, la cifra y el cron, y deja la ficha igual.
   - Sugiere 90 días, el umbral más largo de «Pacientes que no volvieron», que cubre lo más antiguo.
   - El orden aprobado («del más antiguo al más reciente») no se cambia sin el dueño.
2. **Major (pasa poco, se arregla con una línea) — Un control marcado como enviado sin email.**
   - Propone usar la clave `control:{cita del primer control}`, o no marcar si `queueEmail` devuelve falso.
   - Pide una prueba de dos pasadas el mismo día.

**Lo que no recomienda, porque complica de más:**
- **Un nivel nuevo del cupo o revisar todo antes de enviar:**
  - en el caso normal el email sale minutos después;
  - la encuesta tiene la misma propiedad y está publicada;
  - si algún día pasa, se arregla una vez en el mailer para todos.
  - Si el dueño quiere un seguro barato: el descarte por antigüedad de la encuesta, pero contradice una línea aprobada.
- **Que caduque el enlace de la baja:** tiene que seguir funcionando. Ya tiene límite de peticiones, `no-store` y el botón de confirmar.
- **Marcar el WhatsApp como enviado, deshacer «Quitar» o la baja:** no, para una función en prueba. Basta corregir la frase de la hoja que promete el email a todos.
- **Paginar u optimizar:** no hay cuello de botella. La ventana de 90 días ya acota la consulta.
- **Guardar el interruptor en una sola columna:** sigue el patrón de la encuesta y se mantiene al día en el mismo cambio.
- **Unificar los enlaces de reservar entre los repos:** son de una línea y siguen el patrón de la lista de espera.
- **Secciones completas de alternativas y de riesgos:** no son un bloqueante, porque las specs 046 a 050 no las tienen. Basta una línea por decisión.

**Decide el dueño:**
- el asunto sin el servicio;
- la frase en /privacidad;
- que la ficha muestre el control aunque haya una cita por delante.

**Sólo en el texto:**
- **Estado:** que está implementada y que, si hay que publicar antes, va la 058 primero y la función apagada.
- **Las frases que no coinciden con el código:**
  - la spec 020;
  - «en esa pasada»;
  - que no se descarta;
  - «se le envió el email»;
  - el botón de confirmar la baja;
  - los reinicios de «desde cuándo»;
  - la cita por delante mientras existe.
- **RF-003,** con la cifra del botón.
- **«Decisiones aprobadas».**
- **La frase de la hoja del front.**

El resto (enlaces, glosario, plantilla, CE-004) es forma y es opcional.
