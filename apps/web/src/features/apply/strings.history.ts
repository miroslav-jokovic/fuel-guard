import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS } from "@silvicom/shared";
import { EMPLOYMENT_FORM_COPY } from "@/components/employment/employmentCopy";

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
    /**
     * The one employer form's and the timeline's words (HW5b), written once in
     * `@/components/employment/employmentCopy.ts` because the office asks the same questions.
     */
    ...EMPLOYMENT_FORM_COPY,
    /**
     * EM-10: this said "Time you were not driving is not a gap you need to explain" while the gap boxes
     * below asked exactly that. A stretch of the three years with no job IS asked about — by the filing,
     * and by the boxes — so the intro now says so.
     */
    intro: `List every job — driving or not — from the last ${EMPLOYMENT_WINDOW_YEARS} years. For the ${CMV_WINDOW_YEARS - EMPLOYMENT_WINDOW_YEARS} years before that, list only the jobs where you drove a commercial vehicle. If there was time in the last ${EMPLOYMENT_WINDOW_YEARS} years with no job, you will be asked what you were doing.`,
    none: "I have not been employed during this period",
    operatedCmv: "I drove a commercial vehicle in this job",
    dotRegulated: "This employer was DOT-regulated",
    add: "Add another employer",
    remove: "Remove",
    experience: "Driving experience",
    experienceHint: "Optional — equipment, routes, years.",
    /** §391.21(b)(6)'s second half, laid out as FMCSA's own sample application lays it out. */
    equipmentHeading: "Equipment you have driven",
    equipmentClass: "Class of equipment",
    equipmentType: "Type",
    equipmentTypeHint: "Van, tank, flat, and so on.",
    equipmentFrom: "From",
    equipmentMonthHint: "Month and year.",
    equipmentTo: "Until",
    equipmentToHint: "Blank if you still drive it.",
    equipmentMiles: "Approximate total miles",
    equipmentMilesHint: "A rough number is fine.",

    // ── X5: one job at a time ────────────────────────────────────────────────────────────────
    addJob: "Add another job",
    coverage: (percent: number, years: number): string =>
      `${percent}% of the last ${years} years is accounted for.`,
    coverageComplete: (years: number): string => `The last ${years} years are accounted for.`,
    /**
     * A stretch with no job (C3c1, AW1). A job the driver forgot is the first thing it suggests — adding
     * it closes the gap. The question about the stretch itself is the walk's (`walk.gap`).
     */
    gap: (from: string, to: string): string =>
      `${from} to ${to} is not covered. If you were working then, add that job. If not, say what you were doing.`,
    /** The review's heading over the explanations (C3c1). */
    gapsHeading: "Time between jobs",
    /**
     * The task walked one question to a screen (F4 PR 1b-4, SCREEN-MAP 2.8–2.17). The form's labels above
     * stay the office's and the review's; on a screen of its own a label IS the question.
     */
    walk: {
      any: `Have you had a job in the last ${EMPLOYMENT_WINDOW_YEARS} years, or driven a truck for anyone in the last ${CMV_WINDOW_YEARS}?`,
      anyHint: "Start with your current or most recent job. You will be asked about each one in turn.",
      name: "What was the company's name?",
      city: "City",
      state: "State",
      /** D-AM4: the office completes what the driver does not know — here the whole place is optional. */
      placeIntro: "Where was the company based?",
      placeHint: "If you do not know it, leave it blank. The office will fill it in.",
      from: "When did you start?",
      to: "When did you leave?",
      toHint: "Leave blank if you still work there.",
      drove: "Did you drive a truck in this job?",
      position: "What was your job there?",
      /** Q-AM9 (a): the three DOT answers as one question, with a third answer for the office. */
      dot: "Was it a DOT job?",
      dotHint: "A job with DOT drug tests, a logbook or ELD, or a DOT medical card.",
      notSure: "Not sure",
      reason: "Why did you leave?",
      reasonHint: "If you still work there, say why you are looking. Tap one, or type your own.",
      another: `Did you have another job in the last ${EMPLOYMENT_WINDOW_YEARS} years, or a truck-driving job in the last ${CMV_WINDOW_YEARS}?`,
      jobRow: (n: number): string => `Job ${n}`,
      removeJob: "Remove this job",
      gapRow: (from: string, to: string): string => `No job from ${from} to ${to}`,
      gap: "What were you doing then?",
      gapHint: "If you were working, go back and add that job. Tap one, or type your own.",
      equipment: "What have you driven?",
      equipmentHint: "Tap every kind you have driven.",
      equipmentType: "What type?",
      equipmentFrom: "When did you start driving it?",
      equipmentTo: "When did you stop?",
      equipmentMiles: "About how many miles?",
      experience: "Anything else about your driving we should know?",
      experienceHint: "Optional. Routes, loads, years.",
    },
  },

  safety: {
    intro: "Three questions about your driving record. The lists open only when the answer is yes.",
    /**
     * The three gates (C3c2c1, §6.4 item 6: "yes/no gates first; loops only on Yes"), asked with nothing
     * chosen. Plain words for (b)(7), (b)(8) and (b)(9); `safetyQuestionsRegulation.test.ts` holds each against
     * the committed text (cfr-391-21/391.21.txt):
     *   (b)(7) "all motor vehicle accidents in which the applicant was involved during the 3 years"
     *   (b)(8) "all violations of motor vehicle laws or ordinances (other than violations involving only
     *          parking) of which the applicant was convicted or forfeited bond or collateral during the
     *          3 years"
     *   (b)(9) "any denial, revocation, or suspension of any license, permit, or privilege to operate a
     *          motor vehicle" — with no time limit, so the question has none either.
     * The "no" answers still print under the old statements below (`noAccidents`, …) on the review.
     */
    accidentsQuestion: "In the last 3 years, were you involved in any motor vehicle accident?",
    violationsQuestion:
      "In the last 3 years, were you convicted of breaking a traffic law, or did you forfeit bond or collateral for one?",
    violationsQuestionHint: "Parking tickets do not count.",
    // F2c (P4): the carrier's A and B, asked apart as page 2 asks them.
    deniedQuestion: "Have you ever been denied a license, permit or privilege to operate a motor vehicle?",
    suspendedQuestion: "Has any license, permit or privilege of yours ever been suspended or revoked?",
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
    violationState: "State where it happened",
    penalty: "Penalty",
    licenceHeading: "License history",
    everDenied: "Denied a license, permit or privilege to drive",
    everSuspended: "A license, permit or privilege suspended or revoked",
    denialDetail: "Why it was denied",
    denialDetailHint: "The reason it happened.",
    suspensionDetail: "Why it was suspended or revoked",
    suspensionDetailHint: "When, and the reason.",
    /**
     * §40.25(j)'s two-year question (P8), as the review and the office's card label its answer. The
     * question itself is Part 1's (`strings.partOne.ts`); this form has not asked it since the legacy
     * wizard went, so only the heading is left here. ⚠ No citation in the copy — D-UI9.
     */
    priorTestHeading: "Drug and alcohol tests",
    remove: "Remove",
    /**
     * The task walked one question to a screen (F4 PR 1b-1, SCREEN-MAP 2.18–2.21). The section's labels
     * above stay the office's and the review's ("Date", "Offence"); on a screen of its own a label IS the
     * question, so it is asked as one.
     */
    walk: {
      accidentDate: "When was the accident?",
      accidentNature: "What happened?",
      accidentNatureHint: "A sentence is enough — for example, \"rear-ended at a light\".",
      fatalities: "How many people died?",
      injuries: "How many people were hurt?",
      hazmatSpill: "Were hazardous materials spilled?",
      violationDate: "When were you convicted?",
      offence: "What was it for?",
      violationState: "In which state did it happen?",
      penalty: "What was the penalty?",
      quickPickHint: "Tap one, or type your own.",
      accidentRow: (n: number) => `Accident ${n}`,
      violationRow: (n: number) => `Conviction ${n}`,
      anotherAccident: "Were you in any other accident in the last 3 years?",
      anotherViolation: "Were you convicted of any other traffic violation in the last 3 years?",
      removeAccident: "Remove this accident",
      removeViolation: "Remove this conviction",
    },
  },
} as const;
