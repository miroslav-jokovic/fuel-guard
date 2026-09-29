/**
 * The words of the walk through the carrier's own packet — adoption, confirm, and each stop.
 *
 * ⚠ **Split out of `strings.flow.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at that
 * file's 450-line warning, for the reason `strings.identity.ts` gives. Spread back into
 * `APPLY_FLOW_COPY` at the place `packet` stood, so it is still reached as `APPLY_COPY.packet`,
 * `strings.test.ts` still walks it, and no component imports it directly.
 */
export const APPLY_PACKET_COPY = {
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
     * ⚠ The link's adoption OFFERED at a document that has not used it yet (D-AW15, C3s2a) — the owner's
     * "This is your signature — use it". Not the resumed walk's words: nothing here is pinned, and a new
     * one replaces it for this document and every one after.
     */
    adoptedHeading: "This is your signature",
    adoptedBody:
      "You made this when you started your application. Use it here, or make a new one — a new one is used from now on.",
    adoptedAction: "Use it",
    remakeAction: "Make a new one",
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
} as const;
