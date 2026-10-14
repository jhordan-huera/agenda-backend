# Cómo comprobarlo en local: Aviso al paciente en cada cambio de estado de su cita

Todo en local, con la base de demostración. Nunca en Vercel ni contra Supabase.

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

`tests/status-notices.test.ts` (nueva) comprueba lo siguiente.

- **Cada cambio de la tabla de la historia 1:** el email que queda en cola para el paciente, con su
  tipo, y la copia al profesional.
- **`notify: false`:** ningún email y la actividad «sin avisar al paciente».
- **«Seguimiento» apagado:** Atendida y No asistió no avisan; Pendiente sí, con «Confirmaciones».
- **«Confirmaciones» apagado:** Pendiente y Confirmada no avisan.
- **Una cita de hace más de 7 días** marcada Atendida: sin email.
- **Varios pacientes:** un email a cada uno y una sola copia.
- **Un negocio guardado sin `followUps`:** avisa, porque vale sí por defecto.

`tests/booking-alert.test.ts` (ampliada) comprueba el aviso de ntfy de un cambio de estado:
- título sin el negocio, paciente a medias, «De Confirmada a Cancelada» y quién lo hizo;
- los emails, o «Sin avisar al paciente»;
- también un cambio hecho desde el formulario;
- el tope de 10 y la cifra del resto.

## 2. Recorrido con Playwright (local, escritorio y 390 px)

1. **La ficha de una cita confirmada:** la casilla «Avisar al paciente» está marcada.
2. **Pasar a Pendiente:**
   - se ofrece WhatsApp con «queda pendiente de confirmar»;
   - en la bandeja aparece «Pendiente de confirmar».
3. **Desmarcar la casilla y pasar a Confirmada:** no se ofrece WhatsApp ni sale email; la actividad
   lo dice.
4. **Cerrar y abrir la ficha:** la casilla vuelve a estar marcada.
5. **Configuración → Notificaciones:** «Seguimiento» encendido; apagarlo y marcar Atendida: sin email.
6. **El panel a 390 px:** sin desplazamiento horizontal.

## 3. Beta (puerto 3199)

`npm run build`, `npm run lint` y el mismo recorrido con sus datos de prueba.
