# Reporte final: Una portada más profesional

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-21

**Repos**: agenda-front y la beta (el backend sólo lleva la documentación) · **Migración**: No

## Resumen

**La portada** se rehízo con un solo acento, el azul de la marca, y sin degradados. Lleva:
- el titular en tinta sólida;
- el paciente que elige su hora desde WhatsApp y la cita que llega a «Tu día»;
- para quién es, cómo funciona y lo que distingue a Agenda360;
- las preguntas frecuentes, sin precios.

**El acceso** (iniciar sesión, crear cuenta, verificación en dos pasos y contraseña olvidada) tiene el estilo «Panel de marca»:
- el formulario sobre blanco;
- en el computador, un panel azul marino con la semana de la Agenda en azul y grises.

La beta lleva lo mismo.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Entender en segundos qué es y por qué confiar | P1 | Hecha | Ocho secciones, en claro y oscuro |
| H2 – Iniciar sesión y registrarse con el mismo estilo | P1 | Hecha | Tercera versión, aprobada por el dueño del producto |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La dirección aprobada | Cumple | Revisión de diseño y capturas: un solo acento, títulos en tinta sólida, sin degradados decorativos |
| RF-002 – Las funciones que distinguen, sin precios ni cifras inventadas | Cumple | Recorrido de la portada: historia clínica privada, «Confirmo que voy», calendario del celular, transferencia, varias agendas y descarga; «¿Cuánto cuesta?» lleva a soporte |
| RF-003 – Claro y oscuro, 1440 y 390 px, contraste, foco y movimiento reducido | Cumple | `check:contrast`; recorridos en Chromium a 1440 px y WebKit a 390 px, en claro y oscuro; foco visible con el teclado |
| RF-004 – Los enlaces, el contacto y los referidos | Cumple | Recorrido de la portada: alta, reservas de ejemplo, iniciar sesión, privacidad, WhatsApp y email con `?ref=` |
| RF-005 – La beta, la misma portada | Cumple | Beta: build, lint y contraste; capturas en los dos motores y modos, sin desborde ni errores de la página |
| RF-006 – El acceso con el estilo, sin cambiar lo que hace | Cumple | Recorrido del acceso: 84 de 84 ✓. Incluye entrar como profesional y como super admin, el error de contraseña, la verificación en dos pasos simulada, el registro con su CAPTCHA y «Quiero mi agenda» con el código de referido |
| CE-001 – Revisión de diseño y lista de UI UX Pro Max | Cumple | Portada: design-review de interface-design y la lista de UI UX Pro Max, con lo que salió corregido. Acceso: lo revisó y aprobó el dueño del producto |
| CE-002 – Build, lint, contraste, sin desborde ni enlaces rotos | Cumple | Sin desborde horizontal de 320 a 1920 px. Recorrido de la portada: 30 de 30 ✓ |

**Pruebas automáticas:**
- **Front:** sin errores en `tsc -b`, `npm run build`, `npm run lint` y `npm run check:contrast` (12 paletas, claro y oscuro).
- **Beta:** sin errores en `tsc -b`, `npm run build`, `npm run lint` y `npm run check:contrast`. Las cuentas de demostración entran al panel.

## Cambios respecto al plan

- **El acceso** se añadió a la spec (Historia 2) a pedido del dueño del producto.
- **El acceso tuvo tres versiones:**
  1. El formulario sobre una hoja de papel, con la franja de «Tu día» al lado. No le gustó: «dame un diseño más profesional».
  2. «Panel de marca», elegido entre tres propuestas, con la semana de la Agenda saliéndose por el borde. Pidió que no se saliera de la pantalla y «colores profesionales, que no parezcan colores que usa la IA».
  3. La semana entera dentro del panel, de lunes a viernes, en una sola gama:
     - lo atendido, en gris;
     - lo confirmado, en azul claro;
     - lo pendiente, con borde punteado;
     - la reserva nueva, en azul lleno.
- **La semana del panel** reutiliza el calendario de la portada anterior (`week-sample.tsx`), sin los colores de cada estado.
- **`auth-sheet.tsx` pasó a `auth-styles.ts`:** sin la hoja, sólo quedan los estilos del enlace y del error.
- **En la beta:**
  - **El login:** conserva sus cuentas de demostración, en un recuadro con el estilo nuevo, y la recuperación por enlace.
  - **«¿Cuánto cuesta?»:** va sin código de referido, porque la beta no tiene referidos.
  - **El campo de contraseña:** se tomó el del front, que admite el icono.

## Pendientes y riesgos

- **La verificación en dos pasos y el CAPTCHA** se probaron con respuestas simuladas, no de punta a punta.
- **El testimonio de una clienta** se puede añadir más adelante, sólo con su permiso.
- **La beta no tiene git.** El respaldo previo es `~/Documentos/Proyectos/Betas/agenda-beta-respaldo-antes-de-portada-030-2026-10-21.tar.gz`.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | b75ada7 | Spec 030: una portada más profesional y el acceso con el panel de la marca (spec, plan y tareas) |
| agenda-front | 691b911 | Spec 030: la portada nueva (un solo acento, la franja de «Tu día», funciones, preguntas) y el acceso con el panel de la marca |

## Cómo publicarlo

1. **Sin migración.**
2. **El PR `dev` → `main` del front.** El backend sólo lleva la documentación y va con su próximo PR.
3. **Después, sólo mirando:** la portada y /login en producción, en el computador y en el celular.

## Texto para el PR

Spec 030: una portada más profesional y el acceso con el panel de la marca.
- **La portada:** un solo acento azul y sin degradados; el paciente reservando desde WhatsApp y la cita llegando a «Tu día»; para quién es, cómo funciona, lo que distingue a Agenda360 y las preguntas frecuentes, sin precios.
- **El acceso:** el formulario sobre blanco y, en el computador, un panel azul marino con la semana de la Agenda.
- **Todo sigue funcionando igual:** registro, contacto, referidos y verificación en dos pasos.

**Migración:** ninguna.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/030-portada-profesional/reporte.md
