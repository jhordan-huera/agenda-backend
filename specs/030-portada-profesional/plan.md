# Plan de implementación: Una portada más profesional

**Rama**: `dev` · **Fecha**: 2026-10-21 · **Spec**: [spec.md](./spec.md)

## Diseño

1. **Antes de escribir cada componente,** el control de interface-design:
   - la intención, la jerarquía, la paleta, la profundidad, las superficies, la tipografía y el
     espaciado, cada uno con su porqué;
   - un solo foco por sección;
   - la escala tipográfica por proporción (~1,25), con la jerarquía por peso y color;
   - una sola estrategia de profundidad: sombras sutiles en capas sobre fondos cálidos;
   - los colores, de los tokens de la marca. Nada de hex sueltos ni de `gray-*`.
2. **Las secciones,** en `front/src/features/landing/`. Se reutilizan los componentes que sirvan
   (`hero-agenda`, `phone-booking`, `section-heading`, `signup-link`, `use-signup-contact` y
   `product-facts`), y se quitan los que queden sin uso. Los textos, en el español de la app:
   - **la barra superior,** sin efecto de vidrio, con borde al desplazarse;
   - **la portada,** en dos columnas que se apilan en el celular;
   - **para quién;**
   - **cómo funciona,** alternado;
   - **lo que distingue a Agenda360,** en bloques de distinto tamaño, con trozos reales de la app (el
     candado de la historia clínica, el gráfico del PHQ-9, «Confirmo que voy», la invitación de
     calendario, el comprobante y la descarga);
   - **las preguntas frecuentes,** con `<details>` nativo;
   - **la llamada final;**
   - **el pie de página.**
3. **El tema:** los tokens de `index.css` y del tema de la marca. Se revisa cómo resuelve hoy la portada
   el modo oscuro, y se hace que respete el del sistema.
4. **Lo que no cambia:** las rutas, los botones de alta, el contacto, el referido (`?ref=`) y la
   página de reservas de ejemplo.

**Migración:** ninguna. **Backend:** nada.

## Pruebas

- **Front:** build, lint y `check:contrast`.
- **El recorrido** en Chromium a 1440 px y WebKit a 390 px, claro y oscuro:
  - cada sección visible;
  - sin desplazamiento horizontal;
  - los enlaces de alta, el de reservas de ejemplo, el de iniciar sesión y el de privacidad;
  - el foco con el teclado;
  - con movimiento reducido.
- **La revisión de diseño** con interface-design (design-review) y la lista de UI UX Pro Max (sin emojis
  como iconos, cursor en lo que se toca, estados hover y foco, 4,5:1, movimiento reducido, y 375, 768,
  1024 y 1440 px).
- **La beta:** se copia la portada y se corre `npm run build`.

## Publicación

Sólo el front y, aparte, la beta.
