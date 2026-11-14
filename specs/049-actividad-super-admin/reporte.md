# Reporte final: La pantalla Actividad del super admin, rediseñada

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada (2026-11-13) · **Fecha**: 2026-11-13

**Repos**: agenda-front (agenda-backend sólo lleva esta carpeta) · **Migración**: No

## Resumen

`/admin → Actividad` ahora muestra una cosa a la vez.
- **Arriba, una frase dice cómo va hoy.** Reemplaza las cuatro tarjetas de cifras: «Todo en orden hoy» o, en rojo, los
  emails que fallaron y las cuentas en alerta, con un botón para verlos.
- **Debajo, tres pestañas:**
  - **Acciones:** una sola lista con el día a la izquierda, «Tú» en las acciones propias y el negocio como enlace a su
    ficha.
  - **Seguridad:** los inicios de sesión con el navegador y la IP.
  - **Emails:** el estado primero. Sólo los que fallaron van en rojo, con el motivo en la misma fila.
- **Las fechas** se eligen con un solo botón, con atajos.
- **El panel del negocio no cambia.**

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Saber de un vistazo cómo va hoy | P1 | Hecha | El resumen en una frase, con «Ver los fallidos» o «Ver la seguridad» y el enlace de los intentos fallidos |
| H2 – Una cosa a la vez | P1 | Hecha | Acciones, Seguridad y Emails, con su cifra y en la dirección. Los enlaces de antes siguen valiendo |
| H3 – La actividad sin cajas dentro de cajas | P1 | Hecha | Una sola superficie con el día a la izquierda (arriba en el celular) y el botón de fechas |
| H4 – Seguridad | P2 | Hecha | El navegador y la IP, «Sólo intentos fallidos» y los fallidos en rojo |
| H5 – Emails: el estado primero | P1 | Hecha | La tabla por día en el computador, varias líneas en el celular, el motivo del fallido y del descartado |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El resumen | Cumple | `check:admin-activity` (las frases, en singular y plural). Recorrido: «Todo en orden hoy» ([captura](./capturas/acciones-1440-claro.png)); con un fallido, «1 email falló hoy» con «Ver los fallidos» ([captura](./capturas/emails-1440-claro.png)); los intentos fallidos abren Seguridad |
| RF-002 – Las tres pestañas | Cumple | Recorrido: las cifras de Seguridad («2») y de Emails («1 fallido»); cada pestaña queda en la dirección y Atrás vuelve a la anterior |
| RF-003 – Los enlaces de antes | Cumple | `check:admin-activity` y el recorrido: `?ver=seguridad` abre Seguridad; `?emails=todos` y `?emails=fallidos` abren Emails con su filtro |
| RF-004 – La lista por día | Cumple | Recorrido: «Tú», el negocio como enlace a su ficha, «Ver cambios» y, en Seguridad, el navegador y la IP ([captura](./capturas/seguridad-1440-claro.png)). En el celular, el día arriba ([captura](./capturas/acciones-390-oscuro.png)) |
| RF-005 – Un solo botón de fechas | Cumple | `check:admin-activity` (los atajos y el texto del botón). Recorrido: «Últimos 7 días» filtra, Desde y Hasta, y «Cualquier fecha» las quita ([captura](./capturas/fechas-1440-claro.png)) |
| RF-006 – Exportar | Cumple | Recorrido: descarga `auditoria-all-…csv` con los filtros elegidos |
| RF-007 – Emails con el estado primero | Cumple | `check:admin-activity` (los cuatro estados). Recorrido: sólo la fila del fallido con el tinte rojo y su motivo; el descartado, en gris con el suyo; la tabla con Hora, Estado, Email, Negocio y Tipo; en el celular el asunto completo ([captura](./capturas/emails-390-oscuro.png)) |
| RF-008 – Abrir un email | Cumple | Recorrido: al tocarlo se abre su contenido ([captura](./capturas/email-abierto-1440-claro.png)) |
| RF-009 – Claro y oscuro, computador y celular | Cumple | Recorrido en Chromium a 1440 en claro y WebKit a 390 en oscuro, sin desplazamiento horizontal. Los colores salen de los tokens del tema |
| RF-010 – Sin cambios en la API | Cumple | Sólo cambia agenda-front; el backend sólo lleva esta carpeta (`typecheck` en verde) |
| RF-011 – El panel del negocio igual | Cumple | Recorrido: su actividad sigue con Desde, Hasta y los avatares ([captura](./capturas/negocio-actividad-1440-claro.png)) |
| CE-001 – La comprobación automática | Cumple | `check:admin-activity`: 47 de 47 |
| CE-002 – Build, lint y comprobaciones | Cumple | Front: build, lint sin avisos y las 11 `check:*`. Backend: `typecheck` |
| CE-003 – El recorrido | Cumple | 44 de 44 en Chromium (1440, claro) y WebKit (390, oscuro), sin errores en la consola |
| CE-004 – Los fallidos con un toque | Cumple | «Ver los fallidos» del resumen abre Emails con Fallidos |
| CE-005 – Más corta en el celular | Cumple (medido: 1426 px contra 2245 px, un 36 % menos) | Recorrido en WebKit a 390. La base de prueba tiene ahora más actividad que cuando se midió la de antes |

