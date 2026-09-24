/**
 * The identity step's words (AF3, D-AF1) — the date of birth and licence, asked with the permissions.
 *
 * ── WHY A THIRD FILE ──────────────────────────────────────────────────────────────────────────
 * `strings.ts` and `strings.flow.ts` both sit within a few lines of the 500-line budget. This copy
 * is one screen's, and it is spread into `APPLY_COPY` exactly as `strings.flow.ts` is, so
 * `strings.test.ts` still walks it and no component imports it directly.
 *
 * ── WHAT THE SCREEN HAS TO SAY, AND WHY ───────────────────────────────────────────────────────
 * A driver asked for their date of birth and licence before any form is shown is owed the reason,
 * and the reason is concrete: the carrier checks the licence and the safety record with these,
 * before it sends the application. Said without a citation — the strings test keeps CFR references
 * off a driver's phone — and without promising a timeline the carrier has not set.
 */
export const APPLY_IDENTITY_COPY = {
  identityStep: {
    heading: "Your driver's licence",
    intro: (carrier: string): string =>
      `${carrier} checks your driving record and safety history with these before sending you the application. Enter them as they appear on your licence.`,
    dateOfBirth: "Date of birth",
    number: "Licence number",
    state: "Issuing state",
    stateHint: "Start typing to find it.",
    photosHeading: "Photos of your licence",
    photosIntro: "Both sides, if you can. If your camera will not open, carry on — the office can ask for them later.",
    action: "Continue",
    working: "Saving…",
    failed: "That did not save. Check your signal and try again.",
    /**
     * What a blank field says. The schema's own words ("Invalid input", "Expected a date as
     * YYYY-MM-DD") are for developers; its date-of-birth MEANING rules — at least 18, a real date —
     * are kept, because they name what to fix.
     */
    missing: {
      date_of_birth: "Enter your date of birth.",
      cdl_number: "Enter the number on your licence.",
      cdl_state: "Choose the state that issued your licence.",
    },
    /** Fill-only (D-AF8): a value the carrier already held was kept. Says so without saying what it is. */
    kept: (carrier: string): string =>
      `${carrier} already had some of these on file, so those were kept. If anything is wrong, tell ${carrier}.`,
    /** On the form, once the identity is on file (AF3): the three fields are shown and not editable. */
    lockedHint: (carrier: string): string => `To change this, contact ${carrier}.`,
  },
} as const;
