import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS } from "@silvicom/shared";

/**
 * The employment and safety-history screens' words — the two longest sections of the form.
 *
 * ⚠ **Split out of `strings.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at that file's
 * 450-line warning. Spread back into `APPLY_COPY` at the place `employment` and `safety` stood, so
 * they are still reached as `APPLY_COPY.employment` and `APPLY_COPY.safety`, `strings.test.ts`
 * still walks them, and no component imports this directly. `strings.ts`'s header — the voice, and
 * no CFR citation in any string — governs every line here too.
 */
export const APPLY_HISTORY_COPY = {
  employment: {
    intro: `List every job — driving or not — from the last ${EMPLOYMENT_WINDOW_YEARS} years. For the ${CMV_WINDOW_YEARS - EMPLOYMENT_WINDOW_YEARS} years before that, list only the jobs where you drove a commercial vehicle. Time you were not driving is not a gap you need to explain.`,
    none: "I have not been employed during this period",
    employer: "Employer",
    usdot: "USDOT number",
    usdotHint: "If you know it.",
    address: "Street address",
    addressHint: "We have to record where we wrote to.",
    city: "City",
    state: "State",
    phone: "Phone",
    phoneHint: "So we can contact them.",
    email: "Email",
    emailHint: "If you know it.",
    position: "Position",
    from: "From",
    to: "Until",
    toHint: "Blank if you work there now.",
    reason: "Reason for leaving",
    reasonHint: "Why you moved on.",
    operatedCmv: "I drove a commercial vehicle in this job",
    dotRegulated: "This employer was DOT-regulated",
    /**
     * The two "whether" questions the regulation asks about each job in the last three years, asked as
     * Yes/No with nothing chosen (C3c2b, Q-AW33) — they were two unticked statements, so leaving them
     * alone answered "No". Plain words for the regulation's; `EmployerQuestions.test.ts` holds each
     * against the committed text (cfr-391-21/391.21.txt, (b)(10)(iv)(A) and (B)):
     *   (A) "Applicant was subject to the FMCSRs while employed by that previous employer"
     *   (B) "Job was designated as a safety sensitive function in any DOT regulated mode subject to
     *       alcohol and controlled substances testing requirements as required by 49 CFR part 40"
     * The review screen and the office's labels print these same questions beside the answer.
     */
    subjectToFmcsr: "In this job, did the Federal Motor Carrier Safety Regulations apply to you?",
    subjectToFmcsrHint: "The federal safety rules for trucking companies and their drivers.",
    safetySensitive: "Was this a safety-sensitive job that required DOT drug and alcohol testing?",
    safetySensitiveHint:
      "Any job the DOT tests for drugs and alcohol, in any industry it regulates — trucking, buses, aviation, rail, transit or pipelines.",
    /** A job on the list with an answer still missing (v2): the answers are inside, so the row says so. */
    jobNeedsAnswers: "Some answers are missing. Choose Change to finish them.",
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
    equipmentMonthHint: "Month and year.",
    equipmentTo: "Until",
    equipmentToHint: "Blank if you still drive it.",
    equipmentMiles: "Approximate total miles",
    equipmentMilesHint: "A rough number is fine.",
    addEquipment: "Add equipment",

    // ── X5: one job at a time ────────────────────────────────────────────────────────────────
    /** The hub's own instruction, replacing the one that introduced a screen of ninety controls. */
    jobsHeading: "Your jobs",
    addFirstJob: "Add your first job",
    addJob: "Add another job",
    editJob: "Change",
    removeJob: "Remove",
    jobNoDates: "No dates yet",
    /** A job still being driven. The list has to say something; a blank reads as a missing answer. */
    jobToNow: "now",
    coverageHeading: "How much you have accounted for",
    coverage: (percent: number, years: number): string =>
      `${percent}% of the last ${years} years is accounted for.`,
    coverageComplete: (years: number): string => `The last ${years} years are accounted for.`,
    coverageEmpty: (years: number): string =>
      `Nothing yet. Add the jobs you have had over the last ${years} years.`,
    /**
     * A stretch with no job, and the box beside it (C3c1, AW1). The earlier wording said "the carrier
     * may ask you about it" because the form had no box; now it has one, so the line asks here. A job
     * the driver forgot is still the first thing it suggests — adding it closes the gap and the box goes.
     */
    gap: (from: string, to: string): string =>
      `${from} to ${to} is not covered. If you were working then, add that job. If not, say what you were doing.`,
    gapExplanation: "What were you doing then?",
    /** The review's heading over the explanations (C3c1). */
    gapsHeading: "Time between jobs",
    gapExplanationHint: "For example: looking for work, school, medical leave, caring for family.",
    /**
     * ⚠ Says the company name need not be exact. Owner, 2026-09-11: drivers do not remember the
     * exact legal names of carriers they left years ago, and a form that looks like it wants one is
     * a form they stop filling in. The office confirms the name at review; what it needs from the
     * driver is enough to find the employer.
     */
    employerHint: "The name as you remember it is fine — we will confirm it.",
    /**
     * ⚠ "(optional)" is in the SUMMARY and not only in the hint below it. A `<details>` shows its
     * hint only once opened, so a closed disclosure reading "More about this job" tells a driver
     * nothing about whether they have to — which is the whole thing this change is for. Seen at
     * 390px, 2026-09-11.
     */
    moreAboutJob: "More about this job (optional)",
    moreAboutJobHint: "Add what you know. We will ask you later if we need the rest.",
    drawerNew: "Add a job",
    drawerIntro: "One job at a time. You can change it later.",
    drawerSave: "Save this job",
    drawerCancel: "Cancel",
    aboutThisJob: "About this job",
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
} as const;
