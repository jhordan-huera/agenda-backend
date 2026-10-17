# Plan de implementación: El aviso de la mañana

**Rama**: `dev` · **Fecha**: 2026-10-17 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **El tipo nuevo `morning_summary`**, en el código compartido (se edita en el front y se copia con
   `sync:shared`):
   - en `lib/constants/push.ts`:
     - va en `OWNER_PUSH_KINDS` y en `AGENDA_PUSH_KINDS`;
     - su etiqueta es «Resumen al empezar el día», con su descripción;
   - en `lib/constants/notices.ts`: `morning_summary: { owner: "business", team: null, agenda: true }`,
     igual que `evening_summary`;
   - en `lib/notices.ts` (`describeNotice`), el texto y el enlace a la lista «Por cerrar».

   Los aparatos guardan los tipos **apagados** (`muted_kinds`), así que a los que ya están activados
   les llega sin hacer nada.
2. **Migración 045** (`045_morning_summary.sql`): `panel_notices` acepta `morning_summary` en sus dos
   `check` de `kind`. Se buscan por su nombre en `pg_constraint`, se quitan y se vuelven a crear con el
   tipo nuevo.
3. **El cron** (`push-notices.ts`): `queueMorningSummaries(since, until, tally)`, que se llama junto al
   resumen de las 8 en `scheduled-tasks.ts`.
   - **Para cada negocio activo y cada agenda activa con usuario:**
     - calcula la hora de inicio de hoy, en la zona del negocio: el primer `start` de los `intervals`
       de su `schedules` de hoy (`day_of_week`), si `is_active`;
     - si un bloqueo de día completo (`blocked_times` con `all_day`, de esa agenda o del negocio
       entero) cubre hoy, ese día no atiende;
     - **toca** si el inicio cayó en la ventana de esta pasada, o en las 2 horas anteriores (por si el
       cron no corrió);
     - **cuenta** sus citas de fecha anterior a hoy en estado `pending` o `confirmed`;
     - **si hay alguna,** pone el aviso en la campana y en el celular (`userOf`, con el rol
       Profesional), con la clave `manana:<agenda>:<fecha>`.
   - **El propietario:**
     - la hora es la de la primera agenda que abre hoy;
     - la cifra es la de todo el negocio, con la clave `manana:<negocio>:<fecha>`;
     - si el propietario también tiene agenda, no recibe además el de su agenda.
   - **La línea del registro del cron** suma «avisos de la mañana: N».
4. **El front:**
   - en «Avisos en tu celular» (el propietario y el profesional) sale el interruptor nuevo, porque
     viene de `OWNER_PUSH_KINDS` y `AGENDA_PUSH_KINDS`;
   - la campana muestra el texto con `describeNotice`.

   No hace falta nada más.
5. **El cierre obligatorio del mes** (Historia 2):
   - **Backend** (`appointments-to-close.ts`): el contador `GET …/to-close/count` suma `previousMonth`,
     las citas sin cerrar de fecha anterior al primer día del mes en curso (en la zona del negocio),
     con el mismo alcance por rol. La lista ya las trae primero, porque va de la más vieja a la más
     nueva.
   - **Front** (`dashboard-layout.tsx`, `to-close-screen.tsx` y `close-later.ts`):
     - si `previousMonth > 0`, la pantalla sale sin «Más tarde», aunque haya uno guardado, con el
       texto del mes;
     - en modo soporte, sólo la franja;
     - con `previousMonth = 0`, todo sigue como en la spec 018.
   - **Una API antigua** que no trae `previousMonth` se toma como 0, así que el orden de los PR no
     rompe nada.
