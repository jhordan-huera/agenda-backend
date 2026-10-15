# Cómo comprobarlo en local: Analítica del super admin

Todo en local, con la base de demostración. Puertos de prueba: 4180 (API), 5199 (front compilado) y
54400 (PostgreSQL). Se detienen por PID. Los puertos 4000, 5173 y 3000 son del dueño.

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

### Suite nueva: `tests/analytics.test.ts`

Con negocios de prueba de cifras conocidas: uno grande, uno pequeño (con «pocos datos»), uno nuevo,
uno suspendido y uno sin tipo.

- **Las cifras de cada negocio coinciden** con las contadas a mano: citas, crecimiento («nuevo» si
  corresponde), cada tasa, pacientes, ingresos, cobrado, ticket, uso del plan, agendas y último
  acceso.
- **Las medianas por tipo,** «pocos datos», «muy distinto» y la demanda por día y hora.
- **La salud:** cada regla de R4 resta lo que dice, con su motivo, y los tres grupos.
- **«Listos para subir de plan»:** cada criterio de R5.
- **Las funciones y la adopción** (R6), y el valor generado, con el antes y el después (sólo con datos
  suficientes).
- **El cron:** prepara una foto al día y no la repite en la misma jornada; borra las de más de 30 días.
- **`GET /api/admin/analytics`:**
  - sólo el super admin (un propietario recibe 403);
  - sin foto, `snapshot: null`;
  - `days` no válido, 400.
- **Privacidad:** la foto entera no tiene nombres, emails, teléfonos ni cédulas de pacientes.

## 2. Recorrido en el front (Playwright, versión compilada)

1. `npm run analytics:refresh` contra la base de prueba.
2. /admin → «Analítica»:
   - las cuatro pestañas;
   - el selector de 30 o 90 días;
   - ordenar y filtrar la tabla y exportar el CSV;
   - abrir la ficha de un negocio y ver «Frente a su tipo».
3. Sin foto: el mensaje «Las cifras se preparan cada mañana».
4. A 390 px: la tabla se desplaza dentro de su recuadro y la página no.
