# Tareas: Portada nueva «Panel de marca»

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Rutas: `front/` = agenda-front. El backend sólo lleva la spec y la constitución. La beta no cambia.

## Fase 1: La base

- [X] T001 front/package.json: `@fontsource-variable/schibsted-grotesk`; fuera Archivo, Geist Mono e Instrument Serif. front/src/index.css: `--font-display` en lugar de `--font-wide`, `--font-tech` y `--font-accent`
- [X] T002 front/src/features/landing/landing-styles.ts, landing-ui.tsx, landing-motion.ts y landing.css: el contenedor, el panel tomate, los títulos, los botones, `SectionHeading` y `FeatureMark`; sólo la aparición de la semana al cargar

## Fase 2: La portada

- [X] T003 front/src/features/landing/brand-panel.tsx y week-preview.tsx: el panel de marca con la agenda de la semana de ejemplo (3 días en el celular)
- [X] T004 [P] landing-nav.tsx y landing-footer.tsx: la barra y el pie del estilo nuevo, con «Especialidades» (`#especialidades`)
- [X] T005 [P] feature-visuals.tsx: las ilustraciones fijas, sin etiquetas en mayúsculas y con «Ejemplo»
- [X] T006 specialties-row.tsx, features-section.tsx, data-section.tsx, faq-section.tsx y start-section.tsx con el estilo nuevo y sus mismos textos
- [X] T007 front/src/pages/landing-page.tsx: el orden de la spec; fuera feature-marquee.tsx, scroll-rail.tsx y orbit-*

## Fase 3: Las páginas por especialidad

- [X] T008 front/src/pages/specialty-page.tsx: el panel de marca con la semana con sus servicios, «Tu día a día», «Cómo empezar», «Preguntas» y el cierre, con sus mismos textos

## Fase 4: Comprobación

- [X] T009 front/scripts/check-landing.ts y `npm run check:landing`
- [X] T010 Constitución 1.42.0 en los dos repos y el README del front
- [X] T011 Front: build, lint, `check:contrast`, `check:specialties`, `check:data-export` y `check:landing`; el peso de las letras y de la portada antes y después
- [X] T012 Recorrido en Chromium a 1440 px en claro y en WebKit a 390 px en oscuro (y 320 px), con capturas de la portada y de las tres páginas por especialidad
