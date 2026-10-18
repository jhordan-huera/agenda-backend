---

description: "Tareas de «Hecho con Agenda360»"
---

# Tareas: «Hecho con Agenda360»

**Entrada**: `specs/022-hecho-con-agenda360/`. El dueño del producto aprobó la spec y el plan el
2026-10-18 («si aprobado»).

**Rutas:** `front/` = agenda-front y `beta/` = ~/Documentos/Proyectos/Betas/agenda-beta.

- [x] T001 Constitución 1.20.0 en los dos repos (principio III).
- [ ] T002 [US1] `front/src/components/shared/made-with.tsx` (nuevo):
  - el texto es «Agenda online con Agenda360 · ¿Eres profesional? Crea tu agenda», pequeño y con
    tokens;
  - el enlace va a `/?desde=<slug>`, en otra pestaña (`target="_blank" rel="noopener"`);
  - va al final de `booking-page.tsx` (con todos sus pasos y el éxito), de `payment-page.tsx` y de
    `appointment-page.tsx`.
- [ ] T003 [US2] La portada (`landing-page.tsx`, `hero-section.tsx`, `cta-section.tsx` y
  `landing-navbar.tsx`), con la configuración pública que ya usa `register-page.tsx`:
  - **con el registro cerrado,** cada «Crear cuenta» pasa a «Quiero mi agenda»:
    - con teléfono de soporte, `getSupportWhatsAppUrl` y el mensaje «Hola, quiero mi agenda en
      Agenda360»; con `?desde=<slug>`, «Hola, vi la página de reservas de <negocio> y quiero mi agenda
      en Agenda360». El nombre sale de la ruta pública del perfil, que ya está en la CDN;
    - sin teléfono, `mailto:` al email de soporte con el mismo texto;
  - **con el registro abierto,** todo sigue como hoy;
  - la página `/register` con el registro cerrado suma el mismo botón bajo su aviso.

  Deja una función reutilizable (por ejemplo, `useSignupContact()`) para que la spec 023 sume
  «Me recomendó <negocio>».
- [ ] T004 `beta/`: copia previa (`beta-src-antes-022.tgz`); los mismos cambios; en su configuración
  simulada, un teléfono de ejemplo.
- [ ] T005 README del front.
- [ ] T006 Comprobación:
  - build, lint y `check:contrast` del front, y build y lint de la beta;
  - el recorrido del plan, en claro y en oscuro, a 1440 y a 390 px.
