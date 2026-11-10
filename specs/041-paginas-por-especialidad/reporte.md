# Reporte final: Páginas por especialidad

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada (2026-11-10) · **Fecha**: 2026-11-10

**Repos**: agenda-front (y la spec en agenda-backend) · **Migración**: No

## Resumen

Tres páginas nuevas con el estilo de la portada, cada una para una profesión: **/psicologos**, **/fisioterapeutas** y
**/odontologos**. Cada una tiene:
- su encabezado, con «Crear mi agenda gratis» y «Escríbenos por WhatsApp», que lleva el mensaje de la especialidad;
- 6 casillas con el día a día de esa profesión y la función de Agenda360 que lo resuelve;
- 3 pasos para empezar y sus preguntas.

**Al compartir el enlace** en WhatsApp o en redes, la vista previa muestra el título y la descripción de esa
especialidad. Google tiene un mapa del sitio con las páginas públicas.

**Se llega a ellas** desde una fila «Hecho para…» en la portada y desde la columna «Especialidades» del pie.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Un profesional abre la página de su especialidad | P1 | Hecha | Las tres, con el texto de su profesión |
| H2 – Se llega a ellas y se comparten | P1 | Hecha | La vista previa de WhatsApp se comprueba después de publicar |
| H3 – Más especialidades | — | No se hace | Sólo las tres (respuesta 1) |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Las tres páginas | Cumple | Recorrido: las tres se abren completas, con su título |
| RF-002 – Sólo funciones que existen, sin lo prohibido | Cumple | `check:specialties`: sin LOPDP, precios, porcentajes, testimonios ni funciones paradas. Los textos se revisaron contra lo que hace Agenda360 |
| RF-003 – Los botones de la portada | Cumple | Recorrido: «Crear mi agenda gratis» lleva al registro |
| RF-004 – Los enlaces | Cumple | Recorrido: la fila de la portada y la columna del pie llevan a las tres; cada una enlaza a las otras dos; desde el pie de una especialidad se vuelve a las secciones de la portada |
| RF-005 – Título y descripción para Google y para compartir | Cumple | Build: cada HTML de especialidad con su título, su descripción, `og:title`, `og:description` y `og:url`, y el `index.html` general sin cambios. `check:specialties` |
| RF-006 – El mapa del sitio | Cumple | Build: `sitemap.xml` con la portada, las tres páginas y /privacidad, y `robots.txt` que lo indica. Ninguna página privada |
| RF-007 – Celular y computador, claro y oscuro | Cumple | Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro: sin desbordes ni errores ([capturas](./capturas/)) |
| RF-008 – Sólo las tres | Cumple | |
| RF-009 – «Escríbenos por WhatsApp» | Cumple | Recorrido: abre el WhatsApp de soporte con «Hola, soy psicólogo/a…» (o la especialidad que corresponda). Sin WhatsApp de soporte, el botón no sale |
| RF-010 – La beta no cambia | Cumple | |
| CE-001 – Recorrido con capturas | Cumple | 30 comprobaciones del recorrido. `/psicólogos` lleva a `/psicologos` y `/abogados` da «Página no encontrada» |
| CE-002 – La vista previa en WhatsApp | Sin comprobar | Sólo se puede ver después de publicar: WhatsApp lee la página publicada |
| CE-003 – El mapa del sitio | Cumple | Build y `check:specialties` |
| CE-004 – Las comprobaciones del front | Cumple | Build, lint, `check:contrast`, `check:data-export`, `check:board` y `check:specialties` (25 comprobaciones) |
| CE-005 – Las reglas en los textos | Cumple | `check:specialties` y la revisión de los textos |
| CE-006 – Rápidas en el celular | Cumple | Se cargan como la portada, con sus mismas piezas y fuentes, aparte del resto de la app |

## Cambios respecto al plan

- **Los HTML de cada especialidad los genera el propio Vite al compilar** (el plugin `agenda:specialty-pages` de
  `vite.config.ts`), en vez de un paso aparte con Node. Así el build no depende de la versión de Node de Vercel.
- **El mapa del sitio y `robots.txt` se generan al compilar,** no se guardan en `public/`. Así usan la dirección de
  producción que da Vercel (`VERCEL_PROJECT_PRODUCTION_URL`), también si un día cambia el dominio.
- **Las ilustraciones:** además de la de la visita a domicilio, una nueva de los archivos clínicos (una radiografía
  que se sube). La de la reserva acepta otro servicio de ejemplo («Limpieza dental»). La portada sigue igual.
- **El pie:** los enlaces a las secciones de la portada eran anclas que sólo funcionaban dentro de ella. Ahora
  funcionan desde cualquier página.
- **La constitución pasa a la 1.37.0,** porque la 040 ya usó la 1.36.0.

## Pendientes y riesgos

- **Que el dueño del producto revise los textos** en las capturas antes de publicar.
- **La vista previa de WhatsApp** guarda la primera versión que ve de cada enlace. Hay que probarla después de
  publicar, pegando el enlace en un chat.
- **Google tarda** días o semanas en mostrar páginas nuevas. Se puede adelantar enviando el mapa del sitio en Google
  Search Console.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | ccedf8c | Specs 040 y 041, aprobadas (con el prototipo) |
| agenda-backend | 4ed2509 | Specs 040 y 041: planes de implementación |
| agenda-backend | a4aeacc | Spec 041: tareas hechas, capturas y constitución 1.37.0 |
| agenda-front | 2775400 | Spec 041: páginas por especialidad |

## Cómo publicarlo

1. **Sin migración ni cambios en el backend** (salvo la constitución).
2. **El PR `dev` → `main` del front.**
3. **Después:**
   - abrir las tres páginas en la web publicada;
   - pegar el enlace de una en WhatsApp: la vista previa debe mostrar su título;
   - abrir `/sitemap.xml`.

## Texto para el PR

Spec 041: páginas por especialidad (/psicologos, /fisioterapeutas y /odontologos) con el estilo de la portada, para
vender por WhatsApp y para Google. Cada una con su vista previa al compartir, «Escríbenos por WhatsApp» con el mensaje
de la especialidad, y enlaces desde la portada y el pie. Mapa del sitio y robots.txt. Sin migración.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/041-paginas-por-especialidad/reporte.md
