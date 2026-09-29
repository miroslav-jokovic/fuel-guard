/**
 * The driver handbook's words on the applicant's page (HANDBOOK-SIGNING-PLAN.md, D-HB1).
 *
 * ── WHY ITS OWN FILE ──────────────────────────────────────────────────────────────────────────
 * `strings.ts` and `strings.flow.ts` sit near the 500-line budget. This is one screen's copy, spread
 * into `APPLY_COPY` exactly as `strings.identity.ts` is, so `strings.test.ts` still walks it (and
 * still keeps CFR references off a driver's phone).
 *
 * ── WHAT THE SCREEN HAS TO SAY ────────────────────────────────────────────────────────────────
 * The handbook comes straight after the application, on the same walk (D-AW16, C3s4b): the page says
 * the application is filed and these are the last places, that the driver signs with the signature they
 * already adopted — the one thing that would otherwise surprise them — and where they are in the count.
 * The words of the handbook itself are the carrier's and are in the document, not here. The waiting
 * copy ("they open it in their office") went with the office's separate opening.

 */
export const APPLY_HANDBOOK_COPY = {
  handbook: {
    heading: "The driver handbook",
    /** Above the walk, on the card that used to say only "your application is in". */
    filedThen:
      "Your application is signed and filed. The last places to sign are in the driver handbook, below.",
    intro:
      "Read it, then sign each of its places. You sign with the signature you made when you started your application.",
    documentLabel: "The driver handbook",
    unavailable: "The handbook did not load just now. You can still sign; ask the carrier for a paper copy to read.",
    place: (n: number, total: number): string => `Place ${n} of ${total}`,
    sign: "Sign here",
    signing: "Signing…",
    signFailed: "That signature did not go through. Try again.",
    allSigned: (carrier: string): string =>
      `You have signed every place. ${carrier} countersigns it now, and a copy is filed with your application.`,
    filed: "Your driver handbook is signed and filed.",
    download: "Download your signed handbook",
    downloadFailed: "That did not open just now. Try again in a moment, or ask the carrier for a paper copy.",
  },
} as const;