6. **El aviso al super admin** (Historia 3):
   - **El tipo de la plataforma** `reminders_sent`:
     - va en `PLATFORM_PUSH_KINDS`, con la etiqueta «Recordatorios de citas por cerrar enviados»;
     - su audiencia en la campana es la plataforma.
   - **La migración 045** también lo suma a los `check` de `panel_notices`, en el grupo de la
     plataforma, que guarda su título y su texto.
   - **El cron:**
     - `queueMorningSummaries` y el resumen de las 8 devuelven a qué negocios avisaron y cuántas citas;
     - al final de la pasada, si alguno salió, un solo aviso a la campana de /admin y al celular del
       super admin (`{ platform }`), con la clave `recordatorios:<tanda>:<fecha>:<inicio de la ventana>`;
     - en `scripts/cron.ts`, el mismo texto por ntfy, con el título «Recordatorios de citas por cerrar
       enviados» y los negocios en el cuerpo;
     - la línea del registro: «recordatorios: mañana N negocios · noche N negocios», sólo con cifras.
   - **Como mucho 10 negocios** por aviso, los de más citas. Del resto, «y N negocios más».
7. **La beta:**
   - un aviso de ejemplo `morning_summary` en su campana simulada;
   - el contador con `previousMonth` en su repositorio simulado, con alguna cita de prueba de un mes
     anterior.
8. **Constitución 1.19.0** (MENOR), en el principio III:
   - junto al resumen de las 8: «y al empezar el día, a cada profesional a la hora de su horario (y al
     propietario cuando abre el negocio), las citas de días anteriores sin cerrar»;
   - en la línea del bloqueo de la spec 018: «las de un mes anterior bloquean sin «Más tarde» hasta
     cerrarlas (2026-10-17)».

**Migración:** 045. **Variables:** ninguna.

## Comprobación contra la constitución

| Principio | Cumple |
|---|---|
| Español | Sí |
| Privacidad | Sí: sólo cifras |
| Decisiones | Sí: las dos del dueño |
| Local | Sí |
| Compartido | Sí: el tipo y los textos, con `sync:shared` |
| Barato | Sí: corre en el cron de GitHub, con pocas consultas por negocio |
| Diseño | Sí: el interruptor, a 390 px |

## Pruebas

**Backend** (en `push-notices.test.ts` o en una suite nueva, `morning-summary.test.ts`), con el cron
simulado:
- **A la hora de inicio:** le llega al profesional, una vez, con la cifra de su agenda.
- **Al propietario:** a la hora de apertura, con la cifra del negocio, sin uno repetido.
- **Sin aviso:**
  - si no hay citas de días anteriores;
  - si ese día no atiende (por su horario o por un bloqueo de día completo);
  - antes de la hora;
  - pasadas las 2 horas.
- **Una segunda pasada** no lo repite.
- **El celular** sólo si tiene el tipo encendido. Silenciado, no llega.
- **El texto** no lleva datos de pacientes.
- **La migración 045:** la campana acepta el tipo nuevo.

**El aviso al super admin:**
- llega uno por pasada con avisos, con los negocios y sus cifras, a la campana y al celular, y por ntfy
  (el `fakeNtfy` de las pruebas);
- no llega ninguno si no salió nada;
- con más de 10 negocios, «y N negocios más»;
- no lleva pacientes;
- el título y la línea del registro, sin nombres de negocios.

**El cierre del mes** (`close-appointments.test.ts`):
- `previousMonth` cuenta sólo las de meses anteriores, con el alcance por rol.
- Una del día 30 del mes pasado cuenta; una del día 1 de este mes, no.
- Se calcula en la zona del negocio.

**Front:**
- build y lint;
- el interruptor en «Avisos en tu celular», en los dos modos y a 390 px;
- el recorrido:
  - con una cita del mes pasado sin cerrar, la pantalla sale sin «Más tarde» y vuelve aunque haya uno
    guardado;
  - al cerrarla, se entra;
  - con sólo del mes en curso, «Más tarde» sigue;
  - en modo soporte, la franja.

**Beta:** build y lint.

## Publicación

1. **La migración 045,** como paso aparte, antes del backend:

   ```
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.**
3. **Avisar a los profesionales** que activen los avisos en su celular, si aún no lo hicieron.
