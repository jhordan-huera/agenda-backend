# Especificación: Recuperar la contraseña con una contraseña temporal

**Carpeta**: `specs/054-recuperar-contrasena` (rama de trabajo: `dev`) · **Creada**: 2026-11-20

**Estado**: Implementada (2026-11-20), en `dev`. Plan y decisiones aprobados en el chat el 2026-11-20 (ver «Decisiones
aprobadas»).

Plan técnico: [plan.md](plan.md). Reporte: [reporte.md](reporte.md).

**Repos**:
- **agenda-backend:** pedir la contraseña temporal, entrar con ella, la sesión que sólo deja crear la contraseña
  nueva, el cambio de contraseña de cualquier cuenta del equipo, la contraseña del soporte como temporal, los emails,
  los topes y la actividad.
- **agenda-front:** «¿Olvidaste tu contraseña?» con el formulario, la pantalla «Crea tu contraseña nueva» y
  «Contraseña» en Configuración → Perfil.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-20, después de ver cómo funciona hoy «¿Olvidaste tu contraseña?»:

> solo quiero que pueda recuperar la contraseña el profesional, propietario, recepcionista o super admin; quiero que
> verifiquemos el correo y se le envíe una contraseña temporal y luego se le pida cambiar

**Lo que hay hoy:**
- **En el inicio de sesión, «¿Olvidaste tu contraseña?»** abre una página que sólo muestra el email y el WhatsApp del
  soporte.
- **La contraseña la pone siempre el super admin** («Cambiar contraseña» en Usuarios y en la ficha del negocio): le
  llega a la persona por email y se cierran sus sesiones. La persona no la puede cambiar; sólo el super admin cambia
  la suya.
- **Esto cambia una decisión** del 2026-10-04 (reafirmada el 2026-10-09): «no hay "olvidé mi contraseña" y los
  usuarios no cambian su contraseña». La cambia el propio dueño con este pedido.
- **El paciente** (la cuenta de la tarjeta de fidelización, spec 052) no cambia: sigue recuperándola con el enlace de
  su consultorio.

**Para qué sirve:** que quien olvidó su contraseña vuelva a entrar en minutos, sin esperar al soporte, y que nadie, ni
el soporte, conozca la contraseña final de otra persona.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Recupera su acceso con una contraseña temporal (Prioridad: P1)

**Por qué esta prioridad:** es el pedido. Sin esto, quien olvida su contraseña depende de que el soporte conteste.

**Prueba independiente:** una recepcionista olvidó su contraseña. En el inicio de sesión toca «¿Olvidaste tu
contraseña?», escribe su email y en un minuto le llega «Tu contraseña temporal». Entra con ella, crea su contraseña
nueva y queda en su panel.

1. **Dado** el inicio de sesión, **entonces** «¿Olvidaste tu contraseña?» abre la página **«Recuperar el acceso»**
   con el campo del email y el botón **«Enviar contraseña temporal»** (y el CAPTCHA, si está activo). Debajo sigue el
   contacto del soporte, por si el email no llega.
2. **Dado** que escribe un email, **entonces** la página responde siempre lo mismo: **«Si ese email tiene una cuenta,
   te enviamos una contraseña temporal. Revisa tu bandeja de entrada y el correo no deseado.»** Igual si el email no
   existe, si la cuenta está desactivada o si ya pidió demasiadas: nadie puede averiguar qué emails tienen cuenta. Un
   email inexistente tarda lo mismo en responder.
3. **Dado** un email de una cuenta activa del equipo (propietario, administrador, profesional, recepción) o de un
   super admin, **entonces** le llega el email **«Tu contraseña temporal»**, con:
   - su email y la contraseña temporal: 10 caracteres al azar, sin letras que se confunden (0 y O, 1, l e I);
   - que **sirve una sola vez y vence en 1 hora**;
   - que al entrar se le pedirá crear una contraseña nueva;
   - **«Si no fuiste tú, ignora este correo: tu contraseña de siempre sigue funcionando»**;
   - el botón «Iniciar sesión».
4. **Dado** que pidió una contraseña temporal, **entonces** **su contraseña de siempre sigue funcionando** hasta que
   use la temporal. Así, alguien que escriba su email no la deja afuera.
5. **Dado** varias contraseñas temporales pedidas, **entonces** sólo sirve la última. Una temporal deja de servir al
   usarla, al vencer, al entrar con la contraseña de siempre o al cambiar la contraseña.
6. **Dado** que entra con la contraseña temporal, **entonces** ve la pantalla de la Historia 2 antes que cualquier
   otra cosa.

