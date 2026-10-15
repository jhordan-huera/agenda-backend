# Especificación: Centro de avisos en el panel

**Carpeta**: `specs/014-centro-de-avisos` (rama de trabajo: `dev`)

**Creada**: 2026-10-15

**Estado**: Aprobada (2026-10-15)

**Repos**: agenda-backend (principal: guardar los avisos de cada persona, a quién le toca cada uno, el
contador, marcar leído y el borrado a los 30 días) y agenda-front (la campana, la lista y la página
«Avisos», en el panel del negocio y en /admin). La beta, con avisos de prueba.

## Pedido

El dueño del producto pidió el 2026-10-15, al probar las specs 010 a 013: «dentro del panel del
profesional tiene que haber una parte donde muestre las notificaciones». Hoy los avisos de la spec
013 sólo llegan al celular de quien los activó, sólo al propietario y al super admin, y en el panel no
hay dónde verlos.

**Decisiones del dueño del producto (2026-10-15):**
1. **Quién: todo el equipo, cada uno lo suyo.**
   - El propietario ve todo su negocio.
   - El rol Profesional ve sólo lo de su agenda.
   - Recepción y los administradores ven las reservas online, los comprobantes, las confirmaciones y
     las cancelaciones del paciente de todas las agendas.
   - Las citas por cerrar y el resumen de las 8 de la noche van al propietario (todo el negocio) y al
     profesional de esa agenda (sólo las suyas).
   - «Cita nueva en tu agenda» va al profesional de esa agenda (también si es el propietario), nunca a
     quien la agendó.
2. **Cómo se ve: una campana con lista.** La campana, con el número de avisos sin leer, va en el menú
   lateral (computadora) y en la barra de arriba (celular). Abre una lista con los últimos 20, y
   «Ver todos» lleva a una página con los de los últimos 30 días.
3. **El super admin también tiene su campana en /admin,** con sus cuatro avisos.
4. **El paciente, con su nombre completo** («Juan Pérez»): el equipo ya lo ve así en la agenda, y con
   muchos pacientes «Juan P.» se confunde. El celular y ntfy siguen a medias.
5. **Leer un aviso no va a la actividad:** es una consulta de la propia persona, como mirar la agenda.
6. **La beta también lleva la campana,** con avisos de prueba, para las demostraciones de venta.

### Qué le llega a cada uno

| Aviso | Propietario | Profesional | Recepción y administradores |
|---|---|---|---|
| Nueva reserva (también «Por verificar») | Todas | Las de su agenda | Todas |
| Comprobante de pago | Todos | Los de su agenda | Todos |
| El paciente confirmó | Todas | Las de su agenda | Todas |
| Cita cancelada por el paciente | Todas | Las de su agenda | Todas |
| Cita nueva en tu agenda (la agendó otra persona) | Las de su agenda | Las de su agenda | — |
| Cita por cerrar | Todas | Las de su agenda | — |
| Resumen de las 8 de la noche | Del negocio | De su agenda | — |

El super admin, en /admin, recibe:
- un negocio nuevo;
- una solicitud de cambio de plan;
- un cambio de seguridad en una cuenta de super admin;
- una alerta de intentos fallidos de inicio de sesión.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - La campana con lo nuevo (Prioridad: P1)

El propietario entra al panel y la campana dice cuántos avisos tiene sin leer. Al tocarla ve qué pasó
y desde ahí abre la cita.

**Por qué esta prioridad**: es el pedido. Quien no activó los avisos en el celular, o lo tiene
apagado, se entera igual al entrar al panel.

**Prueba independiente**: hacer una reserva online con el panel abierto y verla aparecer en la
campana, abrirla y que quede leída.

**Escenarios de aceptación**:

1. **Dado** el panel, **entonces** la campana está en el menú lateral (computadora) y en la barra de
   arriba (celular), con el número de avisos sin leer («9+» si son más de 9). Sin avisos sin leer, no
   lleva número.
2. **Dado** que se toca la campana, **entonces** se abre la lista con los últimos 20:
   - el título y el texto de los del celular, pero con el nombre completo del paciente («Nueva
     reserva · Mañana 16:00 · Limpieza · Juan Pérez»);
   - hace cuánto («hace 5 min», «ayer»);
   - los no leídos, resaltados.
