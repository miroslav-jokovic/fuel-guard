/**
 * The driver handbook's words on the applicant's page (HANDBOOK-SIGNING-PLAN.md, D-HB1).
 *
 * ── WHY ITS OWN FILE ──────────────────────────────────────────────────────────────────────────
 * `strings.ts` and `strings.flow.ts` sit near the 500-line budget. This is one screen's copy, spread
 * into `APPLY_COPY` exactly as `strings.identity.ts` is, so `strings.test.ts` still walks it (and
 * still keeps CFR references off a driver's phone).
 *
 * ── WHAT THE SCREEN HAS TO SAY ────────────────────────────────────────────────────────────────
 * The handbook comes after the application and is opened by the carrier in their office, so before
 * that the page says where it happens and nothing more. While it is open, the driver is told they sign
 * with the signature they already adopted — the one thing that would otherwise surprise them — and
 * what is left. The words of the handbook itself are the carrier's and are in the document, not here.
 */
export const APPLY_HANDBOOK_COPY = {
  handbook: {
    heading: "The driver handbook",
    waiting: (carrier: string): string =>
      `Next is ${carrier}'s driver handbook. They open it for signing in their office, after your application.`,
    checkAgain: "Check again",
    checking: "Checking…",
    intro:
      "Read it, then sign each of its five places. You sign with the signature you adopted for your application.",
    documentLabel: "The driver handbook",
    unavailable: "The handbook did not load just now. You can still sign; ask the carrier for a paper copy to read.",
    place: (n: number, total: number): string => `Place ${n} of ${total}`,
    sign: "Sign here",
    signing: "Signing…",
    signed: "Signed",
    progress: (done: number, total: number): string => `${done} of ${total} places signed.`,
    signFailed: "That signature did not go through. Try again.",
    allSigned: (carrier: string): string =>
      `You have signed every place. ${carrier} countersigns it now, and a copy is filed with your application.`,
    filed: "Your driver handbook is signed and filed.",
    download: "Download your signed handbook",
    downloadFailed: "That did not open just now. Try again in a moment, or ask the carrier for a paper copy.",
  },
} as const;
