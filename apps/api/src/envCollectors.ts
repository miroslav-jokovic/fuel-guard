import { z } from "zod";

/**
 * Vendor collectors on a timer: FleetPal (maintenance) and Med-Stop (drug testing).
 *
 * Split out of `env.ts` by concern (2026-11-06, ads Track G env-split): that file had reached its 500-line
 * budget, and the first casualty was a setting read from `process.env` beside the typed `Env` because there was
 * no room to declare it (D-AD8's sandbox allowlist). Spread into the one schema, so a deployment still gets one
 * parse and one error listing everything it is missing. Every key, default and parse moved unchanged, held so by
 * `envSplit.test.ts` against the pre-split schema's recorded outputs.
 */
export const collectorsEnvFields = {
  /**
   * FleetPal — the maintenance collector (FLEETPAL-INTEGRATION-PLAN.md F4, D-FP1).
   *
   * ⚠ **These two are for the hand-run smoke probe only** (`pnpm fleetpal:smoke`). The running
   * product NEVER reads a FleetPal key from the environment: a key carries its issuing user's role
   * AND company, so it is per-org by construction, and `fleetpal_credentials.api_key_sealed` is
   * where an org's key lives — sealed, with an AAD binding it to that org (`credentials.ts`). An
   * environment variable would be a second, org-blind source of truth for a secret that is not
   * global, and the first multi-org sweep would send one carrier's key to another carrier's data.
   *
   * The probe is exempt because it predates any stored credential: F4 exists to find out what the
   * vendor answers before there is a row to put a key in, and `SECRETS_ENCRYPTION_KEY` is set in
   * production and absent locally, so sealing one locally is not possible anyway.
   */
  FLEETPAL_API_KEY: z.string().optional(),
  FLEETPAL_BASE_URL: z.string().url().default("https://openapi.fleetpal.io"),
  /**
   * The collector's kill switch and its cadence (F8).
   *
   * **Default OFF.** A sweep calls a carrier's live maintenance vendor on a timer, and the one
   * thing worse than not polling is polling from two processes — `RUN_SCHEDULERS_IN_PROCESS`
   * defaults to true, so a service nobody gave that variable to runs every scheduler, which is
   * exactly how `@fleetguard/web` came to run the whole set alongside the api until 2026-09-05.
   * Opting in per environment makes the second copy a deliberate act rather than a default.
   *
   * Hourly, because every resource in the sweep is watermarked or bounded: an hourly pass over a
   * quiet collection asks `updated_after=<an hour ago>` and gets an empty page, so "too often"
   * costs one round trip per resource and "not often enough" costs a report built on yesterday.
   * ⚠ An enum, not `z.coerce.boolean()` (until 2026-10-04): `Boolean("false")` is true, so setting
   * the kill switch to "false" switched the collector ON. A typo now fails boot instead.
   */
  FLEETPAL_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  FLEETPAL_SYNC_HOURS: z.coerce.number().min(1).default(1),
  MEDSTOP_SYNC_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"), // api service only (D-MS3); the key is per org, sealed — MEDSTOP-PLAN §6
};
