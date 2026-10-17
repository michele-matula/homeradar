/** Impostata al momento della build da `.env` (WXT_REPORT_URL): chi compila senza non invia nulla. */
export const REPORT_URL: string = import.meta.env.WXT_REPORT_URL ?? '';
