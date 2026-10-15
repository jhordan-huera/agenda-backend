# Investigación: Analítica del super admin

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-10-15

Decisiones R1–R9. Cada una dice qué se eligió, por qué y qué se descartó.

## R1. Las cifras se preparan una vez al día, fuera de Vercel

- **Decisión:**
  - **Una «foto» al día:** la pasada del cron (GitHub Actions, cada 10 min) mira si ya hay una foto
    de hoy. Si no la hay y son más de las 06:00 de Ecuador, la prepara: una para 30 días y otra para
    90.
  - **Dónde se guarda:** en `analytics_snapshots` (una fila por periodo y día, con todo en JSON).
  - **La página** pide `GET /api/admin/analytics?days=30`, que lee la última foto y no calcula nada.
- **Por qué:**
  - la CPU de Vercel Hobby (4 h al mes, RF-011): las consultas pesadas corren en GitHub;
  - una foto al día basta para comparar negocios y tomar decisiones.
- **Si todavía no hay foto** (justo después de publicar), la página dice «Las cifras se preparan cada
  mañana; vuelve en unos minutos», y el cron la prepara en su próxima pasada.
- **En local:** `npm run analytics:refresh` prepara la foto contra la base local.
- **Descartado:**
  - calcular en cada visita: la CPU;
  - vistas materializadas: también se refrescarían desde algún lado, y el JSON es más simple de leer.

## R2. Las cifras de cada negocio (Historia 1)

Todo se mide en el periodo `[hoy − N días, hoy)` y en el anterior de igual duración, en la zona de
cada negocio.

| Cifra | Cómo se cuenta |
|---|---|
| Citas | Las citas con fecha en el periodo, menos las canceladas |
| Crecimiento | Citas frente a las del periodo anterior. «nuevo» si el negocio tiene menos días que el periodo, o si el periodo anterior tuvo 0 citas |
| % reservas online | Citas con `source = 'booking_page'` ÷ citas |
| % inasistencias | `no_show` ÷ (completadas + `no_show`), las ya pasadas |
| % cancelaciones | Canceladas ÷ todas las del periodo |
| % confirmadas por el paciente | Con `client_confirmed_at` ÷ citas que recibieron recordatorio o enlace |
| Pacientes activos / nuevos | Con alguna cita en el periodo / creados en el periodo, con la regla del tope del plan (`countsForPlanSql`) |
| Ingresos estimados / cobrado | Suma del precio de las completadas / de las que tienen `paid_at` |
| Ticket promedio | Ingresos estimados ÷ completadas con precio mayor que 0 |
| Uso del plan | Citas de este mes frente a 20 y pacientes frente a 50 (Free); «sin tope» en los demás |
| Agendas | Profesionales activos (y, en Business, las contratadas) |
| Último acceso | El `session.login` más reciente de alguien del equipo (la auditoría guarda 90 días) |

Si el negocio tiene menos de 10 citas en el periodo, sus porcentajes llevan «pocos datos» (RF-004).

## R3. Los tipos de negocio (Historia 2)

- **Las cifras de cada tipo (categoría):**
  - cuántos negocios activos tiene;
  - la **mediana** de cada tasa, entre los negocios con datos suficientes;
  - el ticket promedio y las citas por agenda;
  - la demanda: las citas por día de la semana y por hora, para sacar los 3 días y las 3 franjas de
    más citas.
- **Con menos de 3 negocios con datos,** el tipo dice «pocos datos».
- **«Muy distinto»** quiere decir que la tasa del negocio es el doble (o más) o la mitad (o menos) que
  la de su tipo, y que la diferencia es de al menos 5 puntos.
- **Dónde se ve:** en la tabla, como «25 % · tipo 12 %», y en la ficha del negocio en /admin, en una
  tarjeta «Frente a su tipo».
- **Por qué la mediana:** un negocio muy grande no tuerce el valor típico.

## R4. La puntuación de salud (Historia 3)

Se parte de 100 y se resta:

| Señal | Resta | Motivo que se muestra |
|---|---|---|
| Nadie del equipo entra hace más de 14 días | 30 | «Nadie del equipo entra hace N días» |
| … hace entre 7 y 14 días | 15 | ídem |
| Sin citas en el periodo | 30 | «Sin citas en los últimos N días» |
| Citas −50 % o peor frente al periodo anterior (con 10 o más antes) | 25 | «Citas −N % frente al periodo anterior» |
| … entre −20 % y −50 % | 15 | ídem |
| Más de 10 citas pasadas sin cerrar | 10 | «N citas sin cerrar» |
| Ninguna reserva online en el periodo (con la página activa) | 5 | «Sin reservas online» |
| Inasistencias muy por encima de su tipo | 5 | «Inasistencias N %, su tipo M %» |

