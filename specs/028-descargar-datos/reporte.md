# Reporte final: Descargar los datos del negocio

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Tareas**: [tasks.md](./tasks.md)

**Estado**: Implementada en dev · **Fecha**: 2026-10-20

**Repos**: los dos (la beta no lo lleva) · **Migración**: No

## Resumen

**Quién descarga:**
- **El propietario**, en Configuración → Negocio («Descargar los datos del negocio»).
- **Cada profesional**, en su Perfil («Descargar mis datos»).

Sólo ellos: el super admin (tampoco en modo soporte), el administrador y la recepción no reciben nada.

**Qué trae el ZIP** (`agenda360-<negocio>-<fecha>.zip`):
- `pacientes.xlsx`, con las columnas de la importación;
- `citas.xlsx`;
- una página de historia clínica por paciente, que se abre en el navegador y se guarda como PDF;
- los archivos adjuntos originales;
- un `LEEME.html`.

**Cómo funciona:**
- El ZIP se arma en el navegador, con los datos pedidos por partes.
- Cada descarga deja una sola entrada en la actividad.
- «Eliminar negocio» en /admin recuerda pedir la descarga y muestra la última.
- La política de privacidad dice que la portabilidad se hace desde el panel.

## Comprobación

| Requisito o criterio | Resultado | Cómo se comprobó |
|---|---|---|
| RF-001 – El propietario descarga todo | Cumple | `data-export` y recorrido: el ZIP trae los dos Excel, el LEEME y una historia por paciente con historia (2 de 2). Las 209 citas del negocio están en el Excel |
| RF-002 – El profesional, sólo lo suyo | Cumple | `data-export` y recorrido: Valeria recibe sólo sus 64 citas de las 209. Sin acceso clínico no hay historias |
| RF-003 – Nadie más | Cumple | `data-export`: el soporte, el administrador y la recepción reciben 403 en cada ruta. Recorrido: en modo soporte no está la tarjeta |
| RF-004 – El Excel se vuelve a importar | Cumple | `check:data-export`: `guessColumns` reconoce todos los encabezados de `pacientes.xlsx` |
| RF-005 – La actividad | Cumple | `data-export` y recorrido: «Descargó los datos del negocio (…)» y «Descargó sus datos (…)», una por descarga, sin «Consultó la historia clínica» por paciente |
| RF-006 – Negocios grandes | Cumple | `data-export`: partes de 500 pacientes, 1000 citas y 50 historias (hasta 1000 evoluciones). La suma coincide con la base y no hay repetidos |
| RF-007 – Al eliminar y la política | Cumple | Recorrido: el diálogo recuerda la descarga. La política, revisada |
| CE-001 a CE-005 | Cumple | Recorrido: 11 ✓ en Chromium a 1440 px y en WebKit a 390 px (oscuro). El ZIP se abre con el Finder y las historias, en el navegador |

**Pruebas automáticas:**
- **Backend:**
  - `npm run typecheck`, sin errores;
  - `data-export`: 60 ✓;
  - la suite completa: 65 de 66. Falla `public-abuse.test.ts` (3 ✗, «Este negocio no puede recibir más reservas online este mes»). **Ya fallaba antes de esta spec**, porque depende de la fecha: reserva para el mes siguiente y choca con el tope del plan gratis. Se comprobó sobre el commit anterior.
- **Front:** build, lint, `check:contrast` y `check:data-export` (40 ✓).

## Cambios respecto al plan

- **Historias por parte:** además de 50 pacientes, como mucho 1000 evoluciones, para quedar lejos del tope de 6 MB de Lambda.
- **El nombre de cada historia** es «Nombre de la ficha - cédula», porque el nombre es un solo campo.
- **Funciones movidas,** para reutilizarlas también con Node sin duplicarlas: `formatCount` a `lib/format.ts`, y algunas funciones de los formatos clínicos a `lib/clinical-templates.ts` y `clinical-labels.ts`.
- **«Eliminar negocio»** dice «No descargó sus datos en los últimos 5 meses», no «Nunca», porque la actividad se guarda 5 meses.
- **La política de privacidad** dice además que el soporte tampoco descarga los datos.

## Pendientes y riesgos

- **Muchos archivos adjuntos:** el límite de 600 peticiones cada 15 minutos alcanza para unos 550 archivos por descarga. Si se pasa, los que falten quedan en el LEEME y se puede descargar otra vez más tarde.
- **La descarga de archivos desde Supabase** no se pudo probar en local, que usa almacenamiento propio. Hay que comprobarlo al publicar con un negocio que tenga archivos.
- **El `unzip` de la terminal de macOS** no muestra bien las tildes de los nombres. El Finder y Windows sí.
- **`public-abuse.test.ts`** hay que arreglarlo aparte (ver arriba).

## Commits

| Repo | Commit | Mensaje |
|---|---|---|
| agenda-backend | 6958011 | Spec 028: descargar los datos del negocio (API, pruebas, spec, plan y tareas) |
| agenda-front | 08ab5af | Spec 028: descargar los datos del negocio (el ZIP en el navegador, la tarjeta y el recordatorio al eliminar) |

## Cómo publicarlo

1. **Sin migración.** Primero el PR del backend y después el del front.
2. **Después:** como propietario, descargar los datos de un negocio con archivos adjuntos y abrir el ZIP.

## Texto para el PR

Spec 028: descargar los datos del negocio.
- **El propietario** descarga todo y **cada profesional** lo suyo, en un ZIP: pacientes y citas en Excel, una
  historia clínica por paciente (para guardar como PDF) y sus archivos.
- **El super admin no descarga nada**, tampoco en modo soporte.
- **Cada descarga** queda en la actividad.
- **«Eliminar negocio»** recuerda pedirla.

**Migración:** ninguna.

Reporte: https://github.com/jhordan-huera/agenda-backend/blob/main/specs/028-descargar-datos/reporte.md
