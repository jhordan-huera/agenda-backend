# Cómo comprobarlo en local: Centro de avisos en el panel

Todo en local, con la base de demostración. Nunca en Vercel ni contra Supabase.

- **Puertos:** los servidores de prueba van en puertos propios y se detienen por puerto o PID, nunca
  por patrón:
  - 4180, la API;
  - 5199, el front compilado (`vite preview`);
  - 3199, la beta;
  - 54400, PostgreSQL.

  Los puertos 4000, 5173 y 3000 son del dueño del producto y no se tocan.
- **Detalles:** quién ve qué en [data-model.md](./data-model.md) y los textos en
  [contracts/api.md](./contracts/api.md).

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

```
cd ~/Documentos/Proyectos/Betas/agenda-beta
npm run build
npm run lint
```

### Suite nueva: `tests/panel-notices.test.ts`

Trabaja en la Clínica Dental Sonrisa, con varias agendas:
- Ricardo, el propietario;
- un administrador que crea la prueba;
- Elena, de Recepción;
- Valeria, con el rol Profesional;
- una agenda sin usuario.

Comprueba esto:

1. **Cada aviso de la tabla** (reserva online, comprobante, «Confirmo que voy», cancelación desde el
   email, cita y serie del panel): quién lo tiene en su campana y quién no, comparado con
   `NOTICE_AUDIENCE`.
2. **«Cita nueva en tu agenda»:**
   - si Elena le agenda a Valeria, le llega a Valeria y no a Elena;
   - si Valeria se agenda sola, no le llega a nadie;
   - en la agenda de Ricardo, le llega a Ricardo.
3. **Del cron,** con la hora simulada:
   - «Cita por cerrar», a Ricardo y a la profesional de esa agenda, no a Recepción;
   - el resumen de las 8: el del negocio a Ricardo y el de su agenda a Valeria;
   - pasar el cron dos veces no repite nada;
   - un negocio cuyo propietario no tiene el celular activado también recibe los avisos.
4. **Leído:**
   - el contador;
   - leer uno lo baja para esa persona y no para las demás;
   - «Marcar todo» deja el contador en 0, y lo que llega después vuelve a contar;
   - leerlo otra vez no da error;
   - el aviso de otra persona da 404.
5. **Textos:**
   - el nombre completo («Juan Pérez»), y el celular sigue con «Juan P.»;
   - ningún texto lleva la cédula, el email, el teléfono ni las notas de la cita;
   - las fechas se calculan al leer («Mañana» de ayer es «Hoy»).
6. **Casos límite:**
   - el super admin en modo soporte recibe 403;
   - quien entra hoy al equipo no ve los avisos de antes;
   - quien sale del equipo deja de verlos;
   - quien pasa de Recepción a Profesional sólo ve lo de su agenda;
   - una cita movida a otra agenda la ve la profesional nueva;
   - al borrar al paciente, sus avisos desaparecen;
   - un aviso de hace 31 días ya no aparece y el cron lo borra;
   - un negocio suspendido no genera avisos.
7. **No rompe nada (RF-011):** con la tabla `panel_notices` renombrada (como sin la migración), la
   reserva responde 200, la cita y sus emails quedan, y el aviso al celular sale igual.
8. **/admin:** el alta por el onboarding, la solicitud de plan, el cambio de seguridad y los intentos
   fallidos llegan a cada super admin, no al negocio.
9. **Sin actividad:** leer y «Marcar todo» no escriben en `audit_logs`.

### Suites que se actualizan

- **`push-notices`:** los textos del celular no cambian al moverlos a `describeNotice`.
- **`cron`:** la línea del registro suma «avisos del panel: N».

## 2. Recorrido en el front (Playwright, versión compilada)

Con la API en el 4180 y `vite preview` en el 5199. Se repite en escritorio y a 390 px:

1. **Propietario** (Ricardo):
   - entra al panel y la campana está sin número;
   - en otra ventana se hace una reserva online, y al volver a la pestaña la campana dice 1;
   - la lista muestra «Nueva reserva · {día} {hora} · {servicio} · {nombre completo}»;
   - al tocarlo se abre la cita y el número baja.
2. **«Marcar todo como leído»** deja la campana sin número.
3. **«Ver todos»** abre `/dashboard/notices`, con los avisos agrupados por día, «Sólo los no leídos» y
   «Cargar más».
4. **Recepción** (Elena) ve la reserva, pero no la cita por cerrar. **El rol Profesional** (Valeria)
   sólo ve lo de su agenda.
5. **Al instante:** con el celular activado en ese navegador, un aviso del service worker
   (`agenda360:aviso`, simulado por CDP) actualiza el número sin esperar.
6. **Modo soporte:** el super admin no ve la campana del negocio.
7. **/admin:** el super admin ve su campana con un negocio nuevo, y al tocarlo se abre su ficha.
8. **390 px:**
   - la lista ocupa el ancho de la pantalla, sin desplazamiento horizontal;
   - el lector de pantalla oye «Avisos, 1 sin leer».

## 3. Recorrido en la beta (puerto 3199)

1. **Al cargar la demo,** la campana de la clínica tiene sus avisos de ejemplo, de hoy y de ayer.
2. **Una reserva desde la página pública** suma «Nueva reserva». También suman «Confirmo que voy» y
   «Cancelar mi cita» desde la bandeja de emails simulada.
3. **Cada rol** (los botones Clínica, Profesional y Recepción del inicio de sesión) ve lo suyo.
4. **Un navegador con datos de antes** recibe la colección nueva sin perder nada.
5. **A 390 px,** sin desplazamiento horizontal.
