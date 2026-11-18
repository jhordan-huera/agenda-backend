# Especificación: Revisión de seguridad completa (2026-11-18)

**Carpeta**: `specs/053-revision-seguridad-completa` (rama de trabajo: `dev`)

**Creada**: 2026-11-18

**Estado**: Front publicado (2026-11-18, PR #66); backend en el PR #82

**Repos**:
- **agenda-backend** (principal): el inicio de sesión del equipo, la 2FA, el canje, los archivos, los topes de cuerpo,
  la cuenta del paciente, la alerta del cron, `.npmrc` y Dependabot.
- **agenda-front**: el CAPTCHA del inicio de sesión, «Cerrar sesión en todos», el diálogo de canje, `security.txt`,
  `.npmrc`, Dependabot y `zxing-wasm`.

## Pedido del dueño

«Quiero que no me hackeen mi app… autenticación sólida, claves API fuera, base de datos protegida, HTTPS forzado,
contraseñas con hash, validar en el servidor, protección XSS, vigilar actividad rara, blindar rutas admin, consultas
parametrizadas, revisar variables de entorno, límite de peticiones, CORS restringido, cabeceras de seguridad, cookies
seguras, protección CSRF, enlaces que caducan, límite de archivos, precios y pagos en el servidor, sin modo depuración,
dependencias al día, fuera paquetes inútiles, busca archivos expuestos, busca secretos filtrados de git, revoca las
claves comprometidas, haz una revisión de seguridad a fondo, al final prueba las protecciones y dame un informe».

Después de ver la auditoría, aprobó «lo que me recomiendas»: los arreglos 1 a 12, el dispositivo de confianza con el
CAPTCHA tras 3 intentos, y `novastackcore@gmail.com` como contacto de `security.txt`.

## Requisitos

- **RF-001:** El inicio de sesión del equipo DEBE tener un tope de 100 intentos por cuenta en 24 horas desde
  conexiones nuevas, pedir el CAPTCHA después de 3 y no afectar a la conexión ni al navegador donde la cuenta ya
  entró (dispositivo de confianza, una cookie firmada que deja de valer al cambiar la contraseña).
- **RF-002:** «Servicio gratis» DEBE canjearse sólo en una cita de ese servicio, y un premio que cambia el precio no
  DEBE rebajar una sesión con varios pacientes.
- **RF-003:** Instalar dependencias NO DEBE correr scripts de instalación, y Dependabot DEBE esperar 7 días antes de
  proponer una versión.
- **RF-004:** El tope de 100 kB DEBE valer sin importar mayúsculas y para cualquier petición sin sesión del equipo.
- **RF-005:** La 2FA DEBE tener un tope de 20 códigos incorrectos en 24 horas y avisar al primer código incorrecto
  después de una contraseña correcta.
- **RF-006:** Los comprobantes de la mensualidad y los adjuntos clínicos DEBEN comprobar el tipo real del archivo.
- **RF-007:** El enlace de contraseña del paciente DEBE comprobarse antes de calcular el hash.
- **RF-008:** Los eventos de las cuentas de pacientes DEBEN quedar registrados (sin teléfonos) y avisar por ntfy si hay
  muchos en una hora, como los intentos repartidos entre muchas cuentas del equipo.
- **RF-009:** La sesión del paciente DEBE cerrarse a los 30 días sin uso (hasta 180) y poder cerrarse en todos los
  dispositivos.
- **RF-010:** Los contadores de intentos NO DEBEN guardar teléfonos.
- **RF-011:** DEBE publicarse `/.well-known/security.txt`.
- **RF-012:** Las dependencias DEBEN estar al día con versiones de al menos dos semanas, sin paquetes sin uso.

## Fuera de alcance

- Guardar con hash los tokens de los enlaces públicos (cambio grande, aparte).
- 2FA opcional para los propietarios (otra spec).
- Lo que se configura fuera del código (Vercel, Supabase, GitHub): queda en el reporte como pasos del dueño.