**Pruebas automáticas**: `npm run build` y `npm run lint` sin errores ni avisos; `check:admin-activity` 47/47 y las otras
10 `check:*` en verde; `npm run typecheck` del backend en verde. El backend no cambia, así que no hace falta `npm test`;
lo corre igual GitHub («Comprobar»).

## Cambios respecto al plan

- **El filtro de los emails también va en la dirección** (`?ver=emails&emails=hoy`), no sólo al llegar con él. Así la
  dirección manda en la pestaña y en el filtro: Atrás funciona y no hace falta copiar el estado. Cambiar el filtro no
  agrega una entrada al historial; cambiar de pestaña, sí.
- **«Fallidos» va sin cifra.** La cifra que manda el Inicio es la de los fallidos de hoy, y el filtro trae los fallidos
  de cualquier día: el número no coincidiría. La cifra de hoy sale en la pestaña Emails («1 fallido») y en el
  resumen.
- **En Seguridad, un intento fallido contra tu cuenta va con el nombre de la cuenta, no con «Tú»:** no lo hiciste tú.
- **En el celular,** la cifra de cada pestaña muestra sólo el número y «Exportar» es un icono con su nombre para el
  lector de pantalla. Así las tres pestañas y «Exportar» caben en una fila sin cortarse.
- **Los nombres de los tipos de email** pasaron a `email-type-labels.ts`, y «es un intento fallido» a
  `audit-filters.ts` (`isFailedLogin`). Son archivos `.ts` porque el lint no deja exportar constantes desde un
  componente.
- **La lista de emails no tiene su propio desplazamiento,** como la de antes: se desplaza la página, que en el celular
  se maneja mejor.
- **El título de cada día** («Hoy / viernes 13 nov») salió de `ledgerDay` en `date-range.ts`, que también prueba la
  comprobación.

## Pendientes y riesgos

- **Quien estaba acostumbrado a bajar hasta los emails** ahora los tiene en su pestaña. «Ver emails» del Inicio sigue
  llevando directo ahí.
- **Los campos Desde y Hasta** siguen siendo los del navegador, dentro del botón; los atajos cubren lo más común.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 5736ad0 | Spec 049: spec, plan y tareas aprobados el 2026-11-13 |
| agenda-backend | (este commit) | Spec 049: tareas, capturas y reporte |
| agenda-front | af85f3c | Spec 049: la pantalla Actividad del super admin, rediseñada; `check:admin-activity` |

## Cómo publicarlo

1. **Sin migración ni variables.**
2. **Los PR `dev` → `main`** de los dos repos, en verde («Comprobar»). El orden da igual: el backend sólo lleva la
   carpeta de la spec.
3. **Después:** abrir `/admin → Actividad` en el celular y en el computador.

## Texto para el PR

Spec 049: la pantalla Actividad del super admin, rediseñada.
- **Arriba, cómo va hoy en una frase,** en lugar de las cuatro tarjetas. En rojo, con un botón, si fallaron emails o
  hay cuentas en alerta.
- **Tres pestañas: Acciones, Seguridad y Emails.** La lista va por día; los emails, con el estado primero y el motivo
  del fallido.
- **Un solo botón de fechas.** El panel del negocio no cambia.
- **Sin migración ni cambios en la API.**

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/049-actividad-super-admin/reporte.md