3. **Dado** un aviso de la lista, **entonces** al tocarlo se abre lo que corresponde (la cita en la
   agenda, la agenda del día para el resumen) y queda leído.
4. **Dado** «Marcar todo como leído», **entonces** la campana queda sin número.
5. **Dado** el panel abierto, **entonces** un aviso nuevo aparece sin recargar:
   - al momento, si ese navegador tiene activados los avisos en el celular;
   - si no, al volver a la pestaña o en pocos minutos.
6. **Dado** una persona sin avisos, **entonces** la lista dice «No tienes avisos» y explica qué
   aparecerá ahí.

---

### Historia 2 - Cada uno ve lo suyo (Prioridad: P1)

Recepción, los administradores y cada profesional tienen su campana, con lo que les toca según la
tabla de arriba.

**Por qué esta prioridad**: lo decidió el dueño: el equipo también necesita enterarse, pero un
profesional no debe ver lo de las otras agendas.

**Prueba independiente**: con una clínica de varias agendas, hacer una reserva en la agenda de un
profesional y comprobar quién la ve en su campana y quién no.

**Escenarios de aceptación**:

1. **Dado** una reserva online en la agenda de la Dra. Cruz, **entonces** la ven en su campana:
   - el propietario;
   - Recepción;
   - los administradores;
   - la Dra. Cruz.

   Los otros profesionales no la ven.
2. **Dado** que Recepción le agenda una cita a la Dra. Cruz, **entonces** a ella le llega «Cita nueva
   en tu agenda». A Recepción no le llega, porque la agendó ella.
3. **Dado** una cita de la Dra. Cruz que terminó hace 30 minutos sin cerrar, **entonces** «Cita por
   cerrar» les llega a ella y al propietario, no a Recepción.
4. **Dado** las 8 de la noche, **entonces**:
   - el propietario recibe el resumen del negocio;
   - cada profesional recibe el de su agenda, si le quedan citas sin cerrar.
5. **Dado** que una persona lee un aviso, **entonces** sigue sin leer para las demás: cada una lleva
   el suyo.

---

### Historia 3 - La página «Avisos» (Prioridad: P2)

«Ver todos» abre una página con los avisos de los últimos 30 días, agrupados por día.

**Por qué esta prioridad**: la lista de la campana sólo tiene los últimos 20. Para buscar uno de la
semana pasada hace falta la página.

**Escenarios de aceptación**:

1. **Dado** «Ver todos», **entonces** la página muestra los de los últimos 30 días, del más nuevo al
   más viejo, agrupados por día («Hoy», «Ayer», «Mar 13 oct»), con «Cargar más» si son muchos.
2. **Dado** la página, **entonces** se puede ver «Sólo los no leídos» y «Marcar todo como leído».
3. **Dado** un aviso de hace más de 30 días, **entonces** ya no aparece.

---

### Historia 4 - El super admin tiene la suya (Prioridad: P2)

**Escenarios de aceptación**:

1. **Dado** /admin, **entonces** el super admin tiene su campana con sus cuatro avisos.
2. **Dado** cada aviso, **entonces** al tocarlo se abre la pantalla de /admin que corresponde.
3. **Dado** ntfy y los avisos al celular, **entonces** siguen igual: la campana se suma.

---

### Casos límite

- **Super admin en modo soporte:** no ve la campana del negocio ni la marca como leída: es del
  equipo. Sus avisos están en /admin.
- **Negocio sin propietario:** Recepción, los administradores y los profesionales reciben lo suyo.
- **Alguien deja el equipo:** deja de recibir avisos, y los que tenía se borran.
- **Alguien cambia de rol** (por ejemplo, de Recepción a Profesional): desde ese momento recibe lo de
  su rol nuevo. La campana sólo le muestra lo que su rol de hoy le deja ver.
