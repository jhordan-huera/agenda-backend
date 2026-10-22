# Especificación: La portada al estilo de una plataforma de ventas

**Carpeta**: `specs/032-portada-crm` (rama de trabajo: `dev`) · **Creada**: 2026-10-22

**Estado**: Implementada (2026-10-22)

**Repos**:
- **agenda-front:** la portada (`/`). El acceso (login y registro) no cambia.
- **La beta:** la misma portada, como en la spec 030 (valor por defecto; confirmar al aprobar).
- **agenda-backend:** no se toca. No hay migración.

## Pedido

El dueño del producto, el 2026-10-22, pegó este encargo:

> «Design a professional sales CRM landing page with feature-rich showcase, pipeline visualization preview,
> integration logos, customer success stories, and free trial CTA. Use trust colors.»

Junto con él: «dame adaptando este sistema a esto, utiliza REA», con el ejemplo
https://uupm.cc/demo/sales-crm-platform.

**El ejemplo, leído con REA (2026-10-22):**
1. La barra flotante.
2. Los sellos: «SOC 2», «4.9/5 en G2» y «10.000+ equipos».
3. El titular, con la segunda línea en azul, y el botón naranja de la prueba gratis.
4. La captura del panel.
5. Cuatro cifras.
6. El tablero del embudo de ventas por etapas.
7. Seis funciones.
8. La sección de IA.
9. Los logos de las integraciones y tres testimonios con nombre y foto.
10. La llamada final y el pie con sellos.

Los colores son azul de confianza con el naranja para la acción.

**Sus decisiones (2026-10-22):**
1. **Testimonios:** uno **real, con el permiso de la clienta** que dio 10/10. Hasta que lo autorice, la
   sección no sale. Nada de testimonios inventados.
2. **Integraciones:** **sólo las reales**, con su nombre e iconos propios, sin logos oficiales:
   - Google Calendar, el Calendario del iPhone y Outlook (las invitaciones de la spec 027);
   - WhatsApp (el enlace de reservas y los avisos);
   - Excel (importar pacientes).
3. **El botón principal, naranja,** como el ejemplo. Es la única excepción a la gama azul: sólo en la
   portada y sólo para «Crear mi agenda gratis». Cambia lo que se decidió en la spec 030 («un solo acento»).
4. **Los sellos, reales:** «Hecho en Ecuador», «Datos protegidos según la LOPDP» y «Tus pacientes no crean
   cuenta».

Siguen vigentes:
- **Sin precios ni cifras inventadas.**
- **Agenda360 no tiene prueba de 14 días:** tiene un plan gratis.
- **Agenda360 no tiene IA,** así que esa sección no se copia.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Un profesional ve una plataforma seria y completa (Prioridad: P1)

**Escenarios de aceptación**:

1. **Dado** la portada, **entonces** se ve, en este orden:
   1. **La barra flotante:** Funciones, Cómo avanza una cita, Funciona con, Preguntas, «Iniciar sesión» y
      «Crear mi agenda gratis» (naranja).
   2. **El encabezado centrado:**
      - los tres sellos reales;
      - «Tus pacientes eligen su hora. / Tú solo atiendes.», con la segunda línea en el azul de la marca,
        sin degradado;
      - la frase de apoyo;
      - «Crear mi agenda gratis» (naranja) y «Probar una página de reservas»;
      - «Gratis para empezar · Sin tarjeta».
   3. **La vista del panel:** la semana de la Agenda con un aviso de reserva nueva y «Datos de ejemplo».
   4. **Una franja de hechos reales,** sin porcentajes inventados: «24/7 Reservas online», «0 cuentas para
      tus pacientes», «1 enlace para WhatsApp» y «LOPDP Datos protegidos».
   5. **«Cada cita, de la reserva al cobro»:** el flujo de una cita en cuatro columnas (Por confirmar,
      Confirmadas, Atendidas y Pagadas), con citas de ejemplo y su cifra. Al lado, tres funciones:
      - «Confirmo que voy»;
      - los recordatorios;
      - «Por cerrar».

      Es una ilustración del flujo, no una pantalla de la app, y lo dice.
   6. **Las seis funciones:**
      - la historia clínica privada;
      - las citas en el calendario del celular;
      - el cobro por transferencia;
      - las clínicas con varias agendas;
      - los reportes;
      - la descarga de los datos.
   7. **«Lo repetitivo, en automático»:** en lugar de la IA, los recordatorios, los emails al paciente con
      copia al profesional y los avisos por WhatsApp, con una vista del email de recordatorio.
   8. **«Funciona con»:** las cinco integraciones reales.
   9. **El testimonio real,** sólo si está autorizado.
   10. **Las preguntas frecuentes** de la spec 030.
   11. **La llamada final** sobre azul marino, con el botón naranja.
   12. **El pie,** con sus columnas y los sellos.
2. **Dado** cualquier enlace de antes (crear la agenda, la página de reservas de ejemplo, iniciar sesión, la
   privacidad, el contacto por WhatsApp o email con el código de referido), **entonces** sigue funcionando
   igual.

### Casos límite

- **Sin testimonio autorizado,** la sección no aparece, y tampoco su enlace.
- **Con el registro cerrado,** el botón naranja es «Quiero mi agenda» (spec 022).
- **Contraste:** el texto del botón naranja cumple 4,5:1 en claro y en oscuro.
- **Pantallas y accesibilidad:**
  - a 390 px todo se apila y no hay desplazamiento horizontal; las columnas del flujo se deslizan dentro
    de su caja, nunca la página;
  - con «reducir movimiento», sin animaciones;
  - con el teclado, el foco se ve.

## Requisitos *(obligatorio)*

- **RF-001**: La portada DEBE seguir la estructura del ejemplo adaptada a Agenda360 (Historia 1), en azul y azul marino, con el naranja sólo en el botón principal.
- **RF-002**: NO DEBE haber cifras, sellos, testimonios ni integraciones que no sean reales.
- **RF-003**: El testimonio sale sólo con un texto autorizado por la clienta y, si no, no se muestra.
- **RF-004**: Todo lo que hacía la portada (enlaces, contacto, referidos, registro cerrado) DEBE seguir igual.
- **RF-005**: En claro y oscuro, a 1440 y 390 px: contraste 4,5:1, foco visible y movimiento reducido.
- **RF-006**: La beta DEBE llevar la misma portada.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Build, lint y la revisión de contraste pasan, y el recorrido no encuentra desplazamiento horizontal ni enlaces rotos.
- **CE-002**: El dueño del producto la aprueba con las capturas antes de guardarla.

## Supuestos

- **La spec 030 aún no está publicada.** Esta portada reemplaza la suya; el acceso de la 030 se queda.
- **El testimonio** lo consigue el dueño del producto: el texto, el nombre y la especialidad que la clienta
  autorice. Se añade después con un cambio pequeño.
- **Las integraciones** se nombran por lo que hacen («Tus citas en Google Calendar»), con iconos propios. No
  se dice «integración oficial» ni se usan los logos de las marcas.