- **Grupos:** de 70 a 100, **sano**; de 40 a 69, **en riesgo**; menos de 40, **crítico**.
- **Un negocio de menos de 14 días** sólo resta por el último acceso: está empezando.
- **La lista «En riesgo»:** los críticos primero, después los que están en riesgo, por puntuación, con
  el teléfono y el email del propietario (no de pacientes).
- **Por qué:** son reglas fijas y que se pueden leer, como pide la spec, y cada motivo dice qué hacer.
  Los pesos se pueden ajustar después con la experiencia.

## R5. «Listos para subir de plan» (Historia 3)

| Plan | Criterio | Motivo |
|---|---|---|
| Free | 80 % o más del tope de citas del mes o de pacientes (la regla de hoy, `nearLimit`) | «Usó 17 de 20 citas del mes» |
| Free y Pro | Crecimiento de +30 % o más, con 20 o más citas | «Citas +45 % frente al periodo anterior» |
| Pro | Los 3 usuarios usados | «Equipo completo: 3 de 3 usuarios» |
| Pro | 120 o más citas en 30 días con una sola agenda | «Mucha demanda para una agenda» |
| Business | Todas las agendas contratadas en uso | «Usa sus N agendas contratadas» |

«Negocios para vender» del Inicio se queda como está. La analítica tiene la lista completa, con estos
criterios y sus motivos (RF-007).

## R6. Las funciones que usa cada negocio (Historia 4)

| Función | Se usa si… (en el periodo) |
|---|---|
| Página de reservas | Hay alguna cita con `source = 'booking_page'` |
| Recordatorios | Se envió algún `appointment_reminder` |
| «Confirmo que voy» | Alguna cita tiene `client_confirmed_at` |
| Citas que se repiten | Se creó alguna serie |
| Importar pacientes | Hubo un `client.imported` (en cualquier momento) |
| Avisos en el celular | El propietario tiene un aparato activo |
| Campana | Alguien del equipo leyó un aviso |
| Historia clínica | Se registró alguna evolución |
| Pagos por transferencia | Alguna cita se marcó pagada o tiene comprobante |
| Varias agendas | Más de un profesional activo |

La **adopción** de cada función es el % de negocios activos que la usan.

## R7. El valor generado (Historia 4)

- **Por negocio, en el periodo:**
  - citas gestionadas (todas las del periodo);
  - reservas online;
  - recordatorios enviados;
  - confirmaciones del paciente;
  - cancelaciones con tiempo: las canceladas 24 horas o más antes de la cita, por el paciente o por
    el negocio, según la auditoría.
- **Inasistencias antes y después:**
  - la fecha de partida es el primer recordatorio enviado o la primera confirmación del paciente, lo
    que llegue antes;
  - se comparan los 60 días anteriores con los 60 posteriores;
  - cada lado necesita al menos 20 citas pasadas. Si no, no se muestra.
- **Totales de la plataforma:** citas, reservas online, recordatorios, confirmaciones y pacientes
  nuevos del periodo, listos para copiar («Agenda360 gestionó 1.240 citas en los últimos 30 días»).

## R8. La página

- **Dónde:** `/admin/analytics`, la «Analítica» del menú de /admin, con cuatro pestañas y el selector
  de 30 o 90 días.
- **La tabla:**
  - columnas ordenables y filtros;
  - CSV desde el navegador, con lo que se ve;
  - en el celular, se desplaza dentro de su recuadro, con la primera columna (el negocio) fija.
- **La ficha del negocio en /admin** suma la tarjeta «Frente a su tipo», con su salud y sus motivos.
- **Los gráficos** usan la librería de gráficos que ya está en el front. Sin dependencias nuevas.

## R9. Privacidad

- **La foto** sólo guarda cifras por negocio y por tipo. Los únicos datos personales son el nombre, el
  teléfono y el email de cada propietario, que el super admin ya ve en la ficha.
- **Ningún paciente:** ni nombres, ni contactos, ni notas (RF-009). Una prueba revisa la foto entera.
- **Las fotos** se guardan 30 días.
