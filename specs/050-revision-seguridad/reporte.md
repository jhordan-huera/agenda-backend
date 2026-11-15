# Reporte final: Lo que quedó de la revisión de seguridad

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-11-15

**Repos**: los dos, y los ajustes de GitHub · **Migración**: No

## Resumen

Se cerraron los hallazgos medios y bajos de la revisión de seguridad del 2026-11-14, menos dos.
- Nadie puede cambiar el teléfono de la espera de otra persona.
- Los enlaces cerrados ya no muestran datos.
- La dirección de la reserva no admite enlaces.
- Un comprobante guardado como página web se rechaza.

Para quien usa la plataforma con sus propios datos, nada cambia.

Quedan dos fuera:
- el token de Gmail, que dejó fuera el dueño;
- saber si alguien es paciente con su cédula y su teléfono, porque cambia una regla de la spec 009 y la decide el
  dueño.

## Qué se entrega

| Historia | Prioridad | Estado | Notas |
|---|---|---|---|
| H1 – La lista de espera | P1 | Hecha | |
| H2 – Lo que ya no se usa | P1 | Hecha | Ruta antigua y enlaces cerrados |
| H3 – La dirección sin enlaces | P2 | Hecha | Sólo la página de reservas |
| H4 – Los comprobantes | P2 | Hecha | |
| H5 – Contraseñas, peticiones, cabeceras y GitHub | P3 | Hecha | El rol de AWS y los registros, en Pendientes |

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – La espera no cambia de nombre ni de teléfono | Cumple | waitlist.test.ts: 4 comprobaciones nuevas; sin el arreglo, las 4 fallan («Otra Persona» guardada) |
| RF-002 – Sin `/professional` | Cumple | smoke.test.mjs: 404 |
| RF-003 – La dirección sin enlaces | Cumple | security.test.ts: 4 enlaces rechazados, una dirección normal pasa, el panel sí acepta un enlace, 2 MB en menos de 500 ms |
| RF-004 – El tipo guardado del comprobante | Cumple | payments.test.ts con un Supabase de mentira: guardada como `text/html`, 400 y se borra; con el tipo indicado, se recibe |
| RF-005 – Los enlaces cerrados | Cumple | waitlist.test.ts y surveys.test.ts: sin nombre, email, teléfono ni cita |
| RF-006 – bcrypt 12 | Cumple | security-sessions.test.ts: un hash de costo 10 pasa a 12 al entrar y sigue entrando |
| RF-007 – 100 kB sin sesión | Cumple | security.test.ts: 200 kB a `/public` y a `/auth/login` → 400 |
| RF-008 – Cabeceras de la web | Cumple | `front/vercel.json` revisado (JSON válido). Se ven al publicar |
| RF-009 – Ajustes de Actions | Cumple | API de GitHub: `sha_pinning_required: true` y `approval_policy: all_external_contributors` en los dos repos |
| RF-010 – Alertas de Dependabot | Cumple | API de GitHub: alertas 1 y 3 del front, `dismissed` / `tolerable_risk` |
| CE-001 – Todo pasa | Cumple | Backend 76 de 76 suites; front: compilación, lint y 11 de 11 `check:*` |
| CE-002 – Cada arreglo con su prueba | Cumple | Las de arriba |
| CE-003 – Nada cambia con los propios datos | Cumple | Las suites de reservas, pagos, lista de espera, encuestas y sesiones pasan sin tocar sus flujos |

**Pruebas automáticas**:
- **Backend:** `npm run typecheck` sin errores; `npm test` 76 de 76 suites.
- **Front:** `npm run build` y `npm run lint` sin errores, y las 11 `check:*` en «Todo bien».

## Cambios respecto al plan

- Ninguno.

## Pendientes y riesgos

- **Saber si alguien es paciente** (para que decida el dueño):
  - con la cédula y el teléfono de alguien, la reserva pública responde distinto si ya es paciente: el email de la
    confirmación sale vacío;
  - si ya tiene una cita ese día, responde «Ya tienes una cita ese día»;
  - para cerrarlo, la ficha se reconocería sólo si coincide el email. Con sólo el teléfono, la reserva saldría igual
    pero «Por verificar»;
  - eso cambia la regla «email o teléfono» de la spec 009, que está en la constitución.
- **El rol de AWS como secreto** (lo hace el dueño: la herramienta no tuvo permiso):
  1. en GitHub, agenda-backend → Settings → Secrets and variables → Actions → Variables, copia el valor de
     `AWS_DEPLOY_ROLE_ARN`;
  2. en la pestaña Secrets, crea `AWS_DEPLOY_ROLE_ARN` con ese valor;
  3. borra la variable.

  El despliegue ya prefiere el secreto (`secrets.AWS_DEPLOY_ROLE_ARN || vars.AWS_DEPLOY_ROLE_ARN`).
- **Los registros antiguos** (lo hace el dueño, no se puede deshacer):
  - en Actions, los registros de los despliegues a Lambda muestran el identificador del rol;
  - 3 registros de la copia de seguridad, de antes de la spec 009, muestran el email;
  - en cada ejecución: «…» → «Delete all logs».
- **Limitar los secretos a `main`:** hay que crear un entorno con la regla de `main` y volver a escribir cada valor.
  Hoy sólo el dueño puede escribir en los repos, así que el riesgo es bajo.
- **El token de Gmail:** sigue con acceso a todo el buzón (fuera por decisión del dueño).
- **bcrypt 12:** cada inicio de sesión gasta unos 150 ms más de CPU en Vercel.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | cff6990 | La lista de espera: el email de otra persona ya no cambia el nombre ni el teléfono |
| agenda-backend | 89d3308 | La ruta antigua, la dirección, el comprobante, los enlaces cerrados, bcrypt 12 y el tope de 100 kB |
| agenda-front | 3fdcaf4 | La dirección sin enlaces, los enlaces cerrados y las cabeceras |

## Cómo publicarlo

1. **Sin migración.**
2. **Primero el PR del front, después el del backend.** El front nuevo funciona con la API de antes, pero el front de
   antes no muestra bien una espera cerrada con la API nueva.
3. **Después de publicar,** sólo leyendo:
   - que los despliegues de Vercel estén «Ready»;
   - que la web mande `strict-transport-security` y `cross-origin-opener-policy`.

## Texto para el PR

Spec 050: lo que quedó de la revisión de seguridad.
- Nadie puede cambiar el teléfono de la espera de otra persona.
- Los enlaces cerrados ya no muestran datos.
- La dirección de la reserva no admite enlaces.
- El comprobante se compara con el tipo guardado.
- Contraseñas con costo 12 y un tope de 100 kB sin sesión.

Sin migración. Primero el front.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/050-revision-seguridad/reporte.md
