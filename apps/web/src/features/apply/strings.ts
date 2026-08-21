import {
  APPLICATION_SECTION_CITATIONS,
  APPLICATION_SECTION_LABELS,
  CMV_WINDOW_YEARS,
  EMPLOYMENT_WINDOW_YEARS,
} from "@fuelguard/shared";

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
 */

export const APPLY_SECTION_TITLES = APPLICATION_SECTION_LABELS;
export const APPLY_SECTION_CITATIONS = APPLICATION_SECTION_CITATIONS;

export const APPLY_COPY = {
  page: {
    title: "Driver application",
    /** Named as a function because the carrier is a fact, and a template literal here would be a
     *  string a translator cannot reorder. */
    subtitle: (carrier: string): string =>
      `For ${carrier}, under 49 CFR §391.21. Your answers save as you go — you can close this page and come back.`,
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
    ssn: "Social Security number",
    /** Q-H2. The number is optional, and the reason it is asked at all is stated in one sentence. */
    ssnHint:
      "Optional. It is asked because §391.21(b)(2) lists it and some driving-record checks match on it. Only the last four digits are kept in a readable form.",
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
    intro:
      "§391.21(b)(5) asks for every unexpired licence and permit you hold. Start with the one you drive on.",
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
    addressHint: "§391.23 requires us to record where we wrote to.",
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
    reasonHint: "§391.21(b)(10) asks for it.",
    operatedCmv: "I drove a commercial vehicle in this job",
    dotRegulated: "This employer was DOT-regulated",
    safetySensitive: "This job was safety-sensitive under DOT drug and alcohol rules",
    subjectToFmcsr: "This job was subject to the federal motor carrier safety regulations",
    add: "Add another employer",
    remove: "Remove",
    experience: "Driving experience",
    experienceHint: "Optional — equipment, routes, years.",
  },

  safety: {
    intro: "These three questions come from §391.21(b)(7)–(9) and cover the last three years.",
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
    denialDetailHint: "§391.21(b)(9) asks for the reason.",
    remove: "Remove",
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
    intro: "§391.21(b) requires you to certify this. Typing your name is your signature.",
    statement:
      "I certify that all entries on this application are true and complete to the best of my knowledge.",
    signedName: "Your full name",
    dateNote: "The date is recorded for you when you send this.",
  },

  done: {
    heading: "Your application is in",
    body: (carrier: string): string =>
      `${carrier} has it, certified in your name under 49 CFR §391.21(b). They will contact you about what happens next.`,
    reopen:
      "You can close this page. Your link still opens to this message, and it cannot be used to send a second application.",
  },

  dead: {
    heading: "This link is not valid",
    body: "It may have expired, or the carrier may have replaced it. Ask the carrier who invited you for a new one.",
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
