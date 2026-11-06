import { z } from "zod";

/**
 * FMCSA PSP (HIRING-PLAN H7). The token-selection rules stay in `lib/pspEnv.ts`.
 *
 * Split out of `env.ts` by concern (2026-11-06, ads Track G env-split): that file had reached its 500-line
 * budget, and the first casualty was a setting read from `process.env` beside the typed `Env` because there was
 * no room to declare it (D-AD8's sandbox allowlist). Spread into the one schema, so a deployment still gets one
 * parse and one error listing everything it is missing. Every key, default and parse moved unchanged, held so by
 * `envSplit.test.ts` against the pre-split schema's recorded outputs.
 */
export const pspEnvFields = {
  // ── FMCSA PSP (HIRING-PLAN H7) ────────────────────────────────────────────────────────────────
  // The token is per PSP ACCOUNT, and an account belongs to a carrier. It lives in env rather than
  // in `org_integrations` because exactly one org has a PSP account today, and a per-org table with
  // one row in it is an abstraction accommodating a case that does not exist yet. When a second
  // carrier arrives this moves, and PSP-PLAN P3 is where that is written down.
  //
  // Tokens are PER ENVIRONMENT and expire after 60 days (§4.2). `PSP_ENVIRONMENT` decides the host,
  // and getting it wrong is not a harmless misconfiguration: a production request BILLS.
  //
  // One variable per PSP ACCOUNT, selected by `PSP_ENVIRONMENT` — so a token cannot be paired
  // with the other account's host. Why that is structural rather than a convention, and the two ways
  // the pair can still be wrong, are in lib/pspEnv.ts.
  PSP_API_KEY_UAT: z.string().optional(),
  PSP_API_KEY_PRODUCTION: z.string().optional(),
  PSP_ENVIRONMENT: z.enum(["uat", "production"]).default("uat"),
  /** §5.4.1 requires a DOT number or a Motor Carrier ID; PSP refuses the request without one (§8.5 detail 10). */
  PSP_DOT_NUMBER: z.string().optional(),
  PSP_MOTOR_CARRIER_ID: z.string().optional(),
  /**
   * The kill switch, and it defaults to OFF. `extractionEnabled` is the precedent: a credential being
   * present is not consent to spend on it, and PSP bills on Success, Partial AND Failure (§8). An
   * integration that starts buying the moment a key lands in the environment is one nobody chose.
   */
  /** The SECOND switch in front of production; neither means anything alone. See lib/pspEnv.ts. */
  PSP_PRODUCTION_ACKNOWLEDGED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  PSP_ORDERS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Records per org per calendar month. A runaway loop must hit a ceiling, not an invoice. */
  PSP_MONTHLY_LIMIT: z.coerce.number().int().positive().default(50),
  /**
   * What one transaction costs, in USD — and NO default, deliberately (PSP-PLAN Q2 is unanswered).
   *
   * P9 says the confirmation states the cost before the operator commits. A number we invented would
   * state it falsely, and the difference between "$10 per record" and "we have not been told the
   * price" is exactly what somebody approving a spend needs to know. Unset, the confirmation says
   * the transaction bills and shows the monthly budget instead; set, it also shows the amount.
   */
  PSP_UNIT_PRICE_USD: z.coerce.number().positive().optional(),
};
