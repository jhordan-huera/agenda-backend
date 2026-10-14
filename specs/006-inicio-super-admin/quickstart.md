# Cómo comprobarlo en local: Inicio del super admin con datos importantes

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

`tests/admin-overview.test.ts` (nueva) comprueba lo siguiente.

- **Crecimiento:** citas, reservas online, pacientes y negocios creados en los dos periodos, contra
  los números de `/admin/stats`.
  - Las canceladas no cuentan.
  - Las del mes pasado fuera del periodo comparable tampoco.
- **Crecimiento de un negocio:** `growth` en `/admin/businesses`.
- **Emails de hoy:** enviados, fallidos (sin los descartados) y en cola.
- **Cron:** la última pasada y sus errores.
- **Copia de seguridad:** la última fila de `backup_runs`; `null` si no hay.
- **Seguridad:** intentos fallidos en 24 h y cuentas en alerta.
- **Permisos y privacidad:**
  - sólo el super admin (un propietario recibe 403);
  - la respuesta no trae ningún email.

`tests/backup.test.ts` (ampliada) comprueba que la copia buena y la fallida quedan anotadas.

## 2. Recorrido con Playwright (local)

1. Con la base demo, entrar como super admin y ver los tres bloques, en escritorio y a 390 px, sin
   desplazamiento horizontal.
2. Preparar en la base local:
   - un cron de hace 3 horas;
   - un email fallido;
   - una copia de hace 10 días;
   - 12 intentos fallidos de una cuenta.

   Comprobar los colores y el resumen «N avisos».
3. Comprobar que cada negocio de «Negocios para vender» abre su ficha.
4. Comprobar que una solicitud de plan pendiente aparece y desaparece al resolverla.

## 3. Beta

`npm run build` y `npm run lint`, y abrir `/admin` en el puerto 3199. La salud dice «No disponible en
la beta» donde corresponde.
