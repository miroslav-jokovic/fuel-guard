/**
 * What became of each Pilot daily price email the API read from the mailbox (PILOT-PRICE-MAIL-PLAN §6) —
 * one row of `pilot_price_mails` (0635) as `GET /api/fueling/prices/mail` returns it, for the price drawer.
 *
 * The states are the table's CHECK, restated so the browser can name them; the database stays the authority.
 *   loaded   — the quote is in `fuel_prices` under its own Effective Date
 *   expired  — the 48-hour link had died before the API fetched it (Pilot redirects it to the portal sign-in)
 *   failed   — the download or the load went wrong; retried while the link lives, `error` says why
 *   no_link  — the email carried no link to Pilot's document service
 */
export const PILOT_PRICE_MAIL_STATES = ["failed", "loaded", "expired", "no_link"] as const;
export type PilotPriceMailState = (typeof PILOT_PRICE_MAIL_STATES)[number];

export interface PilotPriceMail {
  subject: string;
  received_at: string;
  state: PilotPriceMailState;
  attempts: number;
  /** The quote's own Effective Date (YYYY-MM-DD); set when it loaded or got as far as being read. */
  effective_date: string | null;
  prices_loaded: number | null;
  sites: number | null;
  /** Sites priced in the file but not yet on the map (HERE geocode budget); retried while the link lives. */
  geocode_pending: number | null;
  error: string | null;
  last_tried_at: string;
}

export interface PilotPriceMailsResponse {
  mails: PilotPriceMail[];
}
