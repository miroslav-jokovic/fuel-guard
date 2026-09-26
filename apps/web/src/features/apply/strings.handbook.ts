import { APPLY_FLOW_COPY } from "./strings.flow";

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
 *
 * ── `adoption`: A HANDBOOK THAT TAKES ITS OWN SIGNATURE ───────────────────────────────────────
 * ⚠ WORKAROUND (APPLICATION-FLOW-V2-PLAN.md A-1, C0b; removed by C3s with `signature_adoptions`). An
 * application filed before the packet was signed on screen has no adopted signature to borrow, so
 * the handbook screen asks for one through the packet's own adoption screens. The packet's words are
 * spread in where they are true; what talks about the application's places is overridden.
 */
const packet = APPLY_FLOW_COPY.packet;

export const APPLY_HANDBOOK_COPY = {
  handbook: {
    heading: "The driver handbook",
    waiting: (carrier: string): string =>
      `Next is ${carrier}'s driver handbook. They open it for signing in their office, after your application.`,
    checkAgain: "Check again",
    checking: "Checking…",
    intro:
      "Read it, then sign each of its five places. You sign with the signature you adopted for your application.",
    /** The self-adopted handbook's intro: the signature is the one they just made, not the application's. */
    introOwnSignature: "Read it, then sign each of its five places with the signature you just made.",
    adoption: {
      ...packet,
      adoptHeading: "Your signature",
      adoptIntro: (carrier: string, count: number): string =>
        `${carrier}'s driver handbook has ${count} places for you to sign. Make your signature once below, then sign each place.`,
      adoptHint: "Type it as it appears on your licence. This is the name the handbook is signed in.",
      stylePreviewLabel: "This is how your signature will look",
      uploadPreviewLabel: "This is how your signature will look",
      drawHint: "Use your finger. Your typed name is recorded with it as well.",
      confirmHeading: "Check your signature before you start",
      confirmBody: "This goes on each place in the handbook exactly as it looks here. Once a place is signed it cannot be changed.",
      confirmAction: "This is right — start signing",
      changeIntro: "Change your signature. Nothing is signed yet.",
      markLocked: (_kind: "signature" | "initials", places: number): string =>
        `Your signature ${places === 1 ? "is already on 1 place" : `is already on ${places} places`}, so it cannot be changed now.`,
      resumed: (n: number): string => (n === 1 ? "You have already signed 1 place." : `You have already signed ${n} places.`),
      resumedBody: "You made this when you started. We will keep using it for the places that are left.",
      markCarriedOver: "Your signature picture is saved. We will keep using it for the places that are left.",
      drawFailed:
        "We could not save your signature picture. Try again, or type your signature instead — the handbook needs one to be signed.",
    },
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
