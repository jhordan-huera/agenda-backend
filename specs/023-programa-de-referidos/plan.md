# Plan de implementación: El programa de referidos

**Rama**: `dev` · **Fecha**: 2026-10-18 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **Migración 046** (`046_referrals.sql`), en `businesses`:
   - `referral_code text unique`, de 6 caracteres, generado para los negocios que ya existen y al crear
     uno;
   - `referred_by uuid references businesses (id) on delete set null`, con
     `check (referred_by <> id)`;
   - `referral_reward_applied_at timestamptz`, que se llena cuando el dueño aplica el descuento de
     ese referido.
2. **La regla** (compartida): `REFERRAL_DISCOUNT = 1.5` (USD) y `REFERRAL_QUALIFY_DAYS = 30`. Una
   recomendación «se queda» si el negocio recomendado está activo y tiene 30 días o más.
3. **La API:**
   - `GET /businesses/:id/referrals`, sólo para el propietario: `{ code, link, referred, qualified }`.
   - `adminBusinessSchema` suma `referredBy`, y el alta y la edición de /admin lo guardan con su
     entrada en la actividad.
   - `GET /admin/referral-rewards`: los descuentos ganados y pendientes, con quién, a quién, desde
     cuándo y el monto.
   - `POST /admin/referral-rewards/:businessId/apply`: marca el descuento aplicado, con su entrada en
     la actividad de la plataforma.
   - La ficha del negocio en /admin trae `referredBy` y la lista de recomendados.
4. **La portada:** con `?ref=<code>` (o `?desde=<slug>`, de la spec 022), «Quiero mi agenda» arma
   «Me recomendó <negocio>». El nombre sale de una ruta pública mínima, `GET
   /public/referrals/:code`, que sólo devuelve el nombre del negocio activo, con caché en la CDN.
5. **El front:**
   - la tarjeta «Recomienda Agenda360» en Configuración → Negocio, sólo para el propietario;
   - en /admin, el campo «Recomendado por» (un buscador de negocios) en el alta y la ficha;
   - la lista «Descuentos por referidos» en el Inicio de /admin, junto a «Negocios para vender».
6. **La beta:** la tarjeta con datos simulados.
7. **Constitución** (MENOR), en el principio III: el programa de referidos, con su premio y sus reglas.

**Migración:** 046. **Variables:** ninguna.

## Pruebas

**Backend** (`tests/referrals.test.ts`, nueva):
- **Códigos:** cada negocio tiene uno único, también los que ya existían.
- **La tarjeta:** el propietario ve sus cifras; los demás roles reciben 403.
- **«Recomendado por»:**
  - el super admin lo anota y lo cambia, y queda en la actividad;
  - un negocio no puede recomendarse a sí mismo.
- **El descuento:**
  - no se gana antes de 30 días ni si el negocio está suspendido;
  - se gana a los 30 días si sigue activo;
  - marcarlo aplicado lo saca de pendientes y queda en la actividad;
  - nunca se repite.
- **La ruta pública** sólo da el nombre de un negocio activo.

**Front:**
- build y lint;
- el recorrido, en los dos modos y a 390 px:
  - la tarjeta: copiar y compartir;
  - la portada con `?ref`;
  - el alta con «Recomendado por»;
  - la lista de descuentos y «Marcar como aplicado».

**Beta:** build y lint.

## Publicación

1. **La migración 046,** como paso aparte, antes del backend.
2. **Primero el backend y después el front.**
3. **Avisar a los clientes del programa,** con el mensaje del reporte.
