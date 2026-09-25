import { APPLY_FLOW_COPY } from "./strings.flow";

/**
 * The permissions step's words (AF6, D-AF2): five documents, each a PDF, each signed where it says.
 *
 * ── WHY A FOURTH FILE ─────────────────────────────────────────────────────────────────────────
 * `strings.ts` and `strings.flow.ts` are both within a few lines of the 500-line budget, which is
 * `strings.identity.ts`'s reason too. Spread into `APPLY_COPY` the same way, so `strings.test.ts`
 * walks it.
 *
 * ── THE ADOPTION SCREENS SAY THE PACKET'S WORDS WHERE THEY ARE TRUE ───────────────────────────
 * The permission ceremony adopts its signature through the same screens as the packet's
 * (`PacketAdoption.vue`), so the tab names, the upload refusals and the draw hints are the packet's
 * own, spread in. What is overridden is everything that talks about PLACES ON A FORM, because this
 * screen is about five documents. The initials keys are inherited and never shown: no permission
 * takes initials.
 */
const packet = APPLY_FLOW_COPY.packet;

export const APPLY_PERMISSIONS_COPY = {
  permissions: {
    adoption: {
      ...packet,
      adoptHeading: "Your signature",
      adoptIntro: (carrier: string, count: number): string =>
        `${carrier} needs you to sign ${count} permissions before they can check your record. Each one is its own document. Make your signature once below, then we show you each document and where to sign it.`,
      adoptHint: "Type it as it appears on your licence. This is the name each document is signed in.",
      stylePreviewLabel: "This is how your signature will look",
      uploadPreviewLabel: "This is how your signature will look",
      drawHint: "Use your finger. Your typed name is recorded with it as well.",
      confirmHeading: "Check your signature before you start",
      confirmBody:
        "This goes on each document exactly as it looks here. Once a document is signed it cannot be "
        + "changed, so take a moment now.",
      /**
       * ⚠ As short as the packet's, and that is a measurement: "This is right — show me the first
       * document" pushed `Change` off the card at 390px, on the one row the confirm screen has.
       */
      confirmAction: "This is right — start signing",
      changeIntro: "Change your signature. Anything you have already signed stays as it is.",
      markLocked: (_kind: "signature" | "initials", places: number): string =>
        `Your signature ${places === 1 ? "is already on 1 document" : `is already on ${places} documents`}, so it cannot be changed now.`,
      resumed: (n: number): string =>
        n === 1 ? "You have already signed 1 document." : `You have already signed ${n} documents.`,
      resumedBody: "You made this when you started. We will keep using it for the documents that are left.",
      markCarriedOver: "Your signature picture is saved. We will keep using it for the documents that are left.",
      drawFailed:
        "We could not save your signature picture, so your typed name is used instead. "
        + "Everything you sign still counts — carry on.",
    },
    counter: (n: number, total: number): string => `Document ${n} of ${total}`,
    /** On the document, over the box, where DocuSign puts its tag. */
    signHere: "Sign here",
    working: "Signing…",
    signedHere: "Signed",
    next: "Next document",
    loading: "Getting the document…",
    /**
     * ⚠ A document that will not load must not stand between an applicant and their permissions: the
     * words are the same ones the PDF carries, served with the link, so the step falls back to them.
     */
    unavailable: "The document could not be shown here, so its words are below. Read them and sign.",
    signAction: "I agree — sign this",
    /** The document on a phone is small; the words are always one tap away, in the same order. */
    readAsText: "Read this document as text",
    notFinal:
      "This carrier has not published its final wording for this document yet, so it cannot be signed today. They have been told.",
    failed: "That did not go through. Check your signal and try again.",
  },
} as const;
