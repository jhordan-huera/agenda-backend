# Especificación: Páginas por especialidad

**Carpeta**: `specs/041-paginas-por-especialidad` (rama de trabajo: `dev`) · **Creada**: 2026-11-10

**Estado**: Publicada (2026-11-10, PR backend #70 y front #55). Aprobada el 2026-11-10 («acepto con lo recomendado», después de ver el prototipo de /psicologos en `prototipo/`)

**Repos**:
- **agenda-front:** las páginas, los enlaces desde la portada y el pie, el título y la descripción para compartir
  y el mapa del sitio para Google.
- **agenda-backend:** sin cambios; la spec vive aquí, como las demás.
- **La beta:** no las lleva (respuesta 3).

## Pedido

El dueño del producto, el 2026-11-10: «has lo que me recomiendas: … las páginas por especialidad». La idea
aprobada:

> Páginas por especialidad (/psicologos, /fisioterapeutas, /odontologos): cada página habla del día a día de
> esa profesión. Sirven para Google y para mandarlas en tus mensajes de WhatsApp.

**Para qué sirven:** el dueño del producto vende por WhatsApp a consultorios (psicólogos, fisioterapeutas,
odontólogos). Hoy les manda la portada, que habla a todos los negocios a la vez. Con una página de su profesión,
el interesado ve enseguida su día a día resuelto, y Google puede mostrarla a quien busca una agenda para su
especialidad.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Un profesional abre la página de su especialidad (Prioridad: P1)

**Por qué esta prioridad:** es la página en sí; con una sola especialidad publicada ya sirve para vender.

**Prueba independiente:** se abre /psicologos en el celular y en el computador, se lee completa y se llega a
«Crear cuenta» (o a «Quiero mi agenda» si el registro está cerrado).

1. **Dado** la dirección de una especialidad, **cuando** se abre, **entonces** la página tiene el estilo de la
   portada nueva y lleva:
   - un encabezado propio de esa profesión;
   - de 3 a 6 bloques con su día a día y la función de Agenda360 que lo resuelve;
   - cómo empezar;
   - preguntas frecuentes propias de esa profesión;
   - los mismos botones de la portada para empezar: «Crear cuenta» o, con el registro cerrado (spec 022),
     «Quiero mi agenda» por WhatsApp;
   - el botón **«Escríbenos por WhatsApp»**, con el WhatsApp de soporte de la plataforma y un mensaje ya escrito
     con la especialidad (respuesta 2).
2. **Dado** la página de **psicólogos**, **entonces** cuenta:
   - las reservas por enlace, sin coordinar cada horario por WhatsApp;
   - los recordatorios y «Confirmo que voy», para que falten menos;
   - las sesiones virtuales con el enlace de la videollamada en la cita;
   - las sesiones en pareja o en familia, de hasta 3 pacientes (se habilitan por negocio);
   - la historia clínica privada, con formatos de psicología;
   - las citas que se repiten cada semana;
   - el pago por transferencia con el enlace para subir el comprobante.
3. **Dado** la página de **fisioterapeutas**, **entonces** cuenta:
   - las visitas a domicilio, con la dirección y el mapa;
   - las citas que se repiten, para los planes de sesiones;
   - la historia clínica con evoluciones y archivos (radiografías, exámenes);
   - varias agendas, una por fisioterapeuta;
   - los recordatorios;
   - el pago por transferencia.
4. **Dado** la página de **odontólogos**, **entonces** cuenta:
   - la historia clínica con archivos (radiografías);
   - varias agendas (varios odontólogos o sillones);
   - los recordatorios y la confirmación del paciente;
   - la página de reservas con el mapa del consultorio;
   - el equipo con roles (recepción, profesional);
   - el pago por transferencia.
5. **Dado** cualquiera de las páginas, **entonces** NO lleva:
   - testimonios, cifras ni precios inventados;
   - nombres de clientes reales;
   - planes ni precios de Agenda360;
   - la LOPDP (sólo está en /privacidad);
   - funciones que no existen o están paradas (la sincronización con Google y la suscripción de iPhone/iPad).

### Historia 2 - Se llega a ellas y se comparten (Prioridad: P1)

**Por qué esta prioridad:** si nadie las encuentra ni se ven bien al compartirlas, no sirven para vender.

**Prueba independiente:** desde la portada se llega a las tres; al pegar el enlace en WhatsApp sale la vista
previa con el título y la descripción de esa especialidad.

1. **Dado** la portada, **entonces** tiene una fila «Para psicólogos · fisioterapeutas · odontólogos» con un
   enlace a cada página, y el pie también las enlaza.
2. **Dado** una página de especialidad, **entonces** enlaza a las otras dos y a la portada.
3. **Dado** el enlace de una página pegado en WhatsApp o en redes, **entonces** la vista previa muestra el título
   y la descripción de esa especialidad (no los de la portada).
4. **Dado** Google, **entonces** cada página tiene su propio título y descripción, y el mapa del sitio incluye la
   portada, las páginas de especialidad y /privacidad. Las páginas privadas (/pago, /cita, el panel) no entran.

Por ahora, sólo psicólogos, fisioterapeutas y odontólogos (respuesta 1). Otras especialidades se pueden añadir
después con la misma estructura.

### Casos límite

- **Una dirección con mayúsculas o tilde** (por ejemplo /Psicologos o /psicólogos): lleva a la misma página.
- **El registro cerrado** (spec 022): los botones dicen «Quiero mi agenda» y abren WhatsApp, como en la portada.
- **Celular pequeño (390 px):** sin desbordes ni texto cortado; los bloques van uno debajo del otro.
- **Modo oscuro:** con buen contraste, como la portada.
- **Quien ya tiene sesión abierta:** ve la página igual (no se le manda al panel).
- **Una especialidad que no existe** (/abogados): la página «No encontrada» de siempre.

## Requisitos *(obligatorio)*

- **RF-001**: DEBEN existir páginas públicas en /psicologos, /fisioterapeutas y /odontologos, con el estilo de la
  portada nueva y la estructura de la Historia 1.
- **RF-002**: Cada página DEBE contar las funciones que ya existen en Agenda360 con el día a día de esa profesión
  (Historia 1, escenarios 2 a 4), y NO DEBE llevar lo de la Historia 1, escenario 5.
- **RF-003**: Cada página DEBE llevar los mismos botones para empezar que la portada, también con el registro
  cerrado.
- **RF-004**: La portada y el pie DEBEN enlazar a las páginas de especialidad, y cada página DEBE enlazar a las
  demás y a la portada.
- **RF-005**: Cada página DEBE tener su propio título y descripción, que se vean en Google y en la vista previa al
  compartir el enlace por WhatsApp o en redes.
- **RF-006**: DEBE haber un mapa del sitio para Google con la portada, las páginas de especialidad y /privacidad,
  sin las páginas privadas.
- **RF-007**: Las páginas DEBEN funcionar en el celular (390 px) y en el computador, en claro y en oscuro, con
  buen contraste y sin desbordes, y cargar tan rápido como la portada.
- **RF-008**: Por ahora DEBEN existir sólo las tres páginas (psicólogos, fisioterapeutas y odontólogos).
- **RF-009**: Cada página DEBE llevar «Escríbenos por WhatsApp» con el WhatsApp de soporte de la plataforma y un
  mensaje ya escrito que diga la especialidad. Sin WhatsApp de soporte configurado, el botón NO DEBE salir.
- **RF-010**: La beta NO DEBE cambiar.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las tres páginas se abren sin errores, se leen completas y llevan a «Crear cuenta» (o a «Quiero mi
  agenda») en el computador (1440 px) y en el celular (390 px), en claro y en oscuro, sin desbordes ni errores en
  la consola, con capturas.
- **CE-002**: Al pegar el enlace de cada página en WhatsApp, la vista previa muestra su título y su descripción
  propios.
- **CE-003**: El mapa del sitio tiene las direcciones públicas y ninguna privada.
- **CE-004**: Build, lint, `check:contrast` y `check:data-export` en el front, sin errores.
- **CE-005**: Una revisión del texto de las tres páginas contra las reglas: sin testimonios, cifras ni precios
  inventados, sin nombres de clientes, sin LOPDP y sin funciones paradas.
- **CE-006**: Cada página carga en el celular en un tiempo parecido al de la portada.

## Supuestos

- **Los textos los escribe Claude** con las funciones reales de Agenda360, en el tono de la portada, y el dueño
  del producto los revisa en las capturas antes de publicar.
- **Las ilustraciones**, si las hay, siguen la regla de la portada: con datos de ejemplo y marcadas como tales.
- **Sin cambios en el backend** ni migración.
- **El nombre de cada profesión va en plural y sin tildes en la dirección** (/psicologos), para que se pueda
  dictar y escribir fácil.

## Respuestas del dueño del producto (2026-11-10)

1. **Sólo psicólogos, fisioterapeutas y odontólogos** por ahora.
2. **Sí, con «Escríbenos por WhatsApp».**
3. **La beta no las lleva.**

El prototipo de /psicologos que vio el dueño del producto está en `prototipo/` (computador y celular): la
estructura de las tres páginas sale de ahí. Sus textos son un borrador que se revisa en la implementación.
