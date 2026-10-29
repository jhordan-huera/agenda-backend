# Especificación: Cualquier documento de identidad, de cualquier país

**Carpeta**: `specs/038-documento-de-otro-pais` (rama de trabajo: `dev`) · **Creada**: 2026-10-29

**Estado**: Implementada (2026-10-29)

**Repos**:
- **agenda-backend:** la reserva online, la ficha del paciente y la importación aceptan cualquier documento.
- **agenda-front:** las mismas reglas, que se comparten con el backend, y los mismos campos de siempre.
- **La beta:** lo mismo.

## Pedido

El dueño del producto, el 2026-10-29: «que me funcione con toda cédula de todos los países». Por ejemplo:
el negocio está en Ecuador y una persona de otro país quiere atenderse allí.

Hoy, en un negocio de Ecuador, sólo pasa una cédula ecuatoriana válida: 10 dígitos, la provincia y el dígito
verificador. Quien sólo tiene su pasaporte o la cédula de su país no puede reservar por la página ni
registrarse en el panel. Fuera de Ecuador se acepta cualquier número, pero nunca letras.

**Decisiones del dueño del producto (2026-10-29):**
1. **Sin campos nuevos:** el mismo campo de siempre, sin selector ni opciones. Descartó el plan con
   «Cédula ecuatoriana» / «Pasaporte u otro país» que se le propuso antes.
2. **Se acepta cualquier documento de cualquier país:** de 5 a 20 letras y números, sin comprobar el dígito
   verificador de la cédula ecuatoriana. Cambia la decisión del 2026-10-04 («sólo números, sin pasaportes»).
3. **Riesgo aceptado:** una cédula ecuatoriana mal escrita ya no se detecta, y puede crear un paciente repetido.

## Escenarios de uso y pruebas *(obligatorio)*

### Historia 1 - Un extranjero reserva por la página (Prioridad: P1)

1. **Dado** la página de reservas de un negocio de Ecuador, **cuando** una persona de otro país escribe su
   documento en el campo de siempre (por ejemplo `V-12.345.678` o `AB1234567`), **entonces** la reserva sale
   como cualquier otra.
   - El documento se guarda sin espacios, puntos ni guiones y en mayúsculas.
   - En el celular, el teclado deja escribir letras.
2. **Dado** una sesión en pareja o en familia, **entonces** pasa lo mismo con cada persona.
3. **Dado** que vuelve a reservar con el mismo documento, **entonces** se le reconoce como a cualquier paciente:
   si coinciden su email o su teléfono, es la misma ficha; si no, la reserva queda «Por verificar».

### Historia 2 - El negocio registra a un paciente extranjero (Prioridad: P1)

1. **Dado** «Nuevo paciente» o «Editar» en el panel, o los antecedentes de la historia clínica, **entonces** el
   campo de siempre acepta el documento de otro país.
2. **Dado** un documento que ya es de otro paciente del negocio, **entonces** se avisa como hoy.

### Historia 3 - Importar pacientes con documentos de otros países (Prioridad: P2)

1. **Dado** un Excel con documentos extranjeros, **entonces** se importan.
2. **Dado** una cédula ecuatoriana de 9 dígitos a la que Excel le quitó el 0, **entonces** se le sigue
   poniendo, como hoy, si así es una cédula válida.

### Casos límite

- **Las mayúsculas:** `ab123456` y `AB123456` son el mismo documento.
- **La ayuda «¿No tienes cédula ecuatoriana?»** de la página de reservas desaparece, porque ya no hace falta.
- **Los textos de ayuda** que decían «Sólo números» pasan a decir que vale cualquier documento. Las etiquetas
  siguen igual.

## Requisitos *(obligatorio)*

- **RF-001**: La reserva online, la ficha del paciente, los antecedentes de la historia clínica y la importación DEBEN aceptar cualquier documento de 5 a 20 letras y números, en cualquier país, sin campos nuevos.
- **RF-002**: La API DEBE aplicar la misma regla.
- **RF-003**: El reconocimiento del paciente («Por verificar», duplicados) DEBE funcionar igual con cualquier documento.
- **RF-004**: La constitución y la beta DEBEN recoger el cambio.

## Criterios de éxito *(obligatorio)*

- **CE-001**: Las pruebas del backend cubren:
  - reservar con un documento de otro país, como quien reserva y como otra persona de la sesión;
  - volver a reservar con el mismo documento;
  - la ficha con un documento de otro país y uno repetido;
  - la importación;
  - un documento con menos de 5 caracteres o con símbolos.
- **CE-002**: `typecheck` y `npm test` en el backend, y build, lint, `check:contrast` y `check:data-export` en el front, sin errores. La beta, build y lint.
- **CE-003**: El recorrido funciona en el computador y en el celular: reservar con un documento de otro país y registrarlo desde el panel.

## Supuestos

- **Sin migración:** la base ya acepta de 5 a 20 letras mayúsculas y números (`clients_document_id_check`, migración 006). Los antecedentes de la historia clínica no tienen restricción en la base.
- **Los números de cuenta bancaria** («Cédula/RUC» del titular) no cambian: no son el documento del paciente.
