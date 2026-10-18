# Plan de implementación: «Hecho con Agenda360»

**Rama**: `dev` · **Fecha**: 2026-10-18 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **`MadeWithAgenda360`,** un componente nuevo en `components/shared/made-with.tsx`:
   - texto pequeño, `text-muted-foreground`;
   - el enlace va a `/?desde=<slug>`, en otra pestaña (`rel="noopener"`);
   - se pone al final de `booking-page.tsx`, con todos sus pasos y el éxito, de `payment-page.tsx` y de
     `appointment-page.tsx`.
2. **La portada** (`landing-page.tsx`, `hero-section.tsx`, `cta-section.tsx` y `landing-navbar.tsx`):
   - lee la configuración pública que ya usa el registro: `allowPublicSignup`, `supportPhone` y
     `supportEmail`;
   - con el registro cerrado, cada «Crear cuenta» pasa a «Quiero mi agenda», que abre
     `getSupportWhatsAppUrl(phone, mensaje)` o, sin teléfono, `mailto:` al email de soporte;
   - el mensaje nombra el negocio si llega `?desde=<slug>`. El nombre se pide con la ruta pública del
     perfil del negocio, que ya existe y está en la CDN.
3. **La ruta `/register`** con el registro cerrado suma el mismo botón «Quiero mi agenda» bajo su aviso.
4. **La beta:** los mismos cambios. Su configuración simulada trae un teléfono de ejemplo.
5. **Constitución** (MENOR), en el principio III: «Las páginas de los pacientes llevan siempre «Hecho
   con Agenda360»; con el registro cerrado, la portada lleva al WhatsApp del dueño (2026-10-18)».

**Sin migración ni variables.** El dueño pone su teléfono en /admin → Configuración.

## Pruebas

- **Front:** build, lint y `check:contrast`.
- **El recorrido,** en claro y en oscuro, a 1440 y a 390 px:
  - el pie en las tres páginas;
  - el enlace abre la portada con `?desde`;
  - con el registro cerrado, «Quiero mi agenda» arma el WhatsApp con el negocio;
  - sin teléfono, el `mailto:`;
  - con el registro abierto, «Crear cuenta».
- **Beta:** build y lint.