### Historia 2 - Crea su contraseña nueva al entrar (Prioridad: P1)

**Por qué esta prioridad:** sin este paso la contraseña temporal quedaría como la de siempre, y la conocería quien
leyó ese email.

**Prueba independiente:** con una contraseña temporal recién usada, ninguna pantalla del panel carga hasta crear la
contraseña nueva; después, el panel funciona y la temporal ya no sirve.

1. **Dado** una sesión abierta con una contraseña temporal (la del email o la que puso el soporte, Historia 3),
   **entonces** el panel y /admin muestran sólo **«Crea tu contraseña nueva»**: contraseña nueva, confirmarla y
   «Guardar y entrar», y «Cerrar sesión». La API rechaza cualquier otra operación de esa sesión con el código
   `password_change_required`.
2. **Dado** la contraseña nueva, **entonces** debe tener al menos 8 caracteres, coincidir con la confirmación y ser
   distinta de la temporal.
3. **Dado** que la guarda, **entonces**:
   - pasa a ser su contraseña (la de siempre deja de servir);
   - se cierran sus demás sesiones abiertas, y esta sigue;
   - dejan de servir las temporales pendientes;
   - le llega un email «Cambiaste tu contraseña», con la fecha, la conexión y el navegador;
   - entra a su panel (o a /admin) sin volver a iniciar sesión;
   - queda en la actividad.
4. **Dado** que cierra la sesión sin crearla, **entonces** la temporal ya está usada: entra con su contraseña de
   siempre (si la recuerda) o pide otra temporal.

### Historia 3 - La contraseña que pone el soporte también es temporal (Prioridad: P2)

**Por qué esta prioridad:** con esto ni el soporte conoce la contraseña final de la persona.

**Prueba independiente:** el super admin usa «Cambiar contraseña» con un profesional. Al profesional le llega la
contraseña por email como hoy; al entrar con ella, ve «Crea tu contraseña nueva».

1. **Dado** «Cambiar contraseña» del super admin (Usuarios o la ficha del negocio), **entonces** todo sigue como hoy
   (le llega por email y se cierran sus sesiones), y además, al entrar con esa contraseña, la persona tiene que crear
   la suya (Historia 2).
2. **Dado** el diálogo de «Cambiar contraseña», **entonces** dice que es una contraseña temporal: la persona creará la
   suya al entrar.
3. **Dado** el alta de un propietario o de un miembro del equipo (lo hace el super admin con una contraseña),
   **entonces** esa primera contraseña también es temporal.
4. **Dado** que la persona todavía no entró, **entonces** esa contraseña no vence: sirve hasta que entre con ella.
5. **Dado** el diálogo de «Cambiar contraseña», **entonces** tiene **«Generar una»**, que escribe una contraseña al
   azar como las del email (10 caracteres sin letras que se confunden). Se puede escribir otra a mano.
6. **Dado** que se guardó, **entonces** el diálogo pasa a **«Contraseña temporal lista»**: dice que se la enviamos por
   email y ofrece **«Enviar por WhatsApp»** (pedido del dueño, 2026-11-20), con el mensaje ya escrito: el saludo, su
   email, la contraseña temporal, la dirección para entrar y que al entrar creará la suya. Si la cuenta tiene teléfono,
   abre su chat; si no, WhatsApp pide elegir el contacto. También **«Copiar mensaje»**. El mensaje sale del aparato del
   super admin: Agenda360 no lo envía ni lo guarda.

### Historia 4 - Cambia su contraseña cuando quiera (Prioridad: P2)

**Prueba independiente:** un propietario va a Configuración → Perfil → Contraseña, escribe la actual y una nueva, y
desde su otro aparato la sesión se cierra.

1. **Dado** Configuración → Perfil, **entonces** cualquier cuenta del equipo tiene la sección **«Contraseña»**: la
   actual, la nueva y confirmarla. El super admin la sigue teniendo en /admin.
2. **Dado** que la cambia, **entonces** con la actual correcta pasa lo mismo que en la Historia 2 (3): sesiones,
   temporales, email y actividad. Con la actual incorrecta, cuenta como un intento fallido (el bloqueo de siempre).

### Historia 5 - El super admin, con su verificación en dos pasos (Prioridad: P1)

**Prueba independiente:** un super admin pide una contraseña temporal, entra con ella y la app le pide el código de
seis números antes de «Crea tu contraseña nueva». Al dueño de la plataforma le llegan el email y el aviso por ntfy.

