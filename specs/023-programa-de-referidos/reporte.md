# Reporte final: El programa de referidos

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-18

**Repos**: los dos y la beta · **Migración**: Sí: `046_referrals.sql`

## Resumen

**El propietario** de cada negocio tiene en Configuración → Negocio la tarjeta «Recomienda Agenda360»,
con:
- su enlace propio, con «Copiar» y «Compartir por WhatsApp»;
- cuántos colegas recomendó y cuántos se quedaron;
- «Por cada colega que se quede, $1,50 menos en tu siguiente mensualidad».

**El colega que abre el enlace** llega a la portada, y «Quiero mi agenda» le escribe al dueño: «… Me
recomendó Centro Profesional (código Q4ZSX9)».

**En /admin, el dueño:**
- anota «Recomendado por» al crear el negocio o en su ficha, buscando por nombre, enlace o código;
- ve en el Inicio «Descuentos por referidos», con los que se ganaron (el negocio recomendado sigue
  activo a los 30 días);
- los marca como aplicados al cobrar.

Todo queda en la actividad.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – Código y enlace de cada negocio | Cumple | `referrals`: cada negocio tiene uno único, también los que ya existían (la 046 sobre los datos demo) |
| RF-002 – La tarjeta, sólo del propietario | Cumple | `referrals` y recorrido: los demás roles no la ven y reciben 403. El portapapeles y el WhatsApp |
| RF-003 – «Recomendado por», en la actividad | Cumple | `referrals` y recorrido: en el alta y en la ficha; nunca a sí mismo |
| RF-004 – $1,50 a los 30 días, una vez | Cumple | `referrals`: no antes de 30 días, ni con el negocio suspendido; nunca dos veces |
| RF-005 – Pendientes y «Marcar como aplicado» | Cumple | `referrals` y recorrido: un referido de hace 31 días, aplicado y en la actividad; 409 si no se ganó o ya se aplicó |
| RF-006 – Dos modos, 390 px y la beta | Cumple | Recorrido en los cuatro tamaños y modos; build y lint de la beta |
| CE-001 / CE-002 | Cumple | Las de arriba |

**Pruebas automáticas:**
- **Backend:** `npm run typecheck` sin errores, y `env -u DATABASE_URL npm test`: 61 de 61 suites,
  con 2659 ✓ y 0 ✗. La suite nueva `referrals` tiene 64.
- **Front:** build, lint y `check:contrast` sin errores.

## Cambios respecto al plan

- **El código lo genera la base** (`new_referral_code()`, default de la columna), con 6 caracteres sin
  I, O, 0 ni 1, que no se confunden al dictarlos.
- **El mensaje de WhatsApp lleva el código** del que recomendó, para encontrarlo en «Recomendado
  por». Con el registro cerrado no hay alta automática.
- **«Recomendado por» en la ficha** usa una ruta propia (`PUT /admin/businesses/:id/referred-by`) y se
  guarda al elegir.
- **«Marcar como aplicado»** queda en la actividad de la plataforma, no en la del negocio, porque
  ésa también la ven sus administradores.
- **El descuento se calcula al leer.** Si un recomendado que ya lo había ganado se suspende antes de
  que lo apliques, sale de pendientes hasta que se reactive.
- **Varios del mismo negocio se suman:** «$3,00 · 2 descuentos».
- **El monto** sale «$1,50», con coma.
- **La tarjeta** también la ve el super admin en modo soporte.
- **La beta** sólo lleva la tarjeta, con datos simulados.

## Pendientes y riesgos

- **Sin cobro automático:** el descuento lo aplicas tú al cobrar y luego lo marcas.
- **Con el registro abierto,** el código no entra solo en el alta. Hoy está cerrado.
- **Sin comprobar** que WhatsApp se abra de verdad, ni la caché de Vercel de la ruta pública. Se
  comprobó la cabecera.

## Mensaje sugerido para los clientes

> ¡Novedad en Agenda360! Ahora puedes recomendar Agenda360 a tus colegas: en Configuración → Negocio
> está tu enlace para compartir por WhatsApp. Por cada colega que se quede, te descuento $1,50 de tu
> siguiente mensualidad. Además, al final de tu página de reservas ahora aparece «Agenda online con
> Agenda360». Si tienen alguna duda, escríbanme y con gusto les ayudo.

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 6fa4c1e | Specs 022 y 023: «Hecho con Agenda360» y el programa de referidos (spec y plan, por aprobar) |
| agenda-backend | 021562d | Specs 022 y 023: tareas y constitución 1.20.0 (aprobadas) |
| agenda-front | 5fe97a9 | Constitución 1.20.0: «Hecho con Agenda360» y el programa de referidos (specs 022 y 023) |
| agenda-backend | (el de esta entrega) | Specs 022 y 023: el programa de referidos (backend) y reportes |
| agenda-front | (el de esta entrega) | Specs 022 y 023: «Hecho con Agenda360» y el programa de referidos (front) |

La beta queda actualizada, con sus copias previas `beta-src-antes-022.tgz` y `beta-src-antes-023.tgz`.

## Cómo publicarlo (las dos specs juntas)

1. **La migración 046, como paso aparte,** antes del PR del backend:

   ```
   cd ~/Documentos/Proyectos/Backend/agenda-backend
   npm run db:migrate
   ```

2. **Primero el PR del backend y después el del front.**
3. **Pon tu teléfono** en /admin → Configuración → Teléfono de soporte.
4. **Avisa a tus clientes** con el mensaje de arriba.

## Texto para el PR

Specs 022 y 023:
- **«Hecho con Agenda360»:** sale en las páginas de los pacientes. Con el registro cerrado, «Quiero mi
  agenda» abre un WhatsApp al dueño.
- **El programa de referidos:** cada negocio tiene su enlace, y hay un descuento de $1,50 por cada
  recomendado que se queda 30 días. En /admin se anota y se aplica.

**Migración:** `046_referrals.sql`, aplicada antes del backend.

Reportes:
- https://github.com/jhordan-huera/agenda-backend/blob/main/specs/022-hecho-con-agenda360/reporte.md
- https://github.com/jhordan-huera/agenda-backend/blob/main/specs/023-programa-de-referidos/reporte.md
