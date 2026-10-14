# Lista de calidad de la especificación: Sesiones con varios pacientes

**Propósito**: comprobar que la spec está completa antes de pasar al plan

**Creada**: 2026-10-13

**Función**: [spec.md](../spec.md)

## Calidad del contenido

- [x] Sin detalles de implementación (lenguajes, frameworks, APIs)
- [x] Centrada en el valor para el usuario y el negocio
- [x] Escrita para alguien sin conocimientos técnicos
- [x] Todas las secciones obligatorias completas

## Requisitos completos

- [x] No quedan marcas de [NEEDS CLARIFICATION]
- [x] Los requisitos se pueden probar y no son ambiguos
- [x] Los criterios de éxito se pueden medir
- [x] Los criterios de éxito no dependen de la tecnología
- [x] Todos los escenarios de aceptación están definidos
- [x] Los casos límite están identificados
- [x] El alcance está acotado (fase 1, sólo panel; la reserva online queda para la fase 2)
- [x] Las dependencias y los supuestos están identificados

## Lista para el plan

- [x] Cada requisito funcional tiene criterios de aceptación claros
- [x] Los escenarios cubren los flujos principales
- [x] La función cumple los resultados medibles de los criterios de éxito
- [x] No se filtran detalles de implementación en la spec

## Notas

- Decisiones del dueño del producto (2026-10-13): máximo 3 pacientes por cita y sólo en los negocios
  que el super admin habilite (interruptor en la ficha del negocio, apagado por defecto).
- Decisiones tomadas sin preguntar, porque tienen un valor razonable (en «Supuestos»):
  - estado, asistencia y precio por sesión;
  - un solo email si dos pacientes comparten correo;
  - aviso de cancelación al quitar a un paciente.
- Cotejada con las decisiones vigentes de la constitución:
  - cédula única por paciente;
  - copia al profesional de cada email al paciente, que sale una sola vez;
  - la historia clínica es individual;
  - la reserva online no cambia.