1. **Dado** un super admin con la verificación en dos pasos, **entonces** después de la contraseña temporal le pide el
   código, como siempre. Sin el código no entra.
2. **Dado** que un super admin entra con una contraseña temporal, **entonces** a él y al dueño de la plataforma les
   llega el email de seguridad («Entró con una contraseña temporal»), y al dueño, el aviso por ntfy, como los demás
   cambios de cuentas de super admin.
3. **Dado** que un super admin cambia su contraseña (al entrar o en /admin), **entonces** se avisa como hoy.

### Casos límite

- **Muchos pedidos:** hasta 3 por email en una hora y 5 en un día; pasado eso, la página responde lo mismo, pero no
  sale ningún email. Desde una misma conexión, hasta 10 pedidos por hora; después, «Demasiados pedidos. Espera un rato
  y vuelve a intentarlo».
- **La contraseña temporal escrita mal:** es un intento fallido como cualquier otro y cuenta para el bloqueo de
  siempre.
- **Email con mayúsculas o espacios:** se reconoce igual que en el inicio de sesión.
- **Cuenta desactivada:** no recibe nada, y la página responde igual. Si se reactiva, puede pedir una.
- **Negocio suspendido:** la persona puede recuperar su contraseña; al entrar ve lo de siempre para un negocio
  suspendido, después de crear la contraseña nueva.
- **Super admin sin la verificación en dos pasos activada:** primero crea su contraseña nueva y después la activa.
- **El dispositivo de confianza** (spec 053): entrar con una contraseña temporal no lo marca como de confianza; al
  crear la contraseña nueva, el navegador queda de confianza con ella y los anteriores dejan de serlo.
- **El email tarda o no llega:** la página dice que revise el correo no deseado y muestra el contacto del soporte.
  El email va en la cola de siempre, en el nivel «equipo» del cupo de Gmail.
- **El registro de emails** (Actividad → Emails) muestra la contraseña temporal oculta («••••••••»), como hoy las
  del soporte.
- **Las cuentas de pacientes** (spec 052) no usan esto; su formulario sigue igual.

## Requisitos *(obligatorio)*

- **RF-001**: La página «Recuperar el acceso» DEBE pedir el email (y el CAPTCHA, si está activo) y responder siempre el mismo mensaje, exista o no la cuenta, esté o no activa y aunque se haya pasado del tope por email. Un email inexistente DEBE tardar lo mismo que uno existente.
- **RF-002**: A una cuenta activa del equipo o de un super admin le DEBE llegar el email «Tu contraseña temporal», con una contraseña de 10 caracteres al azar sin letras que se confunden, que sirve una vez y vence en 1 hora. El registro de emails NO DEBE guardar la contraseña.
- **RF-003**: La contraseña de siempre DEBE seguir funcionando hasta que se use la temporal. Sólo DEBE servir la última temporal pedida, y DEBE dejar de servir al usarla, al vencer, al entrar con la de siempre y al cambiar la contraseña.
- **RF-004**: Entrar con una contraseña temporal (la del email o la del soporte) DEBE abrir una sesión que sólo puede crear la contraseña nueva, ver la sesión y cerrarla; la API DEBE rechazar todo lo demás con `password_change_required`, y el panel y /admin DEBEN mostrar sólo «Crea tu contraseña nueva».
- **RF-005**: La contraseña nueva DEBE tener al menos 8 caracteres, coincidir con la confirmación y ser distinta de la temporal. Al guardarla DEBE cerrar las demás sesiones, anular las temporales pendientes, enviar el email «Cambiaste tu contraseña» y dejar entrar sin volver a iniciar sesión.
- **RF-006**: La contraseña que pone el super admin con «Cambiar contraseña» y la del alta de un propietario o de un miembro del equipo DEBEN ser temporales: al entrar con ellas se pide crear la propia. No vencen.
- **RF-007**: Cualquier cuenta del equipo DEBE poder cambiar su contraseña en Configuración → Perfil con la actual. La actual incorrecta DEBE contar como intento fallido.
- **RF-008**: El super admin DEBE seguir pasando por la verificación en dos pasos después de la contraseña temporal. Su entrada con una temporal DEBE avisar por email a la cuenta y al dueño de la plataforma, y por ntfy al dueño.
- **RF-009**: Los pedidos DEBEN tener tope: 3 por email por hora y 5 por día (sin email, misma respuesta) y 10 por hora por conexión (429).
- **RF-010**: Cada pedido (también el de un email no registrado), cada entrada con una contraseña temporal y cada cambio de contraseña DEBEN quedar en Actividad → Seguridad del super admin, sin la contraseña.
- **RF-011**: Las cuentas de pacientes NO DEBEN cambiar.
- **RF-012**: La constitución DEBE recoger la decisión nueva en los dos repos (principio III).
- **RF-013**: El diálogo «Cambiar contraseña» del super admin DEBE poder generar una contraseña al azar y, después de guardarla, ofrecer «Enviar por WhatsApp» (al teléfono de la cuenta si lo tiene) y «Copiar mensaje» con el mensaje ya escrito. La API NO DEBE devolver ni guardar la contraseña para esto: el mensaje se arma en el navegador con la que escribió o generó el super admin.

