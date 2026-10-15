# Cómo comprobarlo en local: Arreglos urgentes de la plataforma

Todo en local, con la base de demostración. Nunca en Vercel ni contra Supabase.

Los servidores de prueba van en puertos propios: 4180 (API), 5199 (front compilado), 3199 (beta) y
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

### Suites nuevas o que cambian

- **`email-quota`** (nueva). Con un cupo pequeño (por ejemplo 10, con reservas de 2 y de 4):
  - con más emails que el cupo salen primero los del equipo, después los del paciente y al final los
    del negocio;
  - los que no caben siguen `queued`, sin sumar intentos, y salen cuando la ventana libera cupo;
    ninguna copia se pierde;
  - un recordatorio de una cita que ya empezó se descarta;
  - cada `EmailType` tiene su nivel;
  - los topes del público y de pacientes nuevos siguen fallando como hoy;
  - `getStats` da las cifras;
  - ntfy avisa una vez al día.
- **Se actualizan:**
  - `public-abuse` y las demás que miran el tope de 400;
  - las del admin (`planSince`, `nearLimit` y el reparto por plan);
  - `cron`.

## 2. Recorrido en el front (Playwright, versión compilada)

1. Salud de /admin: el cupo de emails, con sus colores.
2. La ficha de un negocio dice «En Pro desde el…».
3. `/privacidad` dice «semanal», y el registro sólo menciona la política. Las dos, a 390 px sin
   desplazamiento horizontal.

## 3. Beta

La política y el registro. Build y lint.
