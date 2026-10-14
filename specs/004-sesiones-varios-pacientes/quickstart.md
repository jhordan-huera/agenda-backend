# Cómo comprobarlo en local: Sesiones con varios pacientes

Todo en local (principio IV), con la base de demostración. Nunca en Vercel ni contra Supabase.

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

`tests/multi-client-appointments.test.ts` (nuevo) cubre lo siguiente.

**Interruptor:**
- viene apagado;
- sólo el super admin lo cambia, y queda en la auditoría;
- el propietario no puede cambiarlo;
- no sale en el perfil público.

**Reglas al guardar:**
- sin el interruptor, no se puede agregar (RF-001b, CE-007);
- con el interruptor: hasta 2 adicionales; se rechazan el cuarto paciente, uno repetido o igual al
  principal, y uno inactivo;
- apagado después: los pacientes ya agregados se conservan y se pueden quitar, pero no agregar.

**Emails:**
- crear confirmada con 2 adicionales: 3 confirmaciones y 1 copia (CE-002);
- cambiar la hora: 3 emails de cambio;
- quitar a uno: una sola cancelación, la suya;
- agregar a uno en una cita confirmada: una sola confirmación, la suya;
- correo compartido: un email;
- recordatorios: uno por paciente; el recordatorio anterior en cola sigue valiendo.

**Lo demás:**
- un profesional con «sólo sus pacientes» ve a los adicionales de su agenda y otro profesional no;
- el historial (`?clientId=`) y la actividad incluyen las participaciones; el precio queda sólo en
  el principal;
- borrar a un adicional deja la cita; borrar al principal la borra;
- evolución clínica vinculada a la cita de un adicional;
- una cita a la misma hora sigue chocando (CE-004);
- las citas existentes no cambian tras la migración (CE-005).

## 2. Panel en el navegador

1. Levantar la base, la API y el front locales, como en las specs anteriores. Usar puertos propios,
   nunca 4000, 5173 ni 3000.
2. Entrar como `admin@demo.com` y abrir la ficha de la Clínica Dental Sonrisa. Activar «Citas con
   varios pacientes» y comprobar que la otra clínica de la demo no lo tiene.
3. Entrar como `ricardo@demo.com` y crear una cita confirmada para un paciente.
   - Agregar uno existente con «Agregar otro paciente» y crear otro nuevo ahí mismo.
   - Comprobar que la opción desaparece con 3 pacientes y que aparece el aviso de WhatsApp con un
     botón por paciente.
4. **Agenda (día, semana, mes, lista):** un solo bloque con los nombres. Arrastrarlo a otra hora y
   comprobar en la bandeja de emails (Configuración) un email de cambio por paciente.
5. **Detalle de la cita:** están los tres pacientes, cada uno con WhatsApp, llamada, email y su
   ficha.
6. **Ficha de cada adicional:** la sesión está en su historial.
7. **Reportes:**
   - la sesión cuenta una vez en citas e ingresos;
   - en «los que más vienen» aparecen los tres;
   - el PDF dice lo mismo.
8. **Con el interruptor apagado:** el formulario de una cita de pareja deja quitar pacientes, pero
   no agregar.
9. **A 390 px de ancho:** sin desplazamiento horizontal en el formulario, el detalle ni el aviso de
   WhatsApp.

## 3. Beta

- Repetir los pasos 2 a 8 en la beta, con el super admin y la clínica de la demo.
- Los emails se ven en la bandeja simulada.
