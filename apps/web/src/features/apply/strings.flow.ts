/**
 * The words the applicant reads OUTSIDE the form itself (F4).
 *
 * ── WHY THIS IS A SECOND FILE AND NOT A SECOND OPINION ────────────────────────────────────────
 * Split out of `strings.ts` on 2026-09-11 when that file reached the 500-line budget, and along the
 * one seam this copy actually has: everything left there is a QUESTION the form asks, and everything
 * here is the CEREMONY around it — consenting, signing the five authorizations, handing the
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

  /**
   * The walk through the carrier's own packet (P5, D-PKT6, D-PKT13).
   *
   * ⚠ **Names no regulation and no page of ours** (D-UI9). What a stop says is the carrier's own
   * `what` sentence out of `packetPlacements.ts`, and the only number shown is THEIR page number —
   * which is the number printed at the foot of the paper the driver will be handed, so it is the one
   * thing on the screen they could check against the document itself.
   *
   * ⚠ **"Initials" is said as initials.** Three pages take them and nothing else, and the packet
   * treats them as a distinct mark rather than an abbreviation of the signature — a screen that said
   * "sign" on a page asking for initials would be describing a different act.
   */
  packet: {
    adoptHeading: "Your signature on the application",
    /**
     * ⚠ Said only when a stop that takes initials is still outstanding (Q-PKT8). A driver resuming a
     * link that already collected `p05`, `p06` and `p09` is asked for a signature and nothing else,
     * because that is all they have left to give.
     */
    adoptHeadingWithInitials: "Your signature and initials on the application",
    adoptIntro: (carrier: string, count: number): string =>
      `${carrier} has approved your application. It now needs your signature in ${count} places on their own form. Give your signature once below — then we take you to each place, one at a time, and show you what you are signing.`,
    /**
     * ⚠ The three tabs (C2). *"Type my name"* is gone, and not because the words were wrong: it named
     * a behaviour that no longer exists. Every tab now produces a picture of a signature and the
     * picture is what the packet prints (D-HUI14), so a tab called *type* would be promising the one
     * thing the form stopped doing.
     */
    styleLabel: "How would you like to sign?",
    styleStyled: "Choose a style",
    styleDrawn: "Draw it",
    styleUploaded: "Upload",
    styleChooseLabel: "Pick the hand that looks most like yours",
    /** Shown in the options before the driver has typed anything. A name, so the hands are comparable. */
    styleSampleName: "John Smith",
    stylePreviewLabel: "This is what goes on the form",
    /**
     * ⚠ The SECOND preview under the one style picker (Q-HUI14). It names where the initials land,
     * because that is the whole reason a driver is being shown two pictures instead of one — and
     * `stylePreviewLabel` above cannot be reused: two identical captions over two different pictures
     * is the screen failing to say which is which.
     *
     * ⚠ It says "the pages that ask for your initials" rather than "three pages": the packet has
     * gained a placement mid-array before (p17, D-PKT12), and `confirmInitialsWhere` is the one
     * sentence that names the numbers, from the stops.
     */
    styleInitialsPreviewLabel: "And this goes on the pages that ask for your initials",
    uploadLabel: "Upload a picture of your signature",
    uploadHint:
      "A photo or a scan. Sign a white sheet in dark ink, take a picture of it, and we trim the paper away.",
    /**
     * ⚠ The second file picker (Q-HUI14). A separate PICTURE, not a second use of the first — D-PKT6
     * calls the initials a second adopted mark, so a driver uploading a scan of their signature is not
     * thereby uploading their initials, and the form must not print a cropped signature as if they had.
     */
    uploadInitialsLabel: "Upload a picture of your initials",
    uploadInitialsHint:
      "The same again, with just your initials on the sheet. These go on the pages that ask for initials.",
    uploadInitialsNeeded: "Choose a picture of your initials above, or pick a style instead.",
    uploadChoose: "Choose a picture",
    uploadReplace: "Choose a different picture",
    uploadReading: "Reading…",
    uploadPreviewLabel: "This is what goes on the form",
    uploadNeeded: "Choose a picture above, or pick a style instead.",
    /**
     * ⚠ Three outcomes and three sentences, because they need three different next actions: make the
     * file smaller, try a different file, or sign the sheet harder. One "that did not work" would be
     * true of all three and useful for none.
     */
    uploadFailed: {
      too_large: "That picture is too big to read on a phone. Try a smaller one, or draw your signature instead.",
      unreadable: "We could not read that picture. Try a photo or a scan in PNG or JPEG.",
      blank: "We could not find a signature in that picture. Sign a white sheet in dark ink and photograph it in good light.",
    },
    adoptLabel: "Type your full name",
    adoptHint: "Type it as it appears on your licence. This is what goes on the form.",
    /**
     * ⚠ The hint says what the initials are FOR, not how to make them. The packet asks for initials
     * on three pages and for a signature on the rest, and a driver told "your initials" without
     * being told where they go has been asked for a second thing for no visible reason.
     */
    initialsLabel: "Type your initials",
    initialsHint: "Three pages ask for your initials instead of your full name. These go on those three.",
    initialsNeeded: "Type your initials above to carry on.",
    drawLabel: "Draw your signature",
    drawHint: "Use your finger. This is what goes on the form — your typed name goes on it as well.",
    drawClear: "Clear",
    /**
     * ⚠ **It said *"or choose to type it instead"* until Q-HUI14, and that tab has not existed since
     * C2.** `AdoptedMarkStyle`'s `"typed"` was removed, not renamed, because it named a behaviour that
     * no longer happens — every tab produces a picture now — so this sentence was pointing a stuck
     * driver at a control that is not on the screen. Found by reading the rendered tab beside its new
     * sibling, which says `choose a style`; the pair now name the same real thing.
     */
    drawNeeded: "Draw your signature above, or choose a style instead.",
    /**
     * ⚠ The second pad (Q-HUI14, D-PKT6). Its own label, because a single pad captioned *"draw your
     * mark"* would leave the driver deciding which mark, and whichever they drew would go on both
     * nineteen lines and three — which is A3's defect arriving from the client side this time.
     */
    drawInitialsLabel: "Now draw your initials",
    drawInitialsHint: "Just your initials. These go on the pages that ask for them instead of a signature.",
    drawInitialsNeeded: "Draw your initials above, or choose a style instead.",
    adoptAction: "Use this and start",
    /**
     * ⚠ What a RESUMED walk sees instead of the fields (Q-PKT9). The driver adopted these on a
     * previous visit and the server pinned them; asking again and then refusing a different spelling
     * at the next stop is the defect this replaces.
     */
    resumedHeading: "The mark you are signing with",
    resumedBody:
      "You adopted this when you started. We will keep using it for the places that are left.",
    resumedInitialsLabel: "Your initials",
    resumedAction: "Carry on signing",
    /**
     * ⚠ What a resumed link is told about a signature picture it cannot show (C2).
     *
     * The picture is on the server, staged on a previous visit, and the apply bundle serves capture
     * dates rather than bytes — so there is nothing to put on the screen. ⚠ **A sentence is the honest
     * answer and the typed name is not**: falling back to it would preview the wrong mark, with no
     * caveat, on every remaining page of a walk the driver cannot see the rest of.
     *
     * ⚠ It says *saved*, not *uploaded*, and it does not invite a change. The mark may already be
     * pinned on the server, and offering to replace something `record_packet_mark` would refuse is the
     * shape of advice a driver cannot act on. Where a change IS still possible, the Change button that
     * reads `canChange` is what offers it (A4).
     */
    markCarriedOver: "Your signature picture is saved. We will keep putting it on the pages that are left.",
    /**
     * ⚠ Its own sentence rather than a shared one (Q-HUI14). The two pictures are two rows staged by
     * two calls, so a resumed link can hold one and not the other — and on an initials stop, a
     * sentence saying *your signature picture is saved* would be true about the wrong mark, which is
     * the failure this whole family of sentences exists to avoid.
     */
    initialsCarriedOver:
      "Your initials picture is saved. We will keep putting it on the pages that ask for initials.",
    /**
     * ⚠ The confirm step (A4) — the screen between the last keystroke and the first signature.
     *
     * It exists because `record_packet_mark` pins the adopted mark at the first stop OF ITS KIND and
     * refuses a different spelling afterwards with `DR035`, which is advice a driver cannot act on.
     * Before this there was nothing between typing an initial and it being permanent for a federal
     * record.
     *
     * ⚠ **It names the consequence rather than asking "are you sure?"** A confirmation that only asks
     * for a second press teaches people to press twice; one that says what becomes unchangeable gives
     * them a reason to read. And it says it in the packet's own terms — the places — because that is
     * what the driver is about to walk.
     */
    confirmHeading: "Check your marks before you start",
    confirmBody:
      "These go on the form exactly as they look here. Once a mark is on the form it cannot be "
      + "changed, so take a moment now.",
    confirmSignatureLabel: "Your signature",
    confirmInitialsLabel: "Your initials",
    /**
     * ⚠ The pages come from the STOPS, never from the number three. The packet has gained a placement
     * mid-array once already (p17, D-PKT12), and a sentence naming three pages would have been wrong
     * the day it gained a fourth.
     */
    confirmInitialsWhere: (pages: number[]): string =>
      pages.length === 1
        ? `These go on page ${pages[0]}.`
        : `These go on pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}.`,
    confirmChange: "Change",
    confirmAction: "These are right — start signing",
    /**
     * ⚠ The adoption screen's intro when it has been REOPENED to correct something, rather than met
     * for the first time (A4).
     *
     * `adoptIntro` says *"Give your signature once below — then we take you to each place"*, which is
     * true the first time and wrong here: the driver is part-way through, and the field it points at
     * may be the disabled one. Found by reopening the form and reading it, which is the same defect
     * B5 shipped one field over — a sentence that was written for one state and shown in two.
     */
    changeIntro:
      "Change a mark that is not on the form yet. Anything you have already signed stays as it is.",
    /**
     * ⚠ Offered at a stop only while the server would still accept a correction (A4, `pinnedKinds`).
     * A button that leads to a refusal is worse than no button.
     */
    changeMark: "Change",
    /**
     * ⚠ What a driver is told about the mark they can no longer change, and WHY — the count is the
     * reason. "Your signature is already on 4 places" is a fact they can check against the counter
     * they have been watching; "this cannot be changed" is an assertion they have to take on trust.
     */
    markLocked: (kind: "signature" | "initials", places: number): string =>
      `Your ${kind} ${places === 1 ? "is already on 1 place" : `is already on ${places} places`} `
      + "of the form, so it cannot be changed now.",
    counter: (n: number, total: number): string => `Place ${n} of ${total}`,
    page: (n: number): string => `Page ${n} of the application`,
    /** The two marks, named as the packet names them (`adoptedMarkKinds()`). */
    signAction: "Sign here",
    initialAction: "Initial here",
    working: "Saving…",
    /** What is about to be put on the page, so the act is never ambiguous. */
    applyingTyped: "We will put this on the page:",
    applyingDrawn: "We will put your signature on the page:",
    /** ⚠ A stop taking initials says so here too, not only on its button. */
    applyingInitials: "We will put your initials on the page:",
    /**
     * ⚠ What a driver is told when their DRAWING did not save (A3).
     *
     * It was told to nobody until 2026-09-18. The upload failure is swallowed on purpose — A8b, a PNG
     * that will not upload must not stand between a driver and twenty-two signatures — but the
     * swallow was silent, so somebody who chose to draw signed all twenty-two places believing their
     * drawing was going on the paper, and the filed packet came out typed. That is the owner's
     * *"custom signature cannot be applied"* seen from the driver's end.
     *
     * ⚠ **It does not apologise and it does not offer a retry.** Nothing here is broken from the
     * driver's side and there is nothing for them to press: the typed name is the signature of record
     * either way (D-APP8), so the only useful sentence says which mark is going on the form and that
     * they can carry on.
     *
     * ⚠ **C2 made it say "signature" rather than "drawing", because there are now three ways to reach
     * it** — a style that would not rasterise and an upload that could not be read land here exactly as
     * a drawing that would not stage does, and a driver who chose a style has no drawing to be told
     * about. It still names the consequence rather than the cause: what matters to them is which mark
     * the form is about to carry.
     */
    drawFailed:
      "We could not save your signature picture, so your typed name goes on the form instead. "
      + "Everything you sign still counts — carry on.",
    /**
     * ⚠ Its own sentence, and the two can be shown together (Q-HUI14).
     *
     * The marks stage in two calls, so *signature landed, initials did not* is a real outcome and it
     * prints differently on three pages from on nineteen. One merged sentence would either disown a
     * signature that did save or claim one that did not; two sentences, shown only for the mark that
     * actually failed, is the only version that is true in all four combinations.
     */
    initialsFailed:
      "We could not save your initials picture, so your typed initials go on those pages instead. "
      + "Everything you sign still counts — carry on.",
    resumed: (n: number): string =>
      n === 1 ? "You have already signed 1 place." : `You have already signed ${n} places.`,
    doneHeading: "That is every place signed",
    doneBody:
      "Your signature is now on every place the form asks for it. One last step below and your application is in.",
    failed: "That did not go through. Check your signal and try again.",
    /**
     * ⚠ What a rate-limited stop says, and it exists because both of the alternatives lied (A0b).
     *
     * A 429 used to arrive as express-rate-limit's plain text, which `publicFetch` cannot parse, so
     * the driver was told *"This application link is not valid. Ask for a new one."* about a link
     * that was perfectly good and would work again within the minute. `failed` above is barely
     * better: it sends somebody with a working connection off to check their signal.
     *
     * ⚠ Names the wait, because "try again later" is not an instruction. The window is 60 seconds.
     * And it says nothing is lost because that is true — `application_packet_marks` is append-only
     * and a resumed walk starts at the first unsigned place.
     */
    tooFast:
      "That went faster than we could record it. Wait about a minute, then press the button again — "
      + "nothing you have already signed is lost.",
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
