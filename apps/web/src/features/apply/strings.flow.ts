/**
 * The words the applicant reads OUTSIDE the form itself (F4).
 *
 * ── WHY THIS IS A SECOND FILE AND NOT A SECOND OPINION ────────────────────────────────────────
 * Split out of `strings.ts` on 2026-09-11 when that file reached the 500-line budget, and along the
 * one seam this copy actually has: everything left there is a QUESTION the form asks, and everything
 * here is the CEREMONY around it — consenting, signing the four authorizations, handing the
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
  handoff: {
    send: (carrier: string): string => `Send it to ${carrier}`,
    sending: "Sending…",
    failed: "That did not send. Check your signal and try again — nothing you typed is lost.",
    waitingHeading: "They have your application",
    waitingBody: (carrier: string): string =>
      `${carrier} is reading it now. When they are done you will be asked to sign it, and this same link is where you will do it.`,
    /**
     * ⚠ It does NOT promise an email, and the omission is deliberate (Q-AX4). Nothing notifies the
     * applicant when the office approves — that is real work nobody has done yet — and this page has
     * promised a thing it could not deliver once already (A1's "you will be asked to sign", made on a
     * link the page had just closed). Keep the link, come back: both are true today.
     */
    waitingNote:
      "Nothing more to do for the moment. Keep this link — it is where you will sign, and it still works.",
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

  signing: {
    adoptHeading: "Your signature",
    adoptIntro: (carrier: string, count: number): string =>
      `${carrier} needs you to sign ${count} authorizations before you fill in the application. Type your name once — each document is then one tap, and you will see exactly what you are signing.`,
    adoptLabel: "Type your full name",
    adoptHint: "This is your signature. Type it as it appears on your licence.",
    adoptAction: "Use this as my signature",
    /** A8b/D-APP8. Optional, and said to be optional — a driver who cannot draw one has still
     *  signed, and the typed name above is what the carrier's file records. */
    drawLabel: "Draw it too, if you like",
    drawHint: "Optional. Your typed name above is your signature either way — this just puts your own mark on the document.",
    drawClear: "Clear",
    counter: (n: number, total: number): string => `${n} of ${total}`,
    sign: "I agree — sign this",
    signing: "Signing…",
    /** The carrier's outstanding act, said as the carrier's — the driver can do nothing about it. */
    notFinal:
      "This carrier has not published its final wording for this document yet, so it cannot be signed today. They have been told. You can still fill in your application.",
  },

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
