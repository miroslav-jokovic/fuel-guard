/**
 * The legal documents' facts, in one place (DIRECTION-B-PLAN §6 P3, D-PR9).
 *
 * ── WHY THIS FILE EXISTS RATHER THAN THREE PAGES WITH THE SENTENCES IN THEM ─────────────────────
 * The same data matrix has to be true in FOUR places on the day we submit: this privacy policy, the
 * Apple privacy nutrition labels, the Apple privacy MANIFEST (already shipped, in
 * `apps/driver/app.config.ts` — P1.1), and the Google Play Data Safety form. Three of those four are
 * typed into a console by a person reading something. If that something is prose, the four drift,
 * and the drift is invisible until a store rejects one of them or an auditor finds two answers to
 * one question.
 *
 * So the matrix is DATA here and rendered by the page, and the two console forms are filled by
 * reading this table rather than the policy's paragraphs. `app.config.ts`'s
 * `NSPrivacyCollectedDataTypes` is the same list expressed in Apple's vocabulary; its comment points
 * back here, and the mapping is in `APPLE_TYPE` below so the correspondence is checkable rather than
 * asserted.
 */

/**
 * Document version and effective date. ONE pair for all three documents, because they are published
 * together and a reader comparing two of them should not have to work out which is newer.
 *
 * Bumped by hand when the text changes materially. `v1` is the pre-counsel draft: D-PR9 and Q-PR3
 * both say the stores need the URL rather than the sign-off, so these publish now and are marked as
 * what they are (`UNDER_REVIEW`) rather than held back until a lawyer has time.
 */
export const LEGAL_VERSION = "1.0";
export const LEGAL_EFFECTIVE = "8 September 2026";

/**
 * Whether the documents still carry the counsel-review notice. Flipped to `false` in the PR that
 * lands counsel's revisions (Q-PR3) — it is deliberately a constant rather than an env var, because
 * "has a lawyer read this" is a fact about the TEXT in this commit, not about the deployment.
 */
export const UNDER_REVIEW = true;

/**
 * The controller. "Silvicom Inc." is the organisation's own registered name — the same string the
 * `organizations` row carries in production — not a marketing name. "Silvicom 360" is the product;
 * the distinction matters in a privacy policy, because the obligations attach to the company.
 */
export const COMPANY_NAME = "Silvicom Inc.";
export const PRODUCT_NAME = "Silvicom 360";

/**
 * Support address (Q-PR4). Absent, every surface says "your fleet manager", which is TRUE today: a
 * driver's login is issued by their carrier and their first line of support is dispatch. The
 * fallback is therefore honest copy rather than a degraded state, which is why nothing here throws
 * when the variable is unset.
 */
export function supportEmail(): string | null {
  const value = import.meta.env.VITE_SUPPORT_EMAIL;
  return typeof value === "string" && value.includes("@") ? value : null;
}

/** One row of the collected-data matrix (P3.1). */
export interface DataMatrixRow {
  /** What the data is, in a driver's words rather than a schema's. */
  data: string;
  /** Linked to the identified driver. `false` means we hold it but cannot tie it to a person. */
  linked: boolean;
  /** Why we hold it. Never "analytics" — nothing here is collected for analytics. */
  purpose: string;
  /** How long, and what forces that answer. */
  retention: string;
  /** The Apple `NSPrivacyCollectedDataType` this row is declared as, or null when Apple has no
   *  matching type. Present so the driver app's privacy manifest can be checked against this table
   *  instead of against a memory of it. */
  appleType: string | null;
}

/**
 * WHAT THE DRIVER APP COLLECTS — the single source for the policy page, the Apple labels and the
 * Play Data Safety form.
 *
 * Two facts hold for EVERY row and are therefore stated once, in the page, rather than repeated as
 * columns that would always read the same: nothing here is used for tracking, and nothing here is
 * sold or shared with an advertiser. If a row ever needs a different answer to either, it stops
 * being expressible in this table and the table gains a column — which is the point of not having
 * one now.
 */
export const DATA_MATRIX: DataMatrixRow[] = [
  {
    data: "Name, Driver ID, and email address when the fleet sets one",
    linked: true,
    purpose: "Your account, and identifying you to your dispatcher",
    retention: "Employment plus 3 years (49 CFR §391.51)",
    appleType: "NSPrivacyCollectedDataTypeName / UserID / EmailAddress",
  },
  {
    data: "Photographs you take in the app — stop proof, bills of lading, damage",
    linked: true,
    purpose: "Proof of work and compliance evidence",
    retention: "3 years — these records are append-only and cannot be edited after the fact",
    appleType: "NSPrivacyCollectedDataTypePhotosorVideos",
  },
  {
    data: "Messages with dispatch, stop notes, and reasons you give for declining a load",
    linked: true,
    purpose: "Running the job",
    retention: "90 days visible in the app; retained per your fleet's retention rule",
    appleType: "NSPrivacyCollectedDataTypeOtherUserContent",
  },
  {
    data: "A push notification token for this phone",
    linked: true,
    purpose: "Sending you dispatch alerts",
    retention: "Deleted when you sign out and when your account is closed",
    appleType: "NSPrivacyCollectedDataTypeDeviceID",
  },
  {
    data: "Shifts, the truck and trailer you take, and odometer readings you enter",
    linked: true,
    purpose: "Fleet operations and hours-adjacent records",
    retention: "3 years",
    appleType: null,
  },
  {
    data: "Performance score inputs, which come from your fleet's telematics — not from this phone",
    linked: true,
    purpose: "Coaching and safety scoring",
    retention: "8 weeks visible; retained per your fleet's rule",
    appleType: null,
  },
  {
    data: "Crash diagnostics, with personal details stripped before they are sent",
    linked: false,
    purpose: "Finding and fixing crashes",
    retention: "90 days",
    appleType: "NSPrivacyCollectedDataTypeCrashData",
  },
];

/**
 * WHAT THE APP DOES NOT COLLECT. Worth stating explicitly and worth keeping as data: "we do not
 * collect your location" is the single question a driver asks about a fleet app, and the claim is
 * enforced rather than promised — `expo-location` is not a dependency (D-PR6) and BOTH Android
 * location permissions sit in `blockedPermissions`, which CI asserts against the merged release
 * manifest on every run.
 */
export const NOT_COLLECTED: string[] = [
  "Your location — the app requests no location permission, on either platform",
  "Your contacts, calendar, photo library, or microphone",
  "Health, financial, or biometric information",
  "Anything at all for advertising, and nothing is sold or shared with advertisers",
];
