import { APPLY_PACKET_COPY } from "./strings.packet";

/**
 * The words the applicant reads OUTSIDE the form itself (F4).
 *
 * ── WHY THIS IS A SECOND FILE AND NOT A SECOND OPINION ────────────────────────────────────────
 * Split out of `strings.ts` on 2026-09-11 when that file reached the 500-line budget, and along the
 * one seam this copy actually has: everything left there is a QUESTION the form asks, and everything
 * here is the CEREMONY around it — consenting, signing the six authorizations, handing the
 * application to the office, coming back to certify it, and every screen that is not a form at all.
 *
 * ⚠ It is spread into `APPLY_COPY` and reached through that, never imported directly by a component.
 * One object is what lets `strings.test.ts` walk every string an applicant can read — the gate that
 * keeps CFR citations off a driver's phone — and a second entry point would be a second place for a
 * citation to hide.
 */
export const APPLY_FLOW_COPY = {
  /**
   * The first visit ends by handing the application over, not by signing it (F4, D-AX11).
   *
   * §391.21(b)(12) has the applicant swear that every entry is true and complete. Once the office can
   * correct an entry — which is the whole point of the review — a certification taken beforehand
   * certifies a document that no longer exists. So the driver sends it, the carrier reads it, and the
   * signature is asked for on the document as it finally stands.
   */
  /**
   * The end of the FIRST visit since AF4 (plan §3.1 row 5): permissions in, application not sent.
   *
   * ⚠ It says the link will CHANGE, and that is not optional. Sending the application rotates the
   * token (0365, 0232's reasoning), so the link on screen right now stops working the moment the
   * office sends the form. A driver who bookmarked it and came back would meet "not valid" with no
   * idea why — so the promise here is "we will send you a new link", never "keep this one".
   */
  permissionsReceived: {
    heading: "We have your permissions",
    body: (carrier: string): string =>
      `Thank you. ${carrier} will check your driving record and safety history, then send you the application itself.`,
    note: "Nothing more to do for now. We will email you a new link for the application — this one will stop working when it arrives.",
  },

  handoff: {
    send: (carrier: string): string => `Send it to ${carrier}`,
    sending: "Sending…",
    failed: "That did not send. Check your signal and try again — nothing you typed is lost.",
    waitingHeading: "They have your application",
    waitingBody: (carrier: string): string =>
      `${carrier} is reading it now. When they are done, they will contact you about coming to their office, where you sign it.`,
    /**
     * ⚠ It promises an email SINCE Q-AX4 SHIPPED, and the promise is why nothing about the approval
     * ROTATES the token. `notifyApplicationApproved` sends from the approval itself. The applicant is
     * being told to keep a link; a notice that replaced it would make this line false at the exact
     * moment the applicant acts on it.
     *
     * ⚠ **The approval email DOES carry a link now (A5b, D-AX15, 2026-09-18), and this sentence is
     * still true word for word.** 0345 gave the invitation a second hash, so approval mints a new
     * token beside the first rather than over it, and `resolveInvitation` accepts either. Two doors,
     * one application. ⚠ Whoever edits this line next owes the same test: it may promise that the
     * link still works only for as long as nothing rotates `token_hash`.
     *
     * It stayed silent until then on purpose: this page promised something it could not deliver once
     * already (A1's "you will be asked to sign", made on a link the page had just closed).
     *
     * ⚠ **AF5 (D-AF3) made "it is where you will sign" false, so it is gone.** Signing happens in the
     * office, on a sign link the office opens at the desk (0369); this link will show the applicant
     * that they are approved, and nothing on it needs doing until they come in.
     */
    waitingNote:
      "Nothing more to do for the moment. We will email you when they are done — this link will show "
      + "you where things stand.",
  },

  /**
   * Approved, and signing not yet opened (AF5, plan §3.1 row 9).
   *
   * ⚠ "Approved" is the office having READ the application, not a hire: the road test and orientation
   * are still ahead. The screen says where the signing happens and who moves next, and promises no
   * date — the carrier arranges the visit, and a date this page invented would be a promise nobody
   * made.
   */
  signInOffice: {
    heading: "Your application is approved",
    body: (carrier: string): string =>
      `${carrier} has read your application. You sign it in their office, on the same visit as your road test and orientation — they will contact you about coming in.`,
    note: "Nothing more to do on this link for now. Nothing you filled in has been lost.",
  },

  /**
   * The second visit: the document as it now stands, and the signature (F4, D-AX12).
   *
   * ⚠ The changes the office made are shown BEFORE the certification and not after it. A driver
   * certifying that every entry is true has to be able to see the entries somebody else changed —
   * this is the screen where that obligation is discharged, or it is not discharged anywhere.
   */
  signOff: {
    heading: "Ready for your signature",
    intro: (carrier: string): string =>
      `${carrier} has read your application. Check it once more and sign it — this is the version that goes in your file.`,
    changedHeading: "What the carrier changed",
    changedIntro:
      "They corrected these while checking your application. Read them before you sign — if any of them is wrong, tell them before you do.",
    changedNothing: "They did not change any of your answers.",
    was: "You put",
    now: "It now says",
    blank: "nothing",
    /**
     * §391.21(b)(2) lists the Social Security number, and it is asked for HERE rather than on the
     * form (D-APP3, F4). It is the one answer that never enters a saved draft — so it cannot be
     * collected on the first visit and still be there on the second, and the honest place to ask for
     * it is the moment the file is actually created.
     */
    ssnNote:
      "Your Social Security number is not saved with the rest of your answers, so we ask for it here — it goes straight into your file when you sign.",
    sign: "Sign and send it",
    signing: "Sending…",
  },

  done: {
    heading: "Your application is in",
    body: (carrier: string): string =>
      `${carrier} has it, certified in your name. They will contact you about what happens next.`,
    reopen:
      "You can close this page. Your link still opens to this message, and it cannot be used to send a second application.",
    /**
     * X8/D-AX9. The 7001(c) consent promises a copy "at no charge" and, until now, the only way to
     * get one was to ask the carrier — which discharges the statute and is a long way below what
     * somebody who has ever used a commercial e-signature product expects.
     */
    download: "Download your copy",
    downloading: "Preparing your copy…",
    downloadNote:
      "Everything you filled in, everything you signed, and a record of when and how you signed it.",
    downloadFailed:
      "That did not open just now. Try again in a moment, or ask the carrier to send you a copy.",
    /**
     * RT4, §391.31(g): the carrier must give the person examined a copy of the certificate. The note
     * names the test date so a driver with two tests on file knows which one this is.
     */
    certificate: "Download your road test certificate",
    certificateDownloading: "Preparing your certificate…",
    certificateNote: (testedOn: string): string =>
      `From your road test on ${testedOn}. Keep it: it is your copy of the carrier's certificate.`,
    certificateFailed:
      "That did not open just now. Try again in a moment, or ask the carrier for a paper copy.",
  },

  dead: {
    heading: "This link is not valid",
    body: "It may have expired, or the carrier may have replaced it. Ask the carrier who invited you for a new one.",
  },

  /**
   * The carrier has not published its final wording, so nothing can be signed and nothing can be
   * sent (2026-08-23).
   *
   * ── WHY THE FORM STAYS OPEN AND ONLY THE SEND IS STOPPED ──────────────────────────────────
   * The server refuses the submission while the wording is draft (`WORDING_NOT_FINAL`), and the first
   * instinct was to put a wall in front of the whole page. That would have overturned H5b, which
   * deliberately keeps the form usable while the ceremony cannot run — and it would have thrown away
   * something real: the link is a SESSION (D-APP1), autosave has never been gated, and a driver who
   * fills the form today finds it waiting the day the wording publishes.
   *
   * So the fact is told on the FIRST screen instead of discovered at the last, the Send button is
   * disabled rather than removed, and the read-only disclosure panel says what it costs.
   *
   * ⚠ **None of these blame the reader, and none of them promise a date.** It is a fact about the
   * carrier's paperwork; the only useful action the applicant has is to ask the person who invited
   * them, so that is the sentence.
   */
  notOpen: {
    banner: (carrier: string): string =>
      `${carrier} is still finalising the wording of the documents that go with this application, so it cannot be sent yet. Fill in what you can — everything you type is saved, and this link will still be here.`,
    cannotSend:
      "You cannot sign these yet, and the application cannot be sent until the carrier publishes the final wording. Ask the person who invited you when that will be.",
    sendLabel: "Not ready to send yet",
  },

  consent: {
    heading: "Before you start",
    intro: (carrier: string): string =>
      `${carrier} would like to send you this application, and take your signature on it, electronically. The law says you have to agree to that first — and that you have to be told the following before you do.`,
    /** 7001(c)(1)(C)(ii): the affirmation itself, given in the browser they just read it in. */
    action: "I agree — continue",
    working: "One moment…",
    draftNotice:
      "This carrier has not published its final wording yet, so there is nothing to agree to today. You can go straight on with your application.",
    failed: "That did not go through. Check your signal and try again.",
  },

  /**
   * `SignaturePad`'s own three. ⚠ Since AF6 the permissions adopt their signature in the packet's
   * adoption screens (`APPLY_COPY.permissions`), and the rest of what stood here, the old
   * text-and-button ceremony's words, went with that screen.
   */
  signing: {
    /** A8b/D-APP8. Optional, and said to be optional — a driver who cannot draw one has still
     *  signed, and the typed name above is what the carrier's file records. */
    drawLabel: "Draw it too, if you like",
    drawHint: "Optional. Your typed name above is your signature either way — this just puts your own mark on the document.",
    drawClear: "Clear",
  },

  ...APPLY_PACKET_COPY,

  unlock: {
    heading: "Pick up where you left off",
    body: (carrier: string): string =>
      `You have already started this application for ${carrier}. Confirm your date of birth and your answers come back.`,
    label: "Your date of birth",
    failed: "That does not match this application. Try again, or ask the carrier for a new link and start fresh.",
    checking: "Checking…",
    action: "Continue",
  },
} as const;
