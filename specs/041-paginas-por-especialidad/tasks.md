# Tareas: Páginas por especialidad

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `front/` = agenda-front. El backend no cambia.

## Fase 1: Los textos y la página

- [ ] T001 front/src/features/landing/specialties.ts: las tres especialidades (dirección, título y descripción para Google y para compartir, encabezado, 6 casillas con su ilustración, 3 pasos, preguntas y mensaje de WhatsApp)
- [ ] T002 [P] front/src/features/landing/feature-visuals.tsx: la ilustración de la visita a domicilio (datos de ejemplo)
- [ ] T003 front/src/pages/specialty-page.tsx: la página del prototipo con los datos de la especialidad; «Escríbenos por WhatsApp» con el WhatsApp de soporte (sin él, no sale); front/src/features/landing/landing-nav.tsx: las secciones de cada página
- [ ] T004 front/src/app/router.tsx: `/psicologos`, `/fisioterapeutas`, `/odontologos` y las direcciones con tilde que llevan a ellas

## Fase 2: Enlaces, Google y compartir

- [ ] T005 [P] La fila «Hecho para…» en la portada y la columna «Especialidades» en el pie
- [ ] T006 El HTML de cada especialidad al compilar (título, descripción, `og:title`, `og:description`, `og:url`) y su regla en front/vercel.json; front/public/sitemap.xml y robots.txt
- [ ] T007 front/scripts/check-specialties.ts y `npm run check:specialties` (sin LOPDP, precios, testimonios ni funciones paradas; títulos, descripciones y mensajes; el mapa del sitio)
- [ ] T008 Constitución en los dos repos: las páginas por especialidad con las reglas de la portada

## Fase 3: Comprobación

- [ ] T009 front: build, lint, `check:contrast`, `check:data-export` y `check:specialties`; las etiquetas de cada HTML del build
- [ ] T010 Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro, con capturas de las tres páginas para que el dueño del producto revise los textos
