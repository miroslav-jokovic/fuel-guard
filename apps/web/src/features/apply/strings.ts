import {
  APPLICATION_SECTION_LABELS,
  CMV_WINDOW_YEARS,
  EMPLOYMENT_WINDOW_YEARS,
} from "@silvicom/shared";

/**
 * Every word the applicant reads, in one place (A3).
 *
 * ── WHY, WHEN ENGLISH IS THE ONLY LANGUAGE WE SHIP ────────────────────────────────────────────
 * Because these forms are filled by drivers for whom English is often a second language, and the
 * difference between "a translation pass" and "a refactor" is decided on the day the first string is
 * written, not on the day somebody asks for Spanish. Strings inlined across nine components would
 * make that ask a rewrite of nine components; strings here make it a second object.
 *
 * ── THE VOICE ─────────────────────────────────────────────────────────────────────────────────
 * House rule: state the fact, then the next action. Sentence case; no terminal period on buttons and
 * short labels, full stops on sentences. And one rule specific to this page — where the form asks
 * something a driver would reasonably resent being asked, it says why, in the same breath. A
 * sensitive question with no stated reason is an abandonment spike, and the two that matter here are
 * the Social Security number (Q-H2) and the date of birth.
 *
 * The section titles come from `APPLICATION_SECTION_LABELS` in shared rather than being retyped: the
 * section vocabulary is a database value (`application_drafts.furthest_section`) and its label map
 * ships beside the tokens, so this file re-exports rather than forks it.
 *
 * ── NO CFR CITATIONS IN ANY STRING HERE (2026-08-22, owner) ───────────────────────────────────
 * Ten strings in this file used to name the paragraph they discharged — "§391.21(b)(5) asks for every
 * unexpired licence", "§391.21(b)(10) asks for it" — and the wizard printed the section's citation
 * under every heading besides. The owner's judgement is that this is "useless and confusing for a
 * regular user", and the audience argument is decisive: the reader of this file is a driver on a
 * phone, and a citation is an instrument for arguing with an auditor. A driver cannot look up
 * §391.21(b)(9), and being shown it does not make them likelier to answer.
 *
 * ⚠ **The reason survives even where the number does not**, because the voice rule above still
 * stands: a sensitive question states why in the same breath. "§391.23 requires us to record where we
 * wrote to" became "We have to record where we wrote to" — the driver learns the same thing, which is
 * that this is an obligation rather than nosiness. The strings that were pure citation and no reason
 * ("§391.21(b)(10) asks for it") are the ones that had to be rewritten rather than trimmed.
 *
 * The citations themselves are not lost: `APPLICATION_SECTION_CITATIONS` still prints into the PDF
 * that lands in the §391.51 file, and this file's own comments still name the paragraphs so the next
 * person editing a string can check it against the CFR. Comments are read by engineers; strings are
 * read by drivers.
 */

export const APPLY_SECTION_TITLES = APPLICATION_SECTION_LABELS;

