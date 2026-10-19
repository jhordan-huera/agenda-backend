# Reporte final: «Tu día» que se desliza

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-19

**Repos**: agenda-front y la beta (copia idéntica del archivo) · **Migración**: No

## Resumen

La franja «Tu día» del Inicio ya no mete el día entero en el ancho de la pantalla:
- **Cuánto se ve:** unas 2,9 horas en un celular de 390 px y 7 en el computador.
- **Cada cita** lleva su hora entera y el comienzo del nombre del paciente.
- **Se desliza** con el dedo, el trackpad o la rueda, y tiene ‹ ›, «Ahora» y los avisos de los bordes
  («← 1 cita», «2 citas →» en el celular; «1 cita más tarde →» en el computador). Los avisos llevan
  hasta la cita.
- **Al abrir,** empieza en la hora actual. Antes del día, en la primera cita; después, en la última.
- **Un día corto que cabe entero** se ve fijo, sin barra.

Todo lo que ya hacía se mantiene: el horario, los bloqueos, lo pasado, la línea de «ahora», el borde
lila, los estados, varias agendas y el detalle al tocar.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Una parte del día a la vista | Cumple | Recorrido: a 390 px se ven unas 2,9 horas (11:00–13:00 alrededor de las 12:00) y a 1440 px, de 09:00 a 16:00 |
| RF-002 – Hora y nombre en cada cita | Cumple | Recorrido: «15:00 / Lucía Bení…», sin cortar la hora (se mide en la página) |
| RF-003 – Se desliza sin mover la página | Cumple | Recorrido: sin desplazamiento horizontal a 390 y 1440 px. Comprobación técnica del agente: también a 360 y 320 px |
| RF-004 – ‹ ›, «Ahora» accesibles | Cumple | Recorrido: › se deshabilita al final y «Ahora» vuelve. Botones con nombre («Horas siguientes», «Ahora: volver a la hora actual») |
| RF-005 – Dónde empieza | Cumple | Recorrido: al abrir a las 12:00, centrada en «ahora». El comienzo en la primera o la última cita lo comprobó el agente en Chromium |
| RF-006 – Avisos de los bordes | Cumple | Recorrido: «← 1 cita» y «2 citas →» al abrir; al tocarlo, llega a la cita de las 15:00 |
| RF-007 – Lo de antes, igual | Cumple | Recorrido: tocar la cita abre su detalle. Capturas: horario, lo pasado y la línea de «ahora» |
| RF-008 – Sin gastar de más | Cumple | Sin intervalos ni pedidos nuevos. El `onScroll` es pasivo y se limita a un cuadro |
| CE-001 a CE-004 | Cumple | Recorrido: 10 ✓ en cada una de las cuatro combinaciones (Chromium 1440 px y WebKit 390 px, claro y oscuro), y el día corto (3 ✓) en el celular y el computador. Build, lint y contraste sin errores |

## Cambios respecto al plan

- **En el celular, cada hora mide al menos 110 px.** Con 3,5 horas, una cita de 30 minutos no llevaba
  la hora entera («14:0»). A 390 px se ven unas 2,9 horas.
- **Los textos de los avisos dependen del ancho:** «← 2 citas antes» en el computador, «← 2 citas» en
  el celular y «← 2» en pantallas muy angostas. El lector de pantalla siempre oye la frase entera.
- **«Ahora»** se llama «Ahora: volver a la hora actual», para que se pueda encontrar por su palabra
  visible.
- **Añadidos:**
  - el ancho se mide antes de pintar, así no se ve un instante el día comprimido;
  - `overscroll-x-contain`, para que el trackpad no vaya atrás en el historial al llegar al
    extremo;
  - con el teclado, al tocar un aviso el foco pasa a la cita.

## Pendientes y riesgos

- **Ninguno de la función.** Es sólo del front.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | (el de esta entrega) | Spec 026: «Tu día» que se desliza (spec, plan, tareas y reporte) |
| agenda-front | (el de esta entrega) | Spec 026: «Tu día» se desliza, con la hora y el nombre en cada cita |

## Cómo publicarlo

1. **Sin migración ni backend:** sólo el PR del front.
2. **Después:** abrir el Inicio en el celular con dos citas en el día y comprobar los avisos de los
   bordes.

## Texto para el PR

Spec 026: «Tu día» se desliza. La franja del Inicio:
- muestra unas 3 horas en el celular y 7 en el computador, con la hora y el nombre en cada cita;
- se desliza, con ‹ ›, «Ahora» y avisos de las citas que quedan fuera;
- se abre en la hora actual.

Lo pidió una clienta que sólo veía una de sus dos citas del día.

**Migración:** ninguna.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/026-tu-dia-deslizable/reporte.md
