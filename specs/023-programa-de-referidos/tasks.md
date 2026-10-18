---

description: "Tareas de «El programa de referidos»"
---

# Tareas: El programa de referidos

**Entrada**: `specs/023-programa-de-referidos/`. El dueño del producto aprobó la spec y el plan el
2026-10-18 («si aprobado»), incluido que la tarjeta del propietario muestre el descuento de $1,50:
es la excepción a «los negocios no ven precios», anotada en la constitución 1.20.0.

**Rutas:** `back/` = agenda-backend, `front/` = agenda-front y `beta/` =
~/Documentos/Proyectos/Betas/agenda-beta. Va después de la spec 022, porque usa su «Quiero mi
agenda».

## Fase 1: Base

- [x] T001 Constitución 1.20.0 en los dos repos.
- [x] T002 `back/db/migrations/046_referrals.sql`, en `businesses`:
  - `referral_code text unique not null`, de 6 caracteres (letras mayúsculas sin I ni O, y números
    del 2 al 9), generado para los que ya existen;
  - `referred_by uuid references businesses (id) on delete set null`, con
    `check (referred_by is null or referred_by <> id)`;
  - `referral_reward_applied_at timestamptz`.

  Al crear un negocio (`business-factory.ts` o donde se cree), su código. Suma las columnas a
  `back/src/db/seed.ts` si hace falta.
- [x] T003 Código compartido (`front/src`, luego `sync:shared`):
  - `REFERRAL_DISCOUNT = 1.5` y `REFERRAL_QUALIFY_DAYS = 30`;
  - los tipos `BusinessReferrals` y `ReferralReward`;
  - `referredBy` en `adminBusinessSchema`.

## Fase 2: Historia 1, el negocio recomienda (P1)

- [x] T004 [US1] `back/`: `GET /businesses/:id/referrals`, sólo para el propietario (403 a los demás
  roles), que devuelve `{ code, link, referred, qualified }`.
- [x] T005 [US1] `back/`: `GET /public/referrals/:code`, que sólo devuelve `{ name }` de un negocio
  activo (404 si no). Con `Cache-Control` público, como el perfil.
- [x] T006 [US1] `front/`: la tarjeta «Recomienda Agenda360» en Configuración → Negocio, sólo para el
  propietario. Lleva:
  - el enlace (`<portada>/?ref=<code>`) con «Copiar»;
  - «Compartir por WhatsApp», con «Te recomiendo Agenda360 para manejar tu agenda y tus reservas
    online: <enlace>»;
  - cuántos recomendó y cuántos se quedaron;
  - «Por cada colega que se quede, $1,50 menos en tu siguiente mensualidad».

  En la portada, con `?ref=<code>`, «Quiero mi agenda» (spec 022) suma «Me recomendó <negocio>».

## Fase 3: Historia 2, el dueño anota y aplica (P1)

- [x] T007 [US2] `back/`:
  - `referredBy` en el alta y la edición de negocios de /admin, con su entrada en la actividad («Anotó
    que <A> fue recomendado por <B>»);
  - un negocio no puede recomendarse a sí mismo;
  - la ficha trae `referredBy` y la lista de sus recomendados;
  - `GET /admin/referral-rewards`: los ganados y pendientes, con referido activo y 30 días o más
    desde que se creó;
  - `POST /admin/referral-rewards/:businessId/apply`: llena `referral_reward_applied_at`, con su
    entrada en la actividad de la plataforma. 409 si no se ganó o ya se aplicó.
- [x] T008 [US2] `front/` /admin:
  - el campo «Recomendado por» (un buscador de negocios) en «Nuevo negocio» y en la ficha;
  - «Descuentos por referidos» en el Inicio, con «Marcar como aplicado», confirmado en la misma
    página;
  - en la ficha, «Recomendado por» y «Recomendó a».

## Fase 4: Pruebas, beta y cierre

- [x] T009 `back/tests/referrals.test.ts` (nueva), con lo de «Pruebas» del plan, incluida la migración
  sobre los negocios que ya existían.
- [x] T010 `beta/`: copia previa (`beta-src-antes-023.tgz`); la tarjeta con datos simulados.
- [x] T011 READMEs del backend y del front.
- [x] T012 Comprobación:
  - `back/`: typecheck y todas las suites;
  - `front/`: build, lint y `check:contrast`;
  - la beta: build y lint;
  - el recorrido del plan, en los dos modos, a 1440 y a 390 px.
- [x] T013 Cierre de las dos specs (022 y 023):
  - `reporte.md`, con el mensaje para los clientes;
  - el estado;
  - los commits sin firma de IA.