export const APPLY_COPY = {
  page: {
    title: "Driver application",
    /** Named as a function because the carrier is a fact, and a template literal here would be a
     *  string a translator cannot reorder. */
    subtitle: (carrier: string): string =>
      `For ${carrier}. Your answers save as you go — you can close this page and come back.`,
    opening: "Opening your application…",
    stepOf: (n: number, total: number): string => `Step ${n} of ${total}`,
  },

  nav: {
    back: "Back",
    next: "Next",
    review: "Check my answers",
    send: "Send my application",
    sending: "Sending…",
    fix: "Go to this section",
  },

  save: {
    saving: "Saving…",
    saved: "Saved. You can close this page and come back to it.",
    failed: "Not saved — check your signal. Your answers are still on this screen.",
  },

  issues: {
    heading: "Before you can go on",
    headingFinal: "Before you can send this",
    formPath: "form",
    sendFailed: "Could not send the application.",
  },

  identity: {
    intro:
      "Your name and date of birth are matched against your driving record, so enter them exactly as they appear on your licence.",
    first_name: "First name",
    middle_name: "Middle name",
    last_name: "Last name",
    date_of_birth: "Date of birth",
    email: "Email",
    phone: "Phone",
    optional: "Optional.",
    /** §391.23(a)(2). Asked with its reason in the same breath, like the SSN below. */
    otherNames: "Any other names you have been known by",
    otherNamesHint:
      "Optional. Maiden names and former legal names. We ask because your previous employers are required to verify your last three years, and they cannot find you under a name their records do not have.",
    addOtherName: "Add a name",
    remove: "Remove",
    ssn: "Social Security number",
    /** Q-H2. The number is optional, and the reason it is asked at all is stated in one sentence. */
    ssnHint:
      "Optional. It is on the application because some driving-record checks match on it. Only the last four digits are kept in a readable form.",
    ssnNotSaved: "This is the one answer that is not saved as you go — type it just before you send.",
  },

  addresses: {
    intro: `Every address you have lived at in the last ${EMPLOYMENT_WINDOW_YEARS} years. Leave the end month blank for where you live now.`,
    line1: "Street address",
    line2: "Apartment, unit",
    city: "City",
    state: "State",
    postal_code: "ZIP",
    from: "From",
    fromHint: "Month and year, as 2024-03.",
    to: "Until",
    toHint: "Blank if you live here now.",
    add: "Add another address",
    remove: "Remove",
    optional: "Optional.",
  },

  licence: {
    intro: "Every unexpired licence and permit you hold. Start with the one you drive on.",
    number: "Licence number",
    state: "Issuing state",
    stateHint: "Two letters.",
    class: "Class",
    expires: "Expires",
    othersHeading: "Any other licences or permits",
    othersIntro:
      "Most drivers have none — you may only hold one commercial licence at a time. Add permits and endorsements issued separately here.",
    issuingAuthority: "Issuing authority",
    issuingAuthorityHint: "The state or agency that issued it.",
    otherNumber: "Number",
    otherKind: "What it is",
    otherKindHint: "Optional — for example, hazmat endorsement.",
    addOther: "Add another licence or permit",
    remove: "Remove",
    optional: "Optional.",
  },

  employment: {
    intro: `List every job — driving or not — from the last ${EMPLOYMENT_WINDOW_YEARS} years. For the ${CMV_WINDOW_YEARS - EMPLOYMENT_WINDOW_YEARS} years before that, list only the jobs where you drove a commercial vehicle. Time you were not driving is not a gap you need to explain.`,
    none: "I have not been employed during this period",
    employer: "Employer",
    usdot: "USDOT number",
    usdotHint: "Optional — leave blank if you do not know it.",
    address: "Street address",
    addressHint: "We have to record where we wrote to.",
    city: "City",
    state: "State",
    phone: "Phone",
    phoneHint: "So we can contact them.",
    email: "Email",
    emailHint: "Optional, if you know it.",
    position: "Position",
    from: "From",
    to: "Until",
    toHint: "Blank if you work there now.",
    reason: "Reason for leaving",
    reasonHint: "Asked for every job on this list.",
    operatedCmv: "I drove a commercial vehicle in this job",
    dotRegulated: "This employer was DOT-regulated",
    safetySensitive: "This job was safety-sensitive under DOT drug and alcohol rules",
    subjectToFmcsr: "This job was subject to the federal motor carrier safety regulations",
    add: "Add another employer",
    remove: "Remove",
    experience: "Driving experience",
    experienceHint: "Optional — equipment, routes, years.",
    /** §391.21(b)(6)'s second half, laid out as FMCSA's own sample application lays it out. */
    equipmentHeading: "Equipment you have driven",
    equipmentIntro:
      "Which types of vehicle you have operated. Add a line for each — or describe it above instead, whichever is easier.",
    equipmentClass: "Class of equipment",
    equipmentType: "Type",
    equipmentTypeHint: "Van, tank, flat, and so on.",
    equipmentFrom: "From",
    equipmentMonthHint: "Month and year, as 2021-03.",
    equipmentTo: "Until",
    equipmentToHint: "Blank if you still drive it.",
    equipmentMiles: "Approximate total miles",
    equipmentMilesHint: "A rough number is fine.",
    addEquipment: "Add equipment",
  },

  safety: {
    intro: "These three questions cover the last three years.",
    accidentsHeading: "Accidents",
    noAccidents: "I have had no accidents in the last 3 years",
    accidentDate: "Date",
    accidentNature: "What happened",
    fatalities: "Fatalities",
    injuries: "Injuries",
    hazmatSpill: "Hazardous material was spilled",
    addAccident: "Add an accident",
    violationsHeading: "Traffic convictions",
    noViolations: "I have had no traffic convictions or forfeitures in the last 3 years",
    violationDate: "Date",
    offence: "Offence",
    violationState: "Where it happened",
    violationStateHint: "Optional — the state is enough.",
    penalty: "Penalty",
    penaltyHint: "Optional.",
    addViolation: "Add a conviction",
    licenceHeading: "Licence history",
    everDenied: "A licence, permit or privilege of mine has been denied, revoked or suspended",
    denialDetail: "What happened",
    denialDetailHint: "The reason it happened.",
    /**
     * §40.25(j)'s two-year question (P8). ⚠ No citation in the copy — D-UI9 — and the voice rule
     * applies with force here: this is the most resented question on the form, so it says why it is
     * asked in the same breath, and it says what a yes actually means. A driver who reads "yes ends
     * this" answers no.
     */
    priorTestHeading: "Drug and alcohol tests",
    priorTestIntro:
      "Every carrier has to ask this one, and a yes does not end your application. It means we have "
      + "to see the paperwork showing you finished the return-to-duty process before you can drive.",
    priorTest:
      "In the last two years, I applied for a driving job I did not get, and I tested positive or "
      + "refused a test as part of that application",
    priorTestHint: "This is about jobs you applied for, not jobs you had.",
    remove: "Remove",
  },

  /**
   * A9. The carrier's own questions. Only the two controls need words here — everything else on the
   * screen comes from the versioned definition in shared, which is the point of D-APP12: the
   * carrier's form changes without an engineer editing a string.
   */
  questions: {
    addRow: "Add another",
    removeRow: "Remove",
  },

  /**
   * A8. The screen asks for photographs of documents a driver is carrying, which is a moment where
   * the house rule — state the fact, then the next action — earns its keep twice: once for why the
   * carrier wants them, and once for what to do when a photograph is refused. A rejection that says
   * only "that did not work" sends a driver to a support call; one that names the problem sends them
   * to a window.
   */
  documents: {
    intro:
      "Photograph the documents you are carrying. Each one takes a few seconds, and you can do them in any order — or skip them and send them to the carrier later.",
    optional: "None of these stop you sending the application.",
    take: "Take photo",
    retake: "Take it again",
    working: "One moment…",
    done: "Received",
    failedHeading: "That photo did not go through",
    failed: "Check your signal and take it again. Nothing was lost.",
    /**
     * Why a photograph was refused, in the driver's words rather than the gate's. Total over the
     * rejection taxonomy on purpose: a reason with no sentence would reach a driver as a blank.
     */
    rejected: {
      DOCUMENT_NOT_DETECTED: "No document in the picture. Lay it flat and fill the frame.",
      IMAGE_BLURRED: "Too blurry to read. Hold still and try again.",
      GLARE_OVER_TEXT: "There is glare across the text. Move away from the light.",
      SHADOW_OVER_TEXT: "A shadow is covering the text. Move so your hand is not over it.",
      RESOLUTION_TOO_LOW: "Too small to read. Move closer so the document fills the frame.",
      LENS_DIRTY: "The lens looks smudged. Wipe it and try again.",
      PAGE_INCOMPLETE: "Part of the document is out of frame. Fit all four corners in.",
      LOW_CONTRAST: "Too washed out to read. Try somewhere with more light.",
      UNDER_OR_OVER_EXPOSED: "Too dark or too bright. Try somewhere with even light.",
      TEXT_ILLEGIBLE: "The text cannot be read. Move closer and try again.",
      OCR_UNAVAILABLE: "Could not check the photo on this phone. Try again.",
      SCANNER_MODULE_UNAVAILABLE: "Could not open the camera. Try again.",
      UNSUPPORTED_DEVICE: "This phone cannot take the photo here. You can send it to the carrier instead.",
      CAPTURE_CANCELLED: "No photo taken.",
      PROVIDER_ERROR: "Something went wrong with the camera. Try again.",
    },
  },

  review: {
    intro:
      "This is everything you are about to certify as true and complete. Check it, and go back to any section that needs changing.",
    empty: "Not answered",
    none: "None declared",
    count: (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`,
  },

  certify: {
    heading: "Your certification",
    intro: "You have to certify this before it can be sent. Typing your name is your signature.",
    statement:
      "I certify that all entries on this application are true and complete to the best of my knowledge.",
    signedName: "Your full name",
    dateNote: "The date is recorded for you when you send this.",
  },

  done: {
    heading: "Your application is in",
    body: (carrier: string): string =>
      `${carrier} has it, certified in your name. They will contact you about what happens next.`,
    reopen:
      "You can close this page. Your link still opens to this message, and it cannot be used to send a second application.",
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
