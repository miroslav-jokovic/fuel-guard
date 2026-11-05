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
  /** The connection test's report (its checks, the account, the Page); null until the first test. Never a token. */
  last_test: AdsConnectionReport | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The connection test's report (`platforms/meta/connectionTest.ts` writes it; B1). Here, not in the API,
 * because Settings › Ads control draws it from `last_test` and from a refused connect's answer (E1b): one
 * definition both sides compile against, so a check the API adds is a check the page must name.
 */
export const ADS_CONNECTION_CHECKS = ["token", "permissions", "ad_account", "currency", "spending_limit", "page", "leadgen"] as const;
export type AdsConnectionCheckKey = (typeof ADS_CONNECTION_CHECKS)[number];

export interface AdsConnectionCheck {
  key: AdsConnectionCheckKey;
  /** null = not reached (an earlier check made it meaningless). */
  ok: boolean | null;
  detail: string;
}

export interface AdsConnectionReport {
  ok: boolean;
  checks: AdsConnectionCheck[];
  user: { id: string; name: string | null } | null;
  account: { id: string; name: string | null; account_status: number | null; currency: string | null; spend_cap_cents: number | null; amount_spent_cents: number | null } | null;
  page: { id: string; name: string | null; tasks: string[] } | null;
  scopes_granted: string[];
  scopes_extra: string[];
  /** The first failed check's Meta code (`token_invalid`, `meta_100`…) or the check's own key. */
  error_code: string | null;
}
