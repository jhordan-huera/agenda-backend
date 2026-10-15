// Copia de agenda-front/src/lib/validations/notices.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import { z } from "zod";
import { NOTICE_LIST_SIZE, NOTICE_PAGE_MAX } from "../constants/notices.ts";

/**
 * Centro de avisos del panel (spec 014): los parámetros de la lista (GET …/notices). La API los
 * valida con este esquema; el front los arma con useNoticeList.
 */

/** El `nextCursor` de la página anterior: la fecha exacta (UTC, hasta microsegundos) y el id del último. */
export const NOTICE_CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const noticeListQuerySchema = z.object({
  limit: z.coerce
    .number({ error: "La cantidad de avisos no es válida" })
    .int("La cantidad de avisos no es válida")
    .min(1, "Pide al menos un aviso")
    .max(NOTICE_PAGE_MAX, `Como mucho ${NOTICE_PAGE_MAX} avisos por página`)
    .default(NOTICE_LIST_SIZE),
  /** "1": sólo los no leídos. */
  unread: z.literal("1", { error: "El filtro de no leídos no es válido" }).optional(),
  cursor: z.string().regex(NOTICE_CURSOR_PATTERN, "La página de avisos no es válida").optional(),
});

export type NoticeListQuery = z.infer<typeof noticeListQuerySchema>;