### Entidades

- **Contraseña temporal:** de una cuenta, guardada sólo como huella (como las contraseñas), con cuándo se pidió,
  cuándo vence y si ya se usó.
- **«Debe crear su contraseña»:** una marca en la cuenta cuando su contraseña la puso el soporte, y en la sesión
  cuando se entró con una contraseña temporal. Se quita al crear la propia.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - la misma respuesta (y un tiempo parecido) con email existente, inexistente, desactivado y pasado del tope;
  - el email con la temporal oculta en el registro;
  - que la de siempre sigue sirviendo, que sólo vale la última temporal, que sirve una vez y que vence en 1 hora;
  - la sesión restringida (`password_change_required` en las rutas del panel y de /admin) y que se libera al crear la
    contraseña nueva;
  - las demás sesiones cerradas, el dispositivo de confianza y el email al cambiarla;
  - la contraseña del soporte como temporal;
  - el cambio en Perfil para cualquier rol y la actual incorrecta como intento fallido;
  - el super admin con su verificación en dos pasos y los avisos;
  - los topes y la actividad.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint y todas las `check:*` en el front, sin errores.
- **CE-003**: El recorrido funciona en el computador y en el celular (390 px, sin desplazamiento horizontal): pedir la
  temporal, entrar con ella, crear la contraseña nueva y cambiarla en Perfil.
- **CE-004**: Quien olvidó su contraseña vuelve a entrar a su panel en menos de 3 minutos, sin escribirle al soporte.
- **CE-005**: Una prueba en local: el email llega a una dirección de prueba, se lee bien en el celular y la
  contraseña se copia sin errores.

## Supuestos

- **Se prueba en local** (`dev:local`, con la base local), nunca con la base de producción.
- **El email sale por la cola de siempre** con el remitente de siempre, en el nivel «equipo» del cupo de Gmail.
- **«Una hora» se cuenta desde el pedido.** La contraseña que pone el soporte no vence (puede pasar tiempo hasta que la
  persona la use).
- **Las cuentas que ya existen no cambian:** nadie tiene que cambiar su contraseña al publicar esto, salvo que use una
  temporal.
- **Hay una migración** (la 061) para las contraseñas temporales y la marca «debe crear su contraseña». La aplica el
  dueño del producto antes de publicar el backend.

## Fuera de alcance

- **Enlaces para definir la contraseña** (sigue sin haberlos: es por contraseña temporal).
- **La verificación en dos pasos para el resto del equipo** (aparte, si se pide).
- **Las cuentas de pacientes,** el registro público y la beta.
- **Avisar por WhatsApp o por SMS:** sólo por email.

## Decisiones aprobadas (2026-11-20)

El dueño eligió (AskUserQuestion), con el resto del plan aprobado en el chat:
1. **Email sin cuenta:** el mismo mensaje que con cuenta, sin revelar quién está registrado.
2. **La temporal vence en 1 hora** y sirve una sola vez.
3. **La contraseña que pone el soporte también es temporal:** al entrar hay que crear la propia.
4. **Cualquiera del equipo cambia su contraseña** en Configuración → Perfil, con la actual.
5. **El super admin puede enviar la contraseña temporal por WhatsApp** (pedido del dueño mientras se escribía la
   spec): desde el diálogo de «Cambiar contraseña», con el mensaje ya escrito, además del email.

Además, del plan aprobado: la contraseña de siempre sigue funcionando hasta usar la temporal; el super admin sigue con
su verificación en dos pasos y su entrada con una temporal avisa al dueño de la plataforma.

**Riesgo aceptado:** el super admin pone la contraseña temporal del soporte y podría usarla antes que la persona;
entonces la persona ya no podría entrar con ella (lo notaría y pediría otra temporal). Reemplaza al riesgo anterior de
la constitución («podría entrar como el propietario»), que ahora queda a la vista.
