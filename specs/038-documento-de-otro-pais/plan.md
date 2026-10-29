# Plan: Cualquier documento de identidad, de cualquier país

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-10-29 · **Migración**: No

## Enfoque

La forma la comprueba el esquema de siempre, y basta con ella:
- de 5 a 20 letras y números;
- normalizado con `normalizeDocumentId`, que quita espacios, puntos y guiones y pasa a mayúsculas.

Se quita la comprobación aparte de la cédula ecuatoriana (`documentIdError`) en la página, en el panel, en la
importación y en la API.

## Código compartido (agenda-front → `npm run sync:shared` en el backend)

- **`src/lib/identity.ts`:**
  - se quitan `documentIdError` y `documentIdMaxLength`;
  - `onlyDigits` pasa a `documentIdChars`, que deja letras y números en mayúsculas;
  - `DOCUMENT_ID_MAX_LENGTH = 20`;
  - `isValidEcuadorianCedula` queda sólo para devolver el 0 que quita Excel al importar.
- **`src/lib/validations/fields.ts`:**
  - `documentIdField` y `optionalDocumentIdField` aceptan `^[A-Z0-9]{5,20}$`;
  - el mensaje de los caracteres no válidos: «Escribe sólo letras y números, sin espacios ni guiones»;
  - `optionalDocumentField` es nuevo, para los antecedentes clínicos: normalizado, sin mínimo y con 20 como
    máximo. `optionalDigitsField` sigue para la cuenta bancaria.
- **`src/lib/validations/client-import.ts`:** sin `documentIdError`. Se mantiene el 0 de los 9 dígitos.
- **`src/lib/validations/clinical.ts`:** `optionalDocumentField` para `documentId`.

## Backend

- **`src/services/public-booking-service.ts`:** sin `documentIdError` en `resolveBookingClient` ni en
  `lookupClient`. El esquema ya lo comprueba.
- **`src/services/business-data-service.ts`:** sin `documentIdError` en `assertValidClientDocument`. Se
  mantiene el aviso del repetido.
- **Pruebas:**
  - `tests/foreign-document.test.ts`, nueva;
  - en `tests/client-import.test.ts`, las filas con el dígito verificador mal y la de 9 dígitos pasan a
    importarse, y la prueba del 096 de ayer se ajusta;
  - las demás pruebas que esperen el error de la cédula, igual.

## Front y beta

- **`features/booking/details-step.tsx`:**
  - sin `inputMode="numeric"`, con `documentIdChars` y `DOCUMENT_ID_MAX_LENGTH`, para quien reserva y para
    cada persona;
  - sin la ayuda «¿No tienes cédula ecuatoriana?»;
  - la ayuda pasa a «Cédula, pasaporte o documento de tu país, sin guiones.».
- **`features/clients/client-form-dialog.tsx` y `features/clinical/clinical-profile-form.tsx`:** lo mismo, y la
  ayuda de la ficha dice que vale cualquier documento.
- **Constitución 1.31.0 en los dos repos:** en el principio III, los pacientes se identifican por su documento,
  que puede ser la cédula, el pasaporte o el documento de cualquier país, de 5 a 20 letras y números (2026-10-29).
- **La beta:** primero una copia de seguridad y después los mismos archivos, fusionados con lo suyo.
