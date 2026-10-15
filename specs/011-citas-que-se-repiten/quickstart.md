# Cómo comprobarlo en local: Citas que se repiten

Todo en local, con la base de demostración. Nunca en Vercel ni contra Supabase. Los servidores de
prueba van en puertos propios (por ejemplo 4180, 5199 y 3199) y se detienen por puerto o PID; el
4000, el 5173 y el 3000 son del dueño y no se tocan.

## 1. Pruebas automáticas

```
cd ~/Documentos/Proyectos/Backend/agenda-backend
npm run typecheck
npm test
```

```
cd ~/Documentos/Proyectos/Frontend/agenda-front
npm run build
npm run lint
```

### Suite nueva: `tests/appointment-series.test.ts`

**Fechas** (con las funciones compartidas, sin API):
- cada semana, 8 desde el martes 20 de octubre: 8 martes seguidos;
- cada 2 semanas: de 14 en 14 días;
- cada mes desde el 31 de enero: 28 (o 29) de febrero, 31 de marzo, 30 de abril…; desde el 15: el 15
  de cada mes;
- `applyPlanLimit`: con 2 citas libres en el cupo de un mes, la tercera de ese mes queda `plan_limit`
  y la del mes siguiente no.

**Vista previa**, como el propietario de la demo:
- **Marcas:** con una cita ya puesta en la 2.ª fecha, un bloqueo en la 3.ª, un día que el profesional
  no atiende y una hora fuera de su horario, cada una sale con su marca y su motivo:
  - la de otra cita lleva horas libres y su motivo no nombra al paciente;
  - la del día sin atención no lleva horas libres.
- **Cupo:** en un negocio Free con 18 citas en noviembre, de 4 fechas de noviembre las 2 últimas
  salen «Supera el cupo del plan». `planRemaining` nunca pasa de 24.
- **Validaciones (400):** la primera fecha ayer, el estado «Atendida», 25 citas, una frecuencia que no
  existe.
- **No cambia nada:** después de la vista previa no hay citas, series ni emails nuevos.

**Crear:**
- **8 fechas, una con otra hora y una quitada:** se crean 7, numeradas de 1 a 7 sin huecos, todas con
  el mismo paciente, servicio, profesional, modalidad (con la dirección de la visita), precio y notas.
  La serie guarda 8 pedidas y 7 creadas.
- **Una fecha en un bloqueo:** sin «Agendar igual» no se crea (`skipped`); con él, sí.
- **Una fecha que no es de la serie, o repetida:** 400, y no se crea nada.
- **Se ocupó mientras tanto:** se agenda una cita suelta en la 5.ª fecha después de la vista previa.
  Al crear, esa fecha vuelve en `skipped` con «Se ocupó mientras revisabas la lista» y las demás se
  crean.
- **Ninguna se puede crear:** 409 y no queda ninguna serie. Si todas pasaban el cupo, 402.
- **Sesión en pareja** (negocio con el interruptor del super admin): cada cita de la serie tiene a los
  dos pacientes.
- **Actividad:** una sola entrada `appointment.series_created` con «Agendó una serie de 7 citas…» y
  las fechas; ninguna `appointment.created` de esas citas.

**Emails:**
- **Uno por paciente:** un `appointment_series` «Tus próximas 7 citas en …» al paciente (a cada uno en
  la pareja; uno si comparten el email) y un `appointment_copy` al profesional. Ningún
  `appointment_confirmed` ni `booking_created` por cada cita.
- **Pendiente:** con la serie en Pendiente, el texto dice «pendientes de confirmar».
- **«Confirmaciones» apagado:** no sale el email ni la copia.
- **Aviso al profesional:** con un profesional con avisos y otro email que el de la copia, sale un
  solo `professional_new_appointment`, con las fechas.
- **Tope de emails:** con `THIRD_PARTY_EMAILS_PER_DAY` bajo, el email de la serie queda «No enviado…»
  y no sale la copia.
- **Recordatorios:** `runReminderJob` en el día de la 2.ª cita pone en cola su recordatorio y su
  copia, como en una cita suelta.

**Cada cita, sola:**
- cambiarle la hora a la 4.ª cambia sólo ésa, que conserva su `series`;
- confirmar la 2.ª manda su `appointment_confirmed`, como siempre.

**«Cancelar ésta y las siguientes»**, desde la 3.ª de 7, con la 5.ª ya marcada «Atendida»:
- se cancelan la 3.ª, la 4.ª, la 6.ª y la 7.ª; la 1.ª, la 2.ª y la 5.ª no cambian;
- sale un solo `appointment_series_cancelled` por paciente con esas 4 fechas y una copia;
- con `notify: false`: ningún email, y la actividad termina en «(sin avisar al paciente)»;
- con «Cancelaciones» apagado: ningún email;
- una cita suelta da 409 «Esta cita no es de una serie»; repetirlo da 409 «No quedan citas
  activas…»;
