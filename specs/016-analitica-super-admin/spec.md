# Especificación: Analítica del super admin

**Carpeta**: `specs/016-analitica-super-admin` (rama de trabajo: `dev`)

**Creada**: 2026-10-15

**Estado**: Publicada (2026-10-15, PR backend #32 y front #27)

**Repos**:
- **agenda-backend:** los cálculos, su preparación diaria y la ruta.
- **agenda-front:** la página «Analítica» de /admin.
- **La beta:** no (decisión del dueño: la analítica es una herramienta suya, no de las demostraciones).

## Pedido

El dueño del producto pidió el 2026-10-15 «agregar una analítica al panel de super admin… datos
comparativos entre negocios, enriquecedores y que me generen valor». De los cuatro bloques propuestos,
eligió los cuatro:
- **A. Tabla comparativa** de todos los negocios.
- **B. Promedios por tipo de negocio,** y cada negocio frente a su tipo.
- **C. Riesgo de abandono y oportunidades de venta.**
- **D. Uso de funciones y valor generado.**

Hoy el Inicio del super admin (spec 006) tiene lo esencial: el crecimiento del mes, la salud del
sistema y «Negocios para vender» (cerca del límite, crecen, inactivos). La analítica va más allá, sin
repetir lo que ya está ahí: compara negocios, los sitúa frente a su tipo, dice a quién llamar y qué
valor les da Agenda360.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Comparar los negocios en una tabla (Prioridad: P1)

En /admin → «Analítica» → «Comparar», el super admin ve todos los negocios con sus cifras del periodo
y los ordena por la que le interese.

**Por qué esta prioridad**: es la base de los demás bloques y lo que más pidió el dueño: comparar
negocios.

**Prueba independiente**: con varios negocios de prueba de distinto tamaño, ordenar por «%
inasistencias» y comprobar las cifras de dos negocios a mano.

**Escenarios de aceptación**:

1. **Dado** la pestaña «Comparar», **entonces** cada negocio tiene en el periodo:
   - las citas, y el crecimiento frente al periodo anterior;
   - el % de reservas online, el % de inasistencias, el % de cancelaciones y el % de citas confirmadas
     por el paciente;
   - los pacientes activos (con alguna cita en el periodo) y los nuevos;
   - los ingresos estimados (el precio de las citas completadas) y lo cobrado (lo marcado como pagado);
   - el ticket promedio;
   - el uso del plan (citas y pacientes frente al tope);
   - las agendas y el último acceso del equipo.
2. **Dado** una columna, **entonces** se ordena por ella al tocarla, de mayor a menor y al revés.
3. **Dado** los filtros, **entonces** se filtra por tipo de negocio, por plan y por estado (por defecto,
   sólo los activos), y se busca por nombre.
4. **Dado** «Exportar», **entonces** se descarga la tabla tal como se ve, en CSV.
5. **Dado** un negocio de la tabla, **entonces** al tocarlo se abre su ficha en /admin.
6. **Dado** un negocio con menos de 10 citas en el periodo, **entonces** sus porcentajes llevan la
   marca «pocos datos».

---

### Historia 2 - Cada tipo de negocio y cada negocio frente a su tipo (Prioridad: P1)

En «Por tipo de negocio», el super admin ve cómo le va a cada tipo (Odontología, Psicología…), y en la
tabla y en la ficha, cómo está cada negocio frente a su tipo.

**Por qué esta prioridad**: da argumentos de venta y de seguimiento: «sus inasistencias son el doble
que las de su rubro».

**Escenarios de aceptación**:

1. **Dado** la pestaña, **entonces** cada tipo muestra:
   - cuántos negocios tiene;
   - el valor típico (la mediana) de inasistencias, cancelaciones, reservas online, confirmaciones del
     paciente, ticket promedio y citas por agenda;
   - los días y horas de más demanda.
2. **Dado** un negocio en la tabla o en su ficha, **entonces** cada tasa dice también la de su tipo
   («25 % · su tipo, 12 %»), resaltada si está muy por encima o muy por debajo.
3. **Dado** un tipo con menos de 3 negocios con datos suficientes, **entonces** sus promedios dicen
   «pocos datos» y no se usan para comparar.

---

### Historia 3 - Riesgo de abandono y oportunidades de venta (Prioridad: P1)

En «Salud y ventas», el super admin ve quién está por irse, con los motivos, y quién está listo para
subir de plan.

**Por qué esta prioridad**: retener a un negocio vale más que conseguir uno nuevo, y las oportunidades
de venta están en los datos.

**Escenarios de aceptación**:

1. **Dado** cada negocio, **entonces** tiene una puntuación de salud de 0 a 100 y un grupo: sano, en
   riesgo o crítico.
2. **Dado** la puntuación, **entonces** muestra sus motivos en palabras, por ejemplo:
   - «nadie del equipo entra hace 12 días»;
   - «citas −40 % frente al periodo anterior»;
   - «12 citas sin cerrar»;
   - «sin reservas online».
3. **Dado** la lista «En riesgo», **entonces** salen primero los críticos, con el teléfono del
   propietario para llamarlo.
4. **Dado** la lista «Listos para subir de plan», **entonces** salen los que están cerca del tope, los
   que crecen rápido, los que usan mucho las funciones o los que tienen mucha demanda, con el motivo.
5. **Dado** «Negocios para vender» del Inicio, **entonces** sigue igual. La analítica lo amplía, sin
   repetirlo con otros criterios.

---

### Historia 4 - Uso de funciones y valor generado (Prioridad: P2)

En «Uso y valor», el super admin ve qué funciones usa cada negocio y qué le aporta Agenda360.

**Por qué esta prioridad**: muestra a quién enseñarle una función que no usa y da cifras para retener
y para vender.

**Escenarios de aceptación**:

1. **Dado** cada negocio, **entonces** se ve qué funciones usa en el periodo:
   - la página de reservas, los recordatorios y «Confirmo que voy»;
   - las citas que se repiten y la importación de pacientes;
   - los avisos en el celular y la campana;
   - la historia clínica;
   - los pagos por transferencia y las varias agendas.
2. **Dado** la plataforma, **entonces** se ve el % de negocios que usa cada función.
3. **Dado** cada negocio, **entonces** se ve el valor del periodo: citas gestionadas, reservas online,
   recordatorios enviados, confirmaciones del paciente y cancelaciones con tiempo que liberaron la
   hora.
4. **Dado** un negocio con datos suficientes antes y después de empezar a usar los recordatorios o las
   confirmaciones, **entonces** se ven sus inasistencias de antes y de después. Si no hay datos
   suficientes, no se muestra.
5. **Dado** los totales de la plataforma del periodo, **entonces** se ven listos para usar en ventas
   («Agenda360 gestionó 1.240 citas este mes»).

---

### Casos límite

- **Un negocio nuevo, con pocas semanas:** su crecimiento frente al periodo anterior dice «nuevo», no
  «+∞ %».
- **Un negocio sin citas en el periodo:** aparece en la tabla con ceros. Para la salud, es una señal.
- **Un negocio sin propietario o sin equipo:** «último acceso» dice «nadie».
- **Un negocio suspendido:** no sale por defecto, pero se puede ver con el filtro. No cuenta en los
  promedios.
- **Un negocio sin tipo:** va en «Sin tipo».
- **Servicios gratis o sin precio:** no suben los ingresos ni bajan el ticket promedio, que sólo cuenta
  las citas con precio.
- **Las cifras se preparan una vez al día:** la página dice «Datos de hoy a las 06:00» (o la hora de la
  última preparación). Lo que pasó después sale al día siguiente.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **RF-001**: /admin DEBE tener la página «Analítica», con cuatro pestañas: Comparar, Por tipo de
  negocio, Salud y ventas, y Uso y valor. Sólo la ve el super admin.
- **RF-002**: El periodo DEBE poder elegirse (últimos 30 días, por defecto, o 90 días), comparado
  siempre con el periodo anterior de la misma duración.
- **RF-003**: La tabla comparativa DEBE tener las cifras de la Historia 1, ordenables, con filtros por
  tipo, plan y estado, búsqueda por nombre, exportar a CSV y el enlace a la ficha.
- **RF-004**: Las tasas de los negocios con menos de 10 citas en el periodo DEBEN marcarse «pocos
  datos» y no contar para los promedios por tipo.
- **RF-005**: Cada tipo de negocio DEBE mostrar sus valores típicos y su demanda por día y hora. Cada
  negocio DEBE mostrar sus tasas junto a las de su tipo, resaltando las muy distintas.
- **RF-006**: Cada negocio DEBE tener una puntuación de salud (0–100), con su grupo y sus motivos en
  palabras.
- **RF-007**: DEBE haber una lista «En riesgo» (con el contacto del propietario) y una lista «Listos
  para subir de plan» (con el motivo).
- **RF-008**: DEBE verse qué funciones usa cada negocio, la adopción de cada función en la plataforma,
  el valor del periodo de cada negocio, sus inasistencias antes y después (si hay datos) y los
  totales de la plataforma.
- **RF-009**: La analítica NO DEBE mostrar datos de pacientes: sólo cifras por negocio.
- **RF-010**: Los negocios NO DEBEN ver nada de esto.
- **RF-011**: Las cifras DEBEN prepararse una vez al día fuera del servidor de la web. La página DEBE
  decir de cuándo son y NO DEBE recalcularlas en cada visita.
- **RF-012**: La página DEBE usarse en el celular a 390 px, sin desplazamiento horizontal de la página.
  La tabla puede desplazarse dentro de su recuadro o verse en tarjetas.
- **RF-013**: La beta NO lleva la analítica (decisión del dueño, 2026-10-15).

### Entidades clave

- **Cifras de un negocio en un periodo:** citas, tasas, pacientes, ingresos estimados, uso del plan,
  funciones usadas, valor generado y salud con sus motivos.
- **Cifras de un tipo de negocio:** cuántos negocios, sus valores típicos y su demanda.
- **Preparación diaria:** cuándo se calcularon las cifras y de qué periodos.

## Criterios de éxito *(obligatorio)*

- **CE-001**: El super admin sabe en menos de un minuto qué 5 negocios tienen más inasistencias y
  cuáles están en riesgo de irse.
- **CE-002**: Las cifras de un negocio coinciden con las que se cuentan a mano en su agenda para el
  mismo periodo (comprobado en pruebas con datos conocidos).
- **CE-003**: Ninguna pantalla ni descarga de la analítica tiene datos de pacientes (comprobado en
  pruebas).
- **CE-004**: Abrir la analítica no hace recalcular las cifras: la página se carga como cualquier otra
  de /admin.
- **CE-005**: Las pruebas pasan, y la página se usa a 390 px sin desplazamiento horizontal de la
  página.

## Supuestos

- **Los ingresos de la plataforma** (lo que pagan los negocios a Agenda360) no se pueden mostrar: los
  precios acordados no se guardan. Llegan con la spec del cobro de suscripciones. Aquí sólo están los
  ingresos estimados de cada negocio.
- **Mostrarle a cada negocio su «valor generado»** en su propio panel queda para otra spec.
- **La puntuación de salud** usa reglas fijas y visibles (sin inteligencia artificial). Sus pesos los
  propone el plan, y el dueño los aprueba con él.
- **Los tipos de negocio** son las categorías que crea el super admin.
- **Sin servicios nuevos ni de pago:** todo con los datos que ya guarda Agenda360.
