# Reporte final: Arreglos urgentes de la plataforma

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev, con la beta · **Fecha**: 2026-10-15

**Repos**: los dos (agenda-backend y agenda-front) y la beta · **Migración**: Sí:
`042_plan_since.sql`

## Resumen

**Gmail:** los emails respetan el cupo diario de la cuenta, de unos 500, con prioridades:
- primero las contraseñas y la seguridad del equipo;
- después todo lo del paciente;
- al final las copias al profesional y los avisos al negocio, que esperan en la cola sin perderse.

Ya no se descartan emails de pacientes por el tope de 400. El super admin ve el cupo en Salud.

**Política de privacidad:** dice «semanal» y ya no promete lo que no existe. El registro deja de
mencionar unos términos que no existen.

**Ficha del negocio:** dice «En Pro desde el…», y «Cerca del límite» cuenta bien a los pacientes.

La copia de los archivos y los términos del servicio quedaron aplazados por el dueño.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – Los recordatorios no se pierden por el tope de Gmail | P1 | Hecha | El cupo por niveles al enviar; la tarjeta «Cupo de Gmail» en Salud |
| H2 – La política dice la verdad | P1 | Hecha | 9 frases cambiadas (abajo) |
| H3 – Datos correctos para el super admin | P2 | Hecha | `plan_since`, «Cerca del límite» y el reparto por plan |
| Beta (RF-010) | — | Hecha | La beta no tenía política: se añadió `/privacidad`, más el texto del registro |

## Comprobación

Todo en local: las bases desechables de `npm test` y la de prueba del puerto 54400, la API en el 4180,
el front compilado en el 5199 y la beta en el 3199.

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Todos los envíos de 24 h frente al cupo | Cumple | `email-quota` (32 comprobaciones nuevas), con un cupo pequeño de prueba |
| RF-002 – Equipo, después paciente; copias y avisos esperan sin descartarse | Cumple | `email-quota`: el orden por niveles; ningún nivel bajo le quita sitio a uno alto en el mismo lote; lo que no cabe sigue `queued` sin sumar intentos y sale cuando hay cupo |
| RF-003 – El recordatorio que ya no llega a tiempo no sale | Cumple | Ya existía («Recordatorio descartado: la cita ya empezó.»); también vale para los que esperaron el cupo. La copia de un recordatorio que sí llegó al paciente sale igual |
| RF-004 – Salud y ntfy | Cumple | La tarjeta «Cupo de Gmail» (ámbar desde el 80 %, rojo al límite del paciente, «N esperan cupo»); ntfy una vez al día, con cifras. Recorrido y `email-quota` |
| RF-005 – Siguen los topes de la spec 009 | Cumple | `public-abuse`: el tope del público y el de pacientes nuevos por negocio |
| RF-006 – La política y el registro | Cumple | Las 9 frases de abajo; recorrido a 390 px |
| RF-007 – «En {plan} desde el…» | Cumple | `admin-overview`: `planSince` y la fórmula de la 042; recorrido |
| RF-008 – «Cerca del límite» y el reparto por plan | Cumple | `admin-overview`: un paciente de una reserva falsa sin citas activas no cuenta; un negocio suspendido no entra en el reparto |
| RF-009 – Los README | Cumple | Las correcciones de R6 en los dos |
| RF-010 – La beta | Cumple | Build, lint y su recorrido (14 de 14) |
| CE-001 / CE-002 – Ningún recordatorio retrasado por copias; ninguna copia perdida | Cumple | `email-quota` |
| CE-003 – La política no promete lo que no existe | Cumple | Revisada frase por frase (abajo) |
| CE-004 – Pruebas y 390 px | Cumple | Ver abajo |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores y `env -u DATABASE_URL npm test`: 55 de 55 suites.
  - `email-quota` es nueva: 32 comprobaciones.
  - `admin-overview` suma 9 y `cron` suma 3.
  - `public-abuse` y `appointment-series` se adaptaron al cupo.
- **Front:** `npm run build` y `npm run lint` sin errores.
- **Beta:** build y lint sin errores.

**Recorridos:**
- front: 36 de 36 (18 en escritorio y 18 a 390 px);
- beta: 14 de 14.

## Frases cambiadas de la política (antes → después)

1. Fecha: «14 de octubre de 2026» → «15 de octubre de 2026».
2. §9: «Una copia de seguridad **diaria**…» → «Una copia de seguridad **semanal**…».
3. §8: se añade: «Las copias de seguridad de la base de datos ya hechas (semanales y cifradas) guardan
   esos datos hasta que se borra cada copia.»
