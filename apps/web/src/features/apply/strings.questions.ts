/**
 * The applicant form's words for §9 P8 (HIRING-WORKFLOW-AUDIT §3.3/§4.4, AF-1…AF-6).
 *
 * Its own file for `strings.identity.ts`'s reason — `strings.ts` sits at the edge of the 500-line
 * budget — and spread into `APPLY_COPY`, so `strings.test.ts` walks every string here and the Spanish
 * twin (`es/strings.es.questions.ts`) is checked key for key by `satisfies`.
 *
 * The questions' own words are not here: they are the versioned definition's, in shared, with its
 * Spanish overlay. These are only the words AROUND a question — the two answer buttons, the sentence
 * under a blank required one, the review's list of what is missing, and a job left unfinished.
 */
export const APPLY_QUESTIONS_COPY = {
  carrierQuestions: {
    /** AF-6: a yes/no question is two buttons. */
    yes: "Yes",
    no: "No",
    /** Under a required question left blank (the rule's own message is the API's, in English). */
    answerNeeded: "Answer this question.",
    /** Under an optional question in the review's list: it can be answered, or skipped on purpose. */
    answerOrSkip: (skip: string): string => `Answer it, or choose "${skip}".`,
  },
  missing: {
    /** AF-5: the review's count, at the top of its list. */
    heading: (n: number): string => (n === 1 ? "1 answer missing" : `${n} answers missing`),
    /** When every missing answer is optional, the applicant can still send. */
    canStillSend: "These are optional. You can send without them.",
    /** When at least one is required. */
    mustAnswer: "Answer the ones marked required before you send.",
    required: "Required",
    optional: "Optional",
  },
  unfinishedJob: {
    /** AF-4: a job with something in it but no name or no start date. */
    line: "Unfinished — finish or remove",
    /** The row's name when the applicant has not given one yet. */
    noName: "A job with no name",
    finish: "Finish",
  },
} as const;
