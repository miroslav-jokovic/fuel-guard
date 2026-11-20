import { z } from "zod";

/**
 * The Tenstreet connection as Settings › Recruiting shows and saves it (TENSTREET-INTAKE-PLAN TS4; 0640's
 * `tenstreet_connections`). The receiver (`recruiting/tenstreet/receive.ts`) is the reader of every field here;
 * this file is only what crosses the wire, so the API and the card hold one shape.
 *
 * ── WHAT NEVER CROSSES ──────────────────────────────────────────────────────────────────────────
 * The URL's secret is shown ONCE, in the rotate answer (`TenstreetKeyIssued`), and is never stored: the table
 * holds its SHA-256 and its last four characters. The status carries the hint and the address with the secret
 * masked, so a screenshot of the card cannot post an application.
 *
 * ── WHY `mode` IS TWO WORDS AND NOT A BOOLEAN ───────────────────────────────────────────────────
 * Tenstreet's guide sends `<Mode>TEST</Mode>` or `<Mode>PROD</Mode>` in every post (R4, read 2026-11-20), and the
 * receiver refuses a post in the other mode by name. The connection says which one it expects, in the guide's
 * own two words (lower-case in the table, 0640's check).
 */

export const TENSTREET_CONNECTION_MODES = ["test", "prod"] as const;
export type TenstreetConnectionMode = (typeof TENSTREET_CONNECTION_MODES)[number];

/** 0640's check (`company_id ~ '^[0-9]{1,20}$'`), in the office's words. */
export const TENSTREET_COMPANY_ID_PATTERN = /^[0-9]{1,20}$/;

export const tenstreetConnectionSaveSchema = z
  .object({
    companyId: z.string().trim().regex(TENSTREET_COMPANY_ID_PATTERN, "Tenstreet's Company ID is a number of up to 20 digits."),
    mode: z.enum(TENSTREET_CONNECTION_MODES),
    enabled: z.boolean(),
  })
  .strict();
export type TenstreetConnectionSave = z.infer<typeof tenstreetConnectionSaveSchema>;

/** What reached the connection in the last seven days, from the post log (`tenstreet_posts`). */
export interface TenstreetPostCounts {
  /** Kept and answered ACCEPTED. */
  accepted: number;
  /** Answered REJECTED (wrong mode, not Tenstreet's XML, no DriverId, …): nothing was kept. */
  rejected: number;
  /** Accepted, but could not become a lead (`process_error`). Should be zero; the card says so when not. */
  failed: number;
}

/** The latest thing that went wrong, read from the log — never a stored sentence that nothing writes. */
export interface TenstreetLastProblem {
  at: string;
  /** `rejected`: our answer refused the post. `failed`: accepted, then could not become a lead. */
  kind: "rejected" | "failed";
  /** The receiver's fixed reason (`wrong_mode`, `not_xml`, …) or the job's `process_error`. */
  reason: string;
  /** What the office reads: for a refusal, the sentence Tenstreet was answered with; for a failure, what to do. */
  text: string;
}

export interface TenstreetConnectionStatus {
  /** False until a Company ID is saved: the card then shows only the form. */
  configured: boolean;
  companyId: string | null;
  mode: TenstreetConnectionMode;
  enabled: boolean;
  /** Last four characters of the current secret; null before the first key. */
  keyHint: string | null;
  rotatedAt: string | null;
  lastPostAt: string | null;
  /**
   * The address to give Tenstreet with the secret masked (`…/api/webhooks/tenstreet/••••abcd`). Null when this
   * deploy has no `PUBLIC_API_URL`, so the card says the address cannot be known rather than printing a path.
   */
  endpointMasked: string | null;
  /** False when the server cannot seal a post (`SECRETS_ENCRYPTION_KEY` unset): every post would answer 503. */
  receiverReady: boolean;
  last7Days: TenstreetPostCounts;
  lastProblem: TenstreetLastProblem | null;
}

/** The rotate answer: the only time the secret, and the whole address, leave the server. */
export interface TenstreetKeyIssued {
  key: string;
  keyHint: string;
  /** Null when `PUBLIC_API_URL` is unset — the key alone is then shown, with the path. */
  endpoint: string | null;
  rotatedAt: string;
}
