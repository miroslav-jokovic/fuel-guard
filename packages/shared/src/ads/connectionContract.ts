import { z } from "zod";

/**
 * Platform connections' wire contracts (ADS-AGENT-BUILD-WORKFLOW.md B1b): what Settings › Ads control
 * sends to connect a Meta account, and what the API returns about a connection. The web (E1) and the API
 * parse the same schemas.
 *
 * The view has NO token field, and no field a token could ride in: the API selects the view's columns by
 * name (`ADS_CONNECTION_VIEW_COLUMNS`), so a sealed token cannot reach a response even by `select("*")`.
 */

/**
 * Connect: an admin pastes the system-user token once (workflow §6 step 4), with the ad account and
 * Page it is for. Meta's ids are digits; the account may be pasted as Ads Manager shows it (`act_…`).
 * A token is opaque to us — only its length is bounded, so a pasted paragraph is refused.
 */
export const adsMetaConnectSchema = z.object({
  token: z.string().trim().min(20).max(1000).regex(/^\S+$/, "A token has no spaces"),
  account_id: z.string().trim().regex(/^(act_)?\d{5,20}$/, "An ad account id is digits, as Ads Manager shows it (act_ optional)"),
  page_id: z.string().trim().regex(/^\d{5,20}$/, "A Page id is digits"),
  /** Meta's sandbox ad account (staging, L4) rather than the real one. */
  sandbox: z.boolean(),
});
export type AdsMetaConnect = z.infer<typeof adsMetaConnectSchema>;

export const ADS_CONNECTION_VIEW_COLUMNS =
  "id, provider, is_sandbox, account_ref, page_ref, token_expires_on, scopes, status, last_test_at, last_test, last_error, created_at, updated_at";

export interface AdsConnectionView {
  id: string;
  provider: "meta" | "tiktok" | "x" | "higgsfield" | "simulator";
  is_sandbox: boolean;
  account_ref: string | null;
  page_ref: string | null;
  token_expires_on: string | null;
  scopes: string[];
  status: "disconnected" | "connected" | "failing";
  last_test_at: string | null;
  /** The connection test's report (its checks, the account, the Page). Never a token. */
  last_test: unknown;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
