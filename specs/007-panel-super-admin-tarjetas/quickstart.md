# Cómo comprobarlo en local: Panel del super admin con tarjetas y colores propios

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

`tests/panel-colors.test.ts` (nueva) comprueba lo siguiente.

- **Guardar:** el super admin guarda una paleta. La respuesta y su sesión la traen, también al entrar
  de nuevo.
- **Volver a Agenda360:** con `null`, la sesión vuelve a `null`.
- **Validación:** un color sin el formato `#rrggbb` responde 400 y no cambia nada.
- **Sólo la cuenta propia:**
  - otro super admin sigue con los suyos;
  - un propietario recibe 403 y su sesión trae `panelColors: null`.
- **La base:** un valor mal formado escrito a mano lo rechaza la comprobación de la columna.

## 2. Recorrido con Playwright (local, escritorio y 390 px)

1. **Las 8 pantallas:** encabezado, fila de cifras donde corresponde, tarjetas y sin desplazamiento
   horizontal a 390 px.
2. **Negocios:**
   - el filtro «Pro» deja sólo los Pro y su número coincide;
   - la búsqueda se combina con los filtros;
   - «Lista» muestra la tabla y se recuerda al recargar;
   - en el celular no hay botón y se ven tarjetas.
3. **Usuarios:** lo mismo, con sus filtros por tipo de cuenta.
4. **Ficha del negocio:**
   - las 4 cifras;
   - las 4 pestañas;
   - recargar en «Equipo» sigue en «Equipo»;
   - escribir en «Datos obligatorios», pasar a «Resumen» y volver: lo escrito sigue ahí.
5. **Cada acción de hoy (CE-001), una por una:**
   - crear negocio;
   - suspender y reactivar;
   - cambiar plan y agendas;
   - agregar miembro;
   - cambiar contraseña;
   - guardar datos obligatorios y varios pacientes;
   - eliminar negocio (con uno creado para la prueba);
   - categorías: crear, editar y eliminar;
   - aprobar o rechazar una solicitud de plan;
   - exportar la auditoría;
   - ajustes de soporte;
   - equipo de la plataforma;
   - verificación en dos pasos y contraseña (que se abran sus formularios).
6. **Colores:**
   - elegir «Eucalipto» y guardar: el menú, los botones, las insignias, la cabecera de la ficha y los
     gráficos cambian;
   - cerrar sesión y entrar en otro contexto del navegador: siguen;
   - «Gestionar negocio» muestra los colores del negocio;
   - volver a «Agenda360».
7. **Actividad:** la auditoría agrupada en «Hoy», «Ayer» y fechas, con «Cargar más» y los filtros.
8. **Panel del negocio sin cambios:** capturas antes y después de su Configuración → Colores y de su
   Actividad.

## 3. Beta (puerto 3199)

- `npm run build` y `npm run lint`.
- `/admin`: las mismas pantallas con sus datos. Actividad dice «No disponible en la beta» en su fila
  de cifras. Los colores se guardan por cuenta en sus datos de prueba.

## 4. Antes de publicar

1. Migración 035 (la aplica el dueño del producto):
   ```
   npm run db:migrate
   ```
2. PR `dev` → `main` del backend y después del front.
