# Guía de comprobación: Modo oscuro

Todo en local, con datos ficticios: nunca en Vercel ni contra la base de producción.

## 1. Backend

```
npm run typecheck
env -u DATABASE_URL npm test -- theme-mode
env -u DATABASE_URL npm test
```

**Se espera:**
- `theme-mode` pasa: lo de «Pruebas» del [plan](./plan.md);
- en la suite completa, todo pasa, como antes (57 de 57 suites, más la nueva).

## 2. Contraste

En el front:

```
npm run check:contrast
```

**Se espera:**
- una tabla por paleta, en claro y en oscuro: la de Agenda360, la de cada combinación que el sistema
  ofrece y la de los cuatro extremos;
- ninguna combinación por debajo de 4,5:1 en los textos ni de 3:1 en el resto;
- código de salida 0.

## 3. Recorrido en el navegador

**Entorno:** la API de prueba en el 4180, el `vite preview` en el 5199 y PostgreSQL en el 54400, con
los datos demo. Todo se detiene por PID al terminar, sin tocar los puertos 4000, 5173 ni 3000.

**Navegadores:** Chromium a 1440 px y WebKit a 390 px. El modo del aparato se simula con
`colorScheme: 'dark' | 'light'`.

1. **Sin destello:**
   - con el aparato en oscuro y la cuenta en «Automático», abrir el login, el panel y una recarga;
   - la captura de los primeros 100 ms no es blanca;
   - el `theme-color` es el oscuro.
2. **Elegir el modo:**
   - Configuración → Perfil → «Oscuro»: cambia sin recargar y queda en la actividad;
   - otra sesión de la misma cuenta también lo ve oscuro;
   - «Claro», y después «Automático» con el aparato en claro y en oscuro.
3. **Cada pantalla en los dos modos,** con capturas:
   - Inicio, Agenda (con varios profesionales), Pacientes, ficha, Historia clínica (odontograma y mapa
     del cuerpo), Reportes, Servicios, Horarios, Configuración (cada pestaña), Avisos, la campana, la
     pantalla de citas por cerrar, Importar pacientes y los diálogos de cita nueva y de cobro;
   - /admin: Inicio, Negocios, ficha, Analítica, Salud, Actividad y Configuración, con los colores
     del panel.

   **Se espera:** ninguna zona blanca de sobra y ningún texto ilegible.
4. **Colores del negocio:** con un negocio de colores propios y otro con un extremo (casi negro), la
   vista previa muestra el claro y el oscuro, y el panel oscuro reconoce su tono.
5. **Las páginas de los pacientes:** reservas, pago y cita, con el aparato en oscuro y en claro.
   - Siguen al aparato aunque la última elección del aparato sea otra.
   - El mapa se ve oscuro en el modo oscuro.
   - El logo va sobre su placa.
6. **Lo que sigue claro:**
   - la vista de impresión del reporte, en el modo oscuro: `emulateMedia({ media: 'print' })` muestra
     las claras;
   - el QR;
   - la vista previa de un email.
7. **Modo soporte:** el super admin, en oscuro, entra a un negocio con colores propios y lo ve oscuro
   con los colores del negocio.
8. **A 390 px,** en los dos modos, no hay desplazamiento horizontal.

## 4. Beta

En su carpeta:

```
npm run build
npm run lint
```

**Se espera:** el recorrido corto (puntos 1, 2, 3 y 5) con sus cuentas de prueba.
