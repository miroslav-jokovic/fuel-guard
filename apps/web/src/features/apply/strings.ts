import { APPLY_FLOW_COPY } from "./strings.flow";
import { APPLY_HISTORY_COPY } from "./strings.history";
import { APPLY_IDENTITY_COPY } from "./strings.identity";
import { APPLY_PART_ONE_COPY } from "./strings.partOne";
import { APPLY_HUB_COPY } from "./strings.hub";
import { APPLY_HANDBOOK_COPY } from "./strings.handbook";
import { APPLY_PERMISSIONS_COPY } from "./strings.permissions";
import { APPLY_SMS_COPY } from "./strings.sms";
import {
  APPLICATION_SECTION_LABELS,
  CMV_WINDOW_YEARS,
  EMPLOYMENT_WINDOW_YEARS,
  MVR_LOOKBACK_YEARS,
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
    /**
     * ⚠ It used to end "Your answers save as you go — you can close this page and come back." That
     * sentence moved into the progress card (X4), beside the live "Saved" indicator, because a
     * promise about saving is worth most where the evidence of it is — and repeating it in two
     * places on one screen made the page read as if it were reassuring itself.
     */
    subtitle: (carrier: string): string => `For ${carrier}.`,
    /** §391.21(b)(1) (C3c1): the employing carrier's name and address, on the application itself. */
    employingCarrier: (carrier: string, address: string): string => `Employing carrier: ${carrier}, ${address}`,
    opening: "Opening your application…",
    stepOf: (n: number, total: number): string => `Step ${n} of ${total}`,
  },

  /** The progress card (X4) — where they are, what is left, and that it is all being kept. */
  progress: {
    here: "You are here",
    /** Shown until autosave has actually done something, so the card is never a blank promise. */
    savesItself: "Your answers save as you go",
    comeBack: "You can close this page and open your link again later.",
    /**
     * A screen's estimate, beside its name (B7). Abbreviated because it is glanced at in a list of
     * eight and read in a column: "10 min" scans as a quantity where "about 10 minutes" scans as a
     * sentence and wraps the row on a phone.
     */
    minutes: (n: number): string => `${n} min`,
  },

  /**
   * What the applicant is told before they start (B7).
   *
   * ── WHY THERE IS A SCREEN HERE AT ALL ─────────────────────────────────────────────────────────
   * Because the length of this application was previously discovered by walking it. A driver who
   * opens the link in a queue at a shipper with four minutes to spare, starts, and meets the
   * employment screen's ten years of history is a driver who abandons it — and the answers they did
   * type are worth nothing to anybody. The finding this is built on is not ours (NN/g on setting
   * expectations before a long form, and every carrier ATS that has measured its own abandonment):
   * the length and the list of what to have to hand are what a person needs in order to decide
   * whether to start NOW or this evening, and both answers are fine. Neither of them is "start, and
   * find out".
   *
   * ⚠ The estimate itself is not typed here. It comes from `APPLICATION_SECTION_MINUTES` in shared,
   * so this file states no fact about the form that the form does not own — see the catalogue.
   */
  expectations: {
    /**
     * ⚠ Not "Before you start", which is the 7001(c) consent's heading and stays its heading. Two
     * screens in a row under the same words would read as the page repeating itself, and the consent
     * has the better claim to it: it is the last thing before the application, and this is the thing
     * before all of it.
     */
    heading: "What this involves",
    /** The carrier is a fact, so it is an argument rather than a template a translator cannot move. */
    lead: (carrier: string): string => `This is ${carrier}'s driver application.`,
    /**
     * ⚠ Rounded to the nearest five minutes on the way out. The catalogue's total is a sum of eight
     * estimates nobody has measured; printing it to the minute would dress a judgement up as a
     * stopwatch, and a driver who takes 34 minutes against a promised 31 has been misled by a
     * precision we never had.
     */
    howLong: (screens: number, minutes: number): string =>
      `${screens} screens, about ${Math.round(minutes / 5) * 5} minutes in all.`,
    stepsHeading: "The screens",
    needHeading: "What to have with you",
    needs: [
      `Every address you have lived at in the last ${EMPLOYMENT_WINDOW_YEARS} years.`,
      `Every job you have held in the last ${EMPLOYMENT_WINDOW_YEARS} years, and every driving job in the last ${CMV_WINDOW_YEARS} — with dates, addresses and phone numbers.`,
      `Your licence, and every other licence or permit you hold or have held in the last ${MVR_LOOKBACK_YEARS} years.`,
    ],
    /** Introduces the photographs, which are named from the capture catalogue rather than retyped. */
    photographHeading: "And these, to photograph:",
    /**
     * Said here because it is the part of the process nobody expects: the driver signs the carrier's
     * permission forms BEFORE the form itself (D-APP4), and then signs the application itself on a
     * second visit after the office has read it (F4). Both are shown only when they will actually
     * happen — the permissions are skipped while the wording is still draft, and a screen promising
     * a step the page then skips is worse than saying nothing.
     */
    /**
     * ⚠ Since AF4 the application does NOT follow on the same visit: the permissions (and the licence
     * details, AF3) come first, the carrier checks the driver's record, and only then sends the form.
     * A driver told "the application follows" would sit on the waiting screen wondering what broke.
     */
    signFirst: (carrier: string): string =>
      `${carrier} asks for your licence details and a few signed permissions first. After checking your record, they send you the application itself — we will email you the link.`,
    /**
     * ⚠ AF5 (D-AF3): the signing is no longer a visit to this link. It happens in the carrier's
     * office, on the same visit as the road test — and saying "we will send you the link" would
     * promise an email that never comes.
     */
    afterwards: (carrier: string): string =>
      `When you send it, ${carrier} reads it. You sign it in their office, when you come in for your road test.`,
    savesItself: "Your answers save as you go, so you can stop part-way and open your link again later.",
    start: "Start",
  },

  nav: {
    back: "Back",
    next: "Next",
    review: "Check my answers",
    fix: "Go to this section",
  },

  save: {
    saving: "Saving…",
    saved: "Saved. You can close this page and come back to it.",
    failed: "Not saved — check your signal. Your answers are still on this screen.",
    // C3d1b (AW10): the draft's revision moved on (another tab, another device, or the office).
    conflict: "Not saved — this application was changed on another screen.",
    conflictDetail:
      "Nothing you type here will be saved now. Reload the page to carry on from the latest answers. Anything typed on this screen since the last save will be lost.",
    reload: "Reload the page",
    restored: "We put back answers from this phone that had not been sent yet. They are being saved now.",
    dropped:
      "Some answers typed on this phone were never sent, and your application was changed after that, so they were not put back. Check your answers.",
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
    /** A v2 link (C3c2c2): the date of birth is Part 1's and shown, so only the name is entered here. */
    introPartOne: "Your name is matched against your driving record, so enter it exactly as it appears on your licence.",
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
  },

  addresses: {
    intro: `Every address you have lived at in the last ${EMPLOYMENT_WINDOW_YEARS} years. Leave the end month blank for where you live now.`,
    line1: "Street address",
    line2: "Apartment, unit",
    city: "City",
    state: "State",
    postal_code: "ZIP",
    from: "From",
    fromHint: "Month and year.",
    to: "Until",
    toHint: "Blank if you live here now.",
    add: "Add another address",
    remove: "Remove",
    optional: "Optional.",
    /** §391.21(b)(3)'s three years, counted in months like the boxes above (C3c1, `addressCoverage`). */
    coverageHeading: "The last three years",
    coverageComplete: "Every month of the last three years has an address.",
    gap: (from: string, to: string): string =>
      from === to ? `No address for ${from}. Add where you lived then.` : `No address from ${from} to ${to}. Add where you lived then.`,
    // ── C3c2c1: one address per screen on a v2 link (§6.4 item 2), the job loop's words ────────────
    listHeading: "Your addresses",
    addFirst: "Add where you live now",
    change: "Change",
    /** An address still lived at. The list has to say something; a blank reads as a missing answer. */
    toNow: "now",
    noDates: "No dates yet",
    /** An address on the list the page has refused: its boxes are in the panel, so the row says so. */
    needsAnswers: "Something here is missing. Choose Change to finish it.",
    drawerNew: "Add an address",
    drawerIntro: "One address at a time. You can change it later.",
    drawerSave: "Save this address",
    drawerCancel: "Cancel",
  },

  /**
   * Part 1's facts, shown read-only in Part 2 on a v2 link (C3c2c2, Q-AW34, §6.4 items 1 and 3), and the
   * one way to say one is wrong. The driver gave these at the start; the office checked them — so they
   * are shown, not asked again, and a correction is a note to the office rather than a retyped box.
   */
  partOneFacts: {
    heading: "From the start of your application",
    intro: "You gave us these at the start, and we checked your record with them.",
    dateOfBirth: "Date of birth",
    phone: "Mobile phone",
    cdl: "Your CDL",
    otherLicences: "Other licences",
    noOtherLicences: "None",
    classLabel: (cdlClass: string): string => `Class ${cdlClass}`,
    expires: (date: string): string => `expires ${date}`,
    /** A licence Part 1 recorded without an expiry: filing cannot place it on the application (Q-AW35). */
    noExpiry: "no expiry date given",
    /** (b)(5) lists unexpired licences only; an expired one is still checked (the MVR), just not listed. */
    expired: "expired — checked, but not listed on the application",
    currentAddress: "Where you live now",
    currentAddressNote: "This is the address you gave at the start. Tell us below if it is wrong.",
    tellUs: "Something wrong? Tell us",
    tellUsLabel: "What is wrong, and what it should be",
    tellUsHint: "We read this before we send your application on. We may call you about it.",
  },

  licence: {
    intro: `Every licence and permit you hold, and any you have held in the last ${MVR_LOOKBACK_YEARS} years, in any state. Start with the one you drive on.`,
    number: "Licence number",
    state: "Issuing state",
    stateHint: "Start typing to find it.",
    class: "Class",
    expires: "Expires",
    othersHeading: `Other licences and permits, now or in the last ${MVR_LOOKBACK_YEARS} years`,
    othersIntro:
      // Q-AF4 (owner, 2026-09-25): §391.23(a)(1) needs a driving record from every state that
      // licensed the driver in the last three years, so a licence given up on moving is asked for
      // here too. Each one listed becomes an MVR the office owes (`mvrJurisdictions.ts`).
      `If you moved from another state in the last ${MVR_LOOKBACK_YEARS} years, add that state's licence, even if you gave it up. Also add permits and endorsements issued separately. You may only hold one commercial licence at a time.`,
    issuingAuthority: "Issuing authority",
    issuingAuthorityHint: "The state or agency that issued it.",
    otherNumber: "Number",
    otherKind: "What it is",
    otherKindHint: "Optional — for example, hazmat endorsement.",
    addOther: "Add another licence or permit",
    remove: "Remove",
    optional: "Optional.",
  },

  ...APPLY_HISTORY_COPY,

  /**
   * A9. The carrier's own questions. Only the two controls need words here — everything else on the
   * screen comes from the versioned definition in shared, which is the point of D-APP12: the
   * carrier's form changes without an engineer editing a string.
   */
  questions: {
    /**
     * ⚠ Two labels, because "Add another" beside an empty table is a lie about what is there. On the
     * carrier's questions screen the education and references tables start empty, so the only thing
     * a driver saw was a button offering them a second of something they did not have a first of.
     */
    addRow: "Add another",
    addFirstRow: "Add one",
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
    /** D-AW9: the server re-hashed the object and it was not the photo sent (422 `capture_not_intact`). */
    notIntact: "That photo did not arrive intact. Take it again.",
    /**
     * Why a photograph was refused, in the driver's words rather than the gate's. Total over the
     * rejection taxonomy on purpose: a reason with no sentence would reach a driver as a blank.
     */
    rejected: {
      DOCUMENT_NOT_DETECTED: "No document in the picture. Lay it flat and fill the frame.",
      IMAGE_BLURRED: "Too blurry to read. Hold still and try again.",
      GLARE_OVER_TEXT: "There is glare across the text. Move away from the light.",
      SHADOW_OVER_TEXT: "A shadow is covering the text. Move so your hand is not over it.",
      RESOLUTION_TOO_LOW: "Too small to read. Take it closer so the document fills the frame, or choose a larger picture.",
      LENS_DIRTY: "The lens looks smudged. Wipe it and try again.",
      PAGE_INCOMPLETE: "Part of the document is out of frame. Fit all four corners in.",
      LOW_CONTRAST: "Too washed out to read. Try somewhere with more light.",
      UNDER_OR_OVER_EXPOSED: "Too dark or too bright. Try somewhere with even light.",
      TEXT_ILLEGIBLE: "The text cannot be read. Move closer and try again.",
      OCR_UNAVAILABLE: "Could not check the photo on this phone. Try again.",
      SCANNER_MODULE_UNAVAILABLE: "Could not open the camera. Try again.",
      UNSUPPORTED_DEVICE: "This phone cannot take the photo here. You can send it to the carrier instead.",
      CAPTURE_CANCELLED: "No photo taken.",
      // True for every source (2026-10-07): it said "the camera" until then, but a file the browser cannot
      // open — a HEIC in Chrome, a damaged PDF — lands here too, from "Upload" with no camera involved.
      PROVIDER_ERROR: "We could not open that picture. Take a new photo, or choose a different file.",
    },
  },

  review: {
    /**
     * ⚠ It no longer says "about to certify" (F4). On this visit the driver is about to SEND it —
     * the certification is asked for afterwards, on the document as the carrier leaves it, because
     * swearing that every entry is true has to happen after the entries stop moving.
     */
    intro:
      "This is everything you are about to send. Check it, and go back to any section that needs changing.",
    empty: "Not answered",
    none: "None declared",
    count: (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`,
  },

  certify: {
    heading: "Your certification",
    intro: "Typing your name is your signature.",
    /**
     * §391.21(b)(12)'s certification, word for word (C3c1): the regulation prescribes the sentence, and
     * the printed application already carries it (`render.ts`). This box said "I certify that all
     * entries…", which dropped "this application was completed by me". Source committed in
     * docs/plans/recruitment/cfr-391-21/ and read back by "certifies in §391.21(b)(12)'s own words".
     */
    statement:
      "This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.",
    signedName: "Your full name",
    dateNote: "The date is recorded for you when you sign.",
  },

  /**
   * The ceremony and the lifecycle screens — consent, signing, the hand-off, the certification.
   * One object so `strings.test.ts` can walk all of it; see `strings.flow.ts` for the seam.
   */
  ...APPLY_FLOW_COPY,
  ...APPLY_IDENTITY_COPY,
  ...APPLY_PART_ONE_COPY,
  ...APPLY_HUB_COPY,
  ...APPLY_PERMISSIONS_COPY,
  ...APPLY_SMS_COPY,
  ...APPLY_HANDBOOK_COPY,
} as const;