4. §11: se añade: «La aplicación no tiene una descarga automática de los datos: la portabilidad se
   pide de la misma forma, escribiéndonos, y la atendemos dentro del plazo que fija la ley.»
5. §13: «…lo avisaremos por email a los negocios.» → «…se lo comunicaremos a los negocios antes de que
   se aplique.»
6. §5: «La historia clínica sólo la ven…» → «**Dentro del negocio**, la historia clínica sólo la ven…».
7. §5: el soporte «…para darle asistencia, **y ahí ve lo mismo que su propietario, también la historia
   clínica**.»
8. §6: «Queda registrado quién **del equipo del negocio** abre cada historia clínica y cada archivo.»
9. Registro: «Al crear tu cuenta aceptas los términos del servicio y la política de privacidad.» →
   «Al crear tu cuenta aceptas la política de privacidad.», con su enlace.

**Las frases 6, 7 y 8 no estaban en el plan.** Se corrigieron porque eran falsas según tu decisión: en
modo soporte, el super admin ve la historia clínica y sus consultas no se registran. Si prefieres
registrar esas consultas en vez de decirlo en la política, es otra spec.

## Cambios respecto al plan

- **`emailQuota` va dentro de `stats.health`** (lo que recibe la tarjeta de Salud), no en la raíz de
  `getStats`.
- **Los que esperan el cupo** se miran en cada lote, sin esperar sus 30 minutos. Así salen en cuanto
  hay cupo, antes que los nuevos de su nivel.
- **El motivo del recordatorio tardío** sigue siendo «Recordatorio descartado: la cita ya empezó.»: ya
  existía y lo usan Salud y las pruebas.
- **La API no arranca si las reservas del cupo no tienen sentido.** Pasa si la del paciente no es
  menor que el cupo o si la del equipo es mayor que la del paciente.
- **`THIRD_PARTY_EMAILS_PER_DAY` se quitó:** ya no se usa.
- **La cifra «Pacientes» de la ficha del admin** sigue la regla del tope del plan: ya no cuenta las
  fichas de reservas falsas.
- **La migración 042 lleva además un índice en `notifications (sent_at)`,** añadido en la revisión:
  cada lote cuenta los enviados de 24 h, y sin el índice esa cuenta se haría más lenta con el tiempo.
- **La beta no tenía página de política:** se añadió.

## Pendientes y riesgos

- **No se pudo probar en local:** el envío real por Gmail. El cupo se probó con un envío falso.
- **Envíos simultáneos:** si la API y el cron envían a la vez, pueden pasarse del cupo hasta 10 emails
  (un lote). La reserva del equipo lo absorbe.
- **Lambda:** la política nombra a Vercel como servidor. Si la API pasa a Lambda (la Fase 5), hay que
  añadir a AWS como proveedor.
- **Aplazados para otra spec:**
  - la copia de los archivos clínicos;
  - los términos del servicio con el contrato de encargo;
  - el resto de las brechas de la revisión del 2026-10-15.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 0d33def | Spec 015: spec, plan y tareas de los arreglos urgentes (constitución 1.12.0) |
| agenda-front | bf24883 | Constitución 1.12.0: el cupo de Gmail con prioridades (spec 015) |
| agenda-backend | (el de esta entrega) | Spec 015: arreglos urgentes (backend) y reporte |
| agenda-front | (el de esta entrega) | Spec 015: arreglos urgentes (front) |

La beta queda actualizada en su carpeta, con la copia previa `beta-src-antes-015.tgz`.

## Cómo publicarlo

1. **La migración 042,** como paso aparte, antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.**
3. **No hay variables nuevas obligatorias.** El cupo usa 500 si no se pone nada.
   `THIRD_PARTY_EMAILS_PER_DAY` se puede borrar de Vercel y Lambda.
4. **Al publicarse:**
   - abrir `https://agenda-backend-lemon.vercel.app/api/health` y ver `"ok":true`;
   - en Salud de /admin, ver la tarjeta «Cupo de Gmail».

## Texto para el PR

Spec 015, arreglos urgentes:
- los emails respetan el cupo diario de Gmail con prioridades: primero el equipo, después el paciente
  y al final las copias y los avisos al negocio, que esperan sin perderse;
- la política de privacidad dice «semanal» y no promete lo que no existe;
- la ficha del admin dice «En {plan} desde el…» y «Cerca del límite» cuenta bien.

**Migración:** `042_plan_since.sql`, aplicada antes del backend.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/015-arreglos-urgentes/reporte.md