- la actividad tiene una sola entrada `appointment.series_cancelled`.

**Rol Profesional** (Valeria, de la demo):
- crea una serie en su agenda; en otra agenda recibe 403;
- con «sólo sus pacientes», con un paciente que no es suyo recibe 404;
- «Cancelar ésta y las siguientes» no cancela las que se pasaron a otra agenda.

**Dos series a la vez** (CE-002): dos `POST` simultáneos de dos series semanales a la misma hora con
el mismo profesional, y otra vez con una reserva online a la vez. Después, ninguna cita activa del
profesional se solapa con otra (consulta con `tsrange … &&`), y lo que no se creó vuelve en `skipped`.

**ntfy** (con el ntfy falso de las pruebas):
- una serie da un solo aviso «Agenda360: nueva serie de citas», con «serie de 7 citas desde el
  panel», el paciente a medias, quién la agendó y sus emails;
- sus citas no salen como «Agenda360: nueva cita»;
- la cancelación da un solo aviso «Agenda360: serie de citas cancelada», y ningún aviso de cambio de
  estado por cada cita;
- ningún título nombra al negocio y ningún mensaje lleva un email o un teléfono completos.

### Suites que se actualizan

| Suite | Qué cambia |
|---|---|
| `booking-alert.test.ts` | Las citas de una serie no tienen aviso propio; los dos avisos nuevos. |
| `cron.test.mjs` | La línea del registro con «series del panel» y «series canceladas». |
| `email-templates.test.mjs` | Las dos plantillas nuevas: asunto, lista de fechas, zona horaria en las virtuales, pago una sola vez, y la copia sin enlaces en las fechas. La variante de serie de `professionalNewAppointment`. |
| `whatsapp-notice.test.mjs` | El tipo `series_cancelled` y su resumen en la actividad. |
| `delete-business.test.mjs` | Borrar un negocio con una serie. |

## 2. Recorrido con Playwright (local, escritorio y 390 px)

**API, front y datos:**
- la API local en el 4180;
- el front con Vite en el 5199, con `API_PROXY_TARGET=http://localhost:4180`;
- la demo.

**Pasos:**
1. **Como el propietario de la demo,** poner antes una cita en el martes de la 2.ª semana a las 10:00
   y un bloqueo en el de la 3.ª.
2. **«Nueva cita»,** con un paciente, un servicio y el martes que viene a las 10:00. Encender
   «Repetir», «Cada semana», 8, y «Revisar fechas». Se ve la lista de 8:
   - la 2.ª, «Ya hay una cita de 10:00 a 11:00», con «Otra hora»;
   - la 3.ª, «Bloqueado: …», con «Agendar igual».
3. **Cambiar la hora de la 2.ª y quitar la 3.ª:** el botón dice «Crear 7 citas». Al pulsarlo:
   - sale «Se crearon 7 citas» y cuál no;
   - la agenda muestra las 7;
   - la ficha de la 3.ª dice «Cita 3 de 7 · cada semana».
4. **Actividad:** una sola entrada «Agendó una serie de 7 citas…». **Actividad → Emails:** un «Serie de
   citas» al paciente y su copia.
5. **Cambiar la hora de la 4.ª** desde su ficha: sólo cambia ésa.
6. **Ficha de la 3.ª → «Cancelar ésta y las siguientes» → confirmar:**
   - sale «Se cancelaron 5 citas»;
   - se ofrece el WhatsApp con las 5 fechas;
   - en Emails, un solo «Serie cancelada».
7. **Otra serie, cancelada con «Avisar al paciente» desmarcada:** ni email ni WhatsApp.
8. **«Cada mes» desde un día 31:** la lista muestra el último día de los meses cortos.
9. **Un negocio Free de la demo con el mes casi lleno:** las que pasan el cupo salen marcadas y, al
   quitar una de antes, la marca pasa a la siguiente.
10. **Como Valeria (rol Profesional):** sólo agenda en su agenda; la lista no nombra a pacientes de
    otras citas.
11. **A 390 px (motor de Safari):** el formulario con «Repetir», la lista con sus controles y la ficha,
    sin desplazamiento horizontal. Con el teclado: cada control con su etiqueta y el foco visible.
12. **Tiempo (CE-001):** de «Nueva cita» a «Se crearon 8 citas», sin choques, en menos de un minuto.

## 3. Beta (puerto 3199)

1. `npm run build` y `npm run lint`.
2. Crear una serie con una fecha ocupada por una cita de prueba: la lista la marca y se puede cambiar
   la hora o quitarla.
3. En la bandeja de emails simulada aparece un solo «Tus próximas N citas…».
4. La ficha dice «Cita 3 de N» y «Cancelar ésta y las siguientes» deja un solo email de cancelación.
5. Con un negocio de prueba en el plan Free, la lista marca las que pasan el cupo.
