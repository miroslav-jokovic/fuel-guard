import { z } from "zod";
import type { Env } from "./env.js";

/**
 * Outbound email and SMS, and the applicant nudge that is the first thing to use them unprompted.
 *
 * Split out of `env.ts` by concern (2026-11-06, ads Track G env-split): that file had reached its 500-line
 * budget, and the first casualty was a setting read from `process.env` beside the typed `Env` because there was
 * no room to declare it (D-AD8's sandbox allowlist). Spread into the one schema, so a deployment still gets one
 * parse and one error listing everything it is missing. Every key, default and parse moved unchanged, held so by
 * `envSplit.test.ts` against the pre-split schema's recorded outputs.
 */
export const mailEnvFields = {
  // A10's abandonment nudge — the first thing here that emails an APPLICANT unprompted, so it gets
  // its own switch. Default ON: a recapture feature nobody turns on does not exist, and the real
  // safeguards are structural (one nudge per invitation ever, nothing before 48 h, nothing without a
  // mail provider). False stops the driver email and leaves the office alert.
  APPLICATION_NUDGE_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),

  // A11b's SMS transport (Telnyx since 2026-09-06 — Twilio was never used, and its half-configured
  // branch was removed rather than left as a second way to do this). `none` until the account has a
  // number and 10DLC registration completes, and every send is a no-op until then. Consent, quiet
  // hours and opt-out live in `applicationSms.ts`, so flipping this cannot bypass them.
  SMS_PROVIDER: z.enum(["telnyx", "none"]).default("none"),
  TELNYX_API_KEY: z.string().optional(),
  // Ed25519 public key from the Telnyx portal, base64, 32 bytes decoded. Verifies inbound webhooks.
  // Unset means nothing can be verified, so nothing is accepted — never a development bypass.
  TELNYX_PUBLIC_KEY: z.string().optional(),
  // The sending number in E.164. Telnyx also accepts a messaging profile id, which picks a number
  // from a pool; either identifies the sender, and one of them must be set for a send to happen.
  TELNYX_FROM: z.string().optional(),
  TELNYX_MESSAGING_PROFILE_ID: z.string().optional(),

  // Phase 8 — email notifications. Default 'none' = no-op (the app still runs).
  // Auto-detected: if RESEND_API_KEY or BREVO_API_KEY is set and MAIL_PROVIDER is not explicitly
  // specified, the provider is activated automatically — no need to set both vars.
  MAIL_PROVIDER: z.enum(["resend", "brevo", "none"]).default("none"),
  RESEND_API_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  // Sender for outbound email.
  // Default uses Resend's shared test sender (onboarding@resend.dev) — no domain verification
  // required, works with just a RESEND_API_KEY. Switch to your own verified domain address
  // (e.g. "Silvicom 360 <miki@silvicominc.com>") once you have DNS access to verify silvicominc.com
  // in resend.com/domains.
  MAIL_FROM: z.string().default("Silvicom 360 <onboarding@resend.dev>"),
};

/** Called by `loadEnv` after parsing: the provider auto-detection and the Brevo warning, unchanged. */
export function applyMailProvider(env: Env): void {
  /**
   * Auto-detect the provider when MAIL_PROVIDER is left at the default "none".
   *
   * ⚠ **RESEND WINS NOW, AND THIS USED TO BE THE OTHER WAY ROUND.** Brevo was preferred because it
   * verifies a single sender with no DNS, which is the cheaper start. That reasoning weighed setup
   * effort and missed the thing that matters more: **Brevo rewrites every link for click tracking
   * and keeps the destination URL in its event log**, and the links this product emails are
   * credentials. Measured 2026-09-14 — an applicant's live invitation token was read back out of
   * `GET /v3/smtp/statistics/events` in plaintext, and its SHA-256 matched `token_hash` in the
   * database exactly. `applicationIntake.ts` keeps that token out of the database, out of the API
   * response after the first show, and out of the audit row on the argument that "an audit log is
   * the last place a credential should be recoverable from". A third-party analytics log is worse.
   *
   * It cannot be turned off on Brevo: their staff have said disabling transactional tracking is not
   * planned and is offered to Enterprise plans on request, and this account reports
   * `enterprise: false`. Resend disables open and click tracking by default on every domain and
   * exposes it per-domain (`PATCH /domains/:id`), which is why the preference is now reversed
   * rather than a warning being bolted onto the old order.
   */
  if (env.MAIL_PROVIDER === "none") {
    if (env.RESEND_API_KEY) {
      console.info("[env] MAIL_PROVIDER auto-set to 'resend' (RESEND_API_KEY is present)");
      (env as { MAIL_PROVIDER: string }).MAIL_PROVIDER = "resend";
    } else if (env.BREVO_API_KEY) {
      console.info("[env] MAIL_PROVIDER auto-set to 'brevo' (BREVO_API_KEY is present)");
      (env as { MAIL_PROVIDER: string }).MAIL_PROVIDER = "brevo";
    }
  }

  /**
   * Say it in the deploy log, every boot, for as long as it is true.
   *
   * A warning rather than a refusal on purpose: refusing would stop invitations going out at all,
   * and an applicant who never receives a link is worse off than one whose link is also sitting in
   * an analytics log we control the account for. But it is not a silent trade — no gate can see a
   * Railway variable, and the person who needs to read this is reading `railway logs` anyway.
   */
  if (env.MAIL_PROVIDER === "brevo") {
    console.warn(
      "[env] ⚠ MAIL_PROVIDER=brevo — Brevo rewrites links for click tracking and stores the "
      + "destination URL in its event log, so every emailed invitation token is recoverable from "
      + "the Brevo API. Tracking cannot be disabled below an Enterprise plan. Move to Resend "
      + "(tracking off by default) before sending links to people outside the company.",
    );
  }
}
