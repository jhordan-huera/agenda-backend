# Especificación: Pruebas automáticas en cada PR

**Carpeta**: `specs/045-pruebas-en-cada-pr` (rama de trabajo: `dev`) · **Creada**: 2026-11-12

**Estado**: Publicada (2026-11-12, PR backend #75 y front #59). Aprobada el 2026-11-12, «si acepto con lo recomendado procede por favor»

**Repos**:
- **agenda-backend:** las comprobaciones automáticas del backend.
- **agenda-front:** las comprobaciones automáticas del front.
- **La beta:** no lo lleva.

## Pedido

El dueño del producto, el 2026-11-12, después de ver los huecos que quedaban:

> vamos con 1 procede

**El hueco, comprobado:**
- **En los PR sólo corre GitGuardian**, que busca secretos.
- **Nada más se comprueba solo:** las 73 suites de pruebas del backend, el chequeo de tipos, la compilación, el lint y
  las comprobaciones del front sólo corren cuando Claude las ejecuta en el equipo del dueño del producto.
- **El front no tiene ningún flujo automático en GitHub.**
- **Vercel compila sólo `main`** (las vistas previas están apagadas): un error del front se descubre al publicar.
- **Dependabot abre cada semana PR a `dev`** con varias librerías a la vez (el #41 del front subió 9) y nadie los
  prueba.
- **`main` no tiene protección:** se puede fusionar aunque algo esté roto.

**Para qué sirve:** saber, antes de fusionar un PR, si rompe algo. Así un error no llega a los profesionales ni a los
pacientes.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Cada PR dice si pasa las comprobaciones (Prioridad: P1)

**Por qué esta prioridad:** es lo que se pidió. Sin esto, un PR roto se fusiona igual.

**Prueba independiente:** se abre un PR de prueba con un cambio que rompe una prueba. El PR sale en rojo y dice qué
falló; al arreglarlo, sale en verde.

1. **Dado** un PR del backend (a `dev` o a `main`), **entonces** el PR muestra, al cabo de unos minutos, si pasan el
   chequeo de tipos y todas las suites de pruebas, en verde o en rojo.
2. **Dado** un PR del front, **entonces** el PR muestra si pasan la compilación, el lint y todas las comprobaciones.
3. **Dado** que algo falla, **entonces** el PR dice qué comprobación falló y deja ver el detalle. El dueño del
   producto recibe un aviso de GitHub.
4. **Dado** que se sube otra versión del mismo PR mientras corren las comprobaciones, **entonces** las de la versión
   anterior se cancelan y corren las de la nueva.
5. **Dado** un cambio que Claude sube a `dev` sin PR, **entonces** también se comprueba (respuesta 2).

### Historia 2 - Los PR de Dependabot se prueban (Prioridad: P1)

**Por qué esta prioridad:** son los que más librerías cambian de una vez y hoy nadie los prueba.

**Prueba independiente:** el siguiente PR de Dependabot sale en verde o en rojo como cualquier otro.

1. **Dado** un PR de Dependabot a `dev`, **entonces** corren las mismas comprobaciones del repo, aunque Dependabot no
   tenga acceso a secretos: las comprobaciones no los necesitan.
2. **Dado** un PR de Dependabot en verde, **entonces** el dueño del producto lo sigue revisando y fusionando él
   (respuesta 3).

### Historia 3 - No se fusiona a `main` algo roto (Prioridad: P2)

**Por qué esta prioridad:** el aviso en rojo ya ayuda. Bloquear es un paso más de seguridad.

**Prueba independiente:** con una comprobación en rojo, GitHub no deja fusionar el PR de `dev` a `main`.

1. **Dado** un PR a `main` con una comprobación en rojo, **entonces** GitHub no deja fusionarlo
   (respuesta 1).
2. **Dado** que todas pasan, **entonces** se fusiona como hoy.

### Casos límite

- **Una prueba que falla a veces sin motivo:** se ve en rojo. El dueño del producto puede volver a correrla desde el
  PR, y la prueba se arregla en una función aparte.
- **GitHub Actions caído** (como el 2026-11-11): las comprobaciones quedan pendientes y se pueden volver a correr
  cuando GitHub vuelva. El cron y la copia siguen como hoy.
- **Un PR sólo con documentación** (specs, README): corren igual. Son minutos gratis.
- **Los registros son públicos:** las pruebas usan datos demo, nunca datos reales, y no imprimen claves.

## Requisitos *(obligatorio)*

- **RF-001**: Cada PR del backend DEBE correr el chequeo de tipos y todas las suites de pruebas, con su propia base de
  datos desechable.
- **RF-002**: Cada PR del front DEBE correr la compilación, el lint y todas las comprobaciones.
- **RF-003**: El resultado DEBE verse en el PR, en verde o en rojo, con el detalle de qué falló.
- **RF-004**: Las comprobaciones NO DEBEN usar secretos, la base de producción, Vercel ni Lambda, y NO DEBEN imprimir
  datos reales ni claves.
- **RF-005**: DEBEN correr también en los PR de Dependabot.
- **RF-006**: Una versión nueva del mismo PR DEBE cancelar las comprobaciones de la anterior.
- **RF-007**: DEBEN correr en cada PR a `dev` o a `main` y en cada subida a `dev` (respuesta 2).
- **RF-008**: Fusionar a `main` con una comprobación en rojo DEBE estar bloqueado (respuesta 1).
- **RF-009**: Los flujos que ya existen (el cron, la copia y la publicación en Lambda) NO DEBEN cambiar.
- **RF-010**: La constitución DEBE pasar a 1.44.0 en los dos repos, con las comprobaciones automáticas en el flujo de
  trabajo.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Un PR de prueba con una prueba rota sale en rojo con el nombre de lo que falló. Arreglado, sale en verde.
  En los dos repos.
- **CE-002**: El PR que trae esta función sale en verde en los dos repos.
- **CE-003**: Las comprobaciones de un PR terminan en menos de 20 minutos.
- **CE-004**: No cuestan nada: los repos son públicos y no se gasta CPU de Vercel.
- **CE-005**: El siguiente PR de Dependabot sale en verde o en rojo sin que nadie haga nada.

## Supuestos

- **Los repositorios siguen siendo públicos**, así que GitHub Actions es gratis para ellos.
- **No hace falta migración** ni cambios en la app: sólo flujos de GitHub y la constitución.
- **Las pruebas de hoy pasan** (73 de 73 el 2026-11-11). Si alguna falla sólo en GitHub, se arregla dentro de esta
  función.
- **La beta no lo lleva.**

## Respuestas del dueño del producto (2026-11-12)

«Si acepto con lo recomendado procede por favor»:

1. **Se bloquea fusionar a `main` si algo falla,** con una regla de GitHub. La pone el dueño del producto con los pasos
   del plan, o Claude con su permiso.
2. **Corren en cada PR a `dev` o a `main`, y en cada subida a `dev`.**
3. **Los PR de Dependabot no se fusionan solos:** el dueño del producto los sigue revisando y fusionando.