- **El propietario cambia:** el anterior deja de recibir los avisos del negocio.
- **Se borra el paciente o la cita:** sus avisos desaparecen de todas las campanas.
- **Negocio suspendido:** no genera avisos.
- **Profesional con «sólo sus pacientes»:** ve sólo su agenda, como en el resto del panel.
- **Muchas reservas a la vez:** un aviso por cada una. No se agrupan en esta versión.
- **Avisos de antes de esta función:** la campana empieza vacía. Lo que ya pasó no se reconstruye.
- **Avisos apagados en el celular:** los interruptores de «Avisos en este celular» sólo cuentan para
  el celular. La campana muestra todo lo que le toca a esa persona.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: El panel del negocio y /admin DEBEN tener una campana con el número de avisos sin leer,
  en el menú lateral (computadora) y en la barra de arriba (celular).
- **RF-002**: Cada aviso DEBE llegar a las personas que dice la tabla «Qué le llega a cada uno», y a
  nadie más.
- **RF-003**: Los avisos DEBEN llegar a la campana aunque la persona no haya activado los avisos en
  el celular, o los tenga apagados.
- **RF-004**: La lista de la campana DEBE mostrar los últimos 20 avisos, con su título, su texto, hace
  cuánto y si está leído. Al tocar un aviso se DEBE abrir lo que corresponde y quedar leído.
- **RF-005**: DEBE haber «Marcar todo como leído», y cada persona DEBE llevar su propio estado de
  leído.
- **RF-006**: La página «Avisos» DEBE mostrar los de los últimos 30 días, agrupados por día, con «Sólo
  los no leídos».
- **RF-007**: Los avisos de más de 30 días DEBEN borrarse solos.
- **RF-008**: Con el panel abierto, un aviso nuevo DEBE aparecer sin recargar: al momento si ese
  navegador recibe los avisos del celular, y si no, al volver a la pestaña o en pocos minutos.
- **RF-009**: Los avisos de la campana DEBEN llevar el nombre completo del paciente («Juan Pérez»),
  porque están dentro del panel. Nunca su cédula, su email, su teléfono ni nada de la historia
  clínica. Los del celular y ntfy siguen a medias.
- **RF-010**: La campana DEBE mostrar sólo lo que el rol de hoy de esa persona le deja ver. Quien deja
  el equipo pierde sus avisos. Si se borra el paciente o la cita, sus avisos desaparecen.
- **RF-011**: Si guardar un aviso falla, la reserva, la cita, los emails y los avisos al celular DEBEN
  seguir igual.
- **RF-012**: Leer un aviso o marcarlo como leído NO DEBE ir a la actividad: es una consulta de la
  propia persona. Crear los avisos tampoco, porque es automático; lo que los provoca (la reserva, la
  cita…) ya queda registrado.
- **RF-013**: La beta DEBE tener la campana, la lista y la página «Avisos», con avisos de prueba al
  cargar la demo. Cada reserva, confirmación o cancelación que se haga en la demo suma su aviso.

### Entidades clave

- **Aviso del panel**:
  - para quién es (una persona del equipo, o el super admin);
  - de qué negocio y de qué cita o pantalla;
  - su título y su texto;
  - cuándo se creó;
  - si esa persona ya lo leyó.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Con el panel abierto, una reserva online aparece en la campana en menos de 3 minutos.
  Si ese navegador tiene los avisos del celular, en menos de 30 segundos.
- **CE-002**: En una clínica con varias agendas, cada rol ve exactamente lo de la tabla, y nadie ve
  avisos de otra agenda que no le toque (comprobado en pruebas con los cuatro roles).
- **CE-003**: Ningún aviso muestra la cédula, el email, el teléfono ni datos clínicos (comprobado en
  pruebas).
- **CE-004**: Abrir el panel no tarda más que hoy de forma apreciable: el número de la campana
  aparece junto con el resto del panel.
- **CE-005**: Las pruebas pasan, y la campana, la lista y la página se usan sin desplazamiento
  horizontal a 390 px.

## Supuestos

- **El celular y ntfy no cambian.** Recepción, los administradores y el rol Profesional siguen sin
  avisos al celular, por la decisión de la spec 013. Se podría ampliar después.
- **Sin email ni sonido:** la campana es sólo en el panel.
- **30 días** de historial, como la ventana de «Tu cita» de la spec 010.
- **Se actualiza sin conexión abierta todo el tiempo,** para no gastar la CPU de Vercel: al abrir el
  panel, al volver a la pestaña y cada pocos minutos.
- **Constitución:** al aprobar el plan se amplía a 1.10.0 en los dos repos, con quién recibe qué en
  la campana.
