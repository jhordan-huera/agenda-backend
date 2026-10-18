# Reporte final: «Hecho con Agenda360» en las páginas de los pacientes

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Publicada (2026-10-18, PR backend #47 y front #35) · **Fecha**: 2026-10-18

**Repos**: agenda-front y la beta · **Migración**: No

## Resumen

Las páginas de reservas, pago y cita dicen al final «Agenda online con **Agenda360** · ¿Eres
profesional? Crea tu agenda». Ningún negocio puede ocultarlo, y el enlace abre la portada en otra
pestaña.

Con el registro público cerrado, los botones de la portada (del menú, el titular, el cierre y el pie) y
`/register` dicen «Quiero mi agenda». Abren un WhatsApp al dueño con el mensaje ya escrito: «Hola, vi la
página de reservas de <negocio> y quiero mi agenda en Agenda360». Si no hay teléfono de soporte, se
abre un email. Ya ningún botón lleva a «El registro está cerrado».

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El pie en las tres páginas, siempre | Cumple | Recorrido: pasos de la reserva, «¡Cita reservada!», pago, «Tu cita», un negocio inexistente y uno suspendido |
| RF-002 – Abre la portada en otra pestaña, con el negocio | Cumple | Recorrido: `/?desde=jhordan` en otra pestaña |
| RF-003 – Registro cerrado: WhatsApp o email con el negocio | Cumple | Recorrido: los cuatro botones y `/register`; sin teléfono, el `mailto:` |
| RF-004 – Registro abierto: «Crear mi agenda» | Cumple | Recorrido |
| RF-005 – Dos modos, 390 px y la beta | Cumple | 16 de 16 en Chromium oscuro y en WebKit a 390 px, claro y oscuro; build y lint de la beta |
| CE-001 a CE-003 | Cumple | Las de arriba |

**Pruebas:**
- **Front:** `npm run build`, `npm run lint` y `npm run check:contrast` sin errores.
- **Recorrido funcional,** con Chromium a 1440 px en claro: 53 de 53, junto con los de la spec 023.

## Cambios respecto al plan

- **El pie de la portada** («Crear cuenta») también cambió, para cumplir el CE-002.
- **El pie nuevo reemplaza** el «Reservas gestionadas con Agenda360» que ya había.
- **El pie también aparece** en la pantalla de error de pago y de «Tu cita».
- **El email de soporte** lleva el asunto «Quiero mi agenda en Agenda360».
- **A 390 px,** «Crea tu agenda» pasa de línea entero.
- **La función** queda en `useSignupContact` (`features/landing/`), que la spec 023 reutiliza.
- **La beta** trae un teléfono de ejemplo, `099 123 4567`. Su registro viene abierto, así que
  «Quiero mi agenda» sólo sale si se cierra en su /admin.

## Pendientes y riesgos

- **Hace falta tu teléfono** en /admin → Configuración → Teléfono de soporte. Hoy está vacío, y sin él
  se abre un email.
- **Sin comprobar** que WhatsApp y el correo se abran de verdad: se comprobaron los enlaces.
- **La configuración pública** se guarda en caché hasta 1 minuto: un cambio del teléfono puede tardar
  ese tiempo en verse.

## Commits

En el mismo commit de la spec 023: «Specs 022 y 023: «Hecho con Agenda360» y el programa de referidos
(front)». El reporte va en el del backend.

## Cómo publicarlo

Va junto con la spec 023. Ver su [reporte](../023-programa-de-referidos/reporte.md).
