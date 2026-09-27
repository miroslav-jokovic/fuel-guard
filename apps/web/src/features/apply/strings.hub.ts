/**
 * Part 2's words — "Your application" as a task list (APPLICATION-FLOW-V2-PLAN.md §6.4, D-AW11, C3c2).
 *
 * Its own file for `strings.partOne.ts`'s reason (`strings.ts` sits near the 500-line budget). Spread
 * into `APPLY_COPY`, so `strings.test.ts` walks every string here — no citation reaches a phone.
 *
 * ── THE NOTICE BEFORE SENDING, AND WHY MOST OF IT IS NOT OURS TO WORD ──────────────────────────
 * §391.21(d) has the carrier tell the applicant, "before an application is submitted", that what they
 * give under (b)(10) "may be used, and the applicant's previous employers will be contacted, for the
 * purpose of investigating the applicant's safety performance history", and to notify them in writing
 * of their §391.23(i) rights. Both are read from the regulation as fetched from the eCFR and committed
 * (docs/plans/recruitment/cfr-391-21/391.21.txt, 391.23.txt, current as of 2026-09-24). The three rights
 * are §391.23(i)(1)(i)–(iii) in the regulation's own words, second person; `EmployerCheckNotice.test.ts`
 * reads each one back out of the committed source, so a shortened right cannot pass. The how-to lines
 * restate (i)(2) and keep its limits: in writing, any time up to 30 days after being hired or refused,
 * five business days from the request or from the records arriving, and 30 days to collect them.
 */
export const APPLY_HUB_COPY = {
  hub: {
    heading: "Your application",
    intro: "Do these in any order. Your answers save as you go, and you can come back to any of them.",
    /** The four statuses of §6.4, in words. */
    status: {
      not_started: "Not started",
      in_progress: "In progress",
      completed: "Completed",
      cannot_start: "Cannot start yet",
    },
    optional: "Optional",
    /** Why "Before you send" is shut, said on its row. */
    finishFirst: "Finish the tasks above first.",
    beforeYouSend: "Before you send",
    backToList: "Back to your application",
    saveAndContinue: "Save and continue",
    /** Screen reader: what pressing a row does, beside the row's own name and status. */
    open: (task: string): string => `Open ${task}`,
  },
  employerCheck: {
    heading: "Before you send: checking your past employers",
    /** §391.21(d), first sentence. */
    use: "The information you give about the employers you had in the last 3 years may be used, and your previous employers will be contacted, to investigate your safety performance history.",
    /** §391.23(i)(1), its lead-in. */
    rightsIntro: "If you drove for a DOT-regulated employer in the last 3 years, you have these rights over the information they send us:",
    /** §391.23(i)(1)(i)–(iii), the regulation's own clauses in the second person. */
    rights: [
      "The right to review information provided by previous employers.",
      "The right to have errors in the information corrected by the previous employer and for that previous employer to re-send the corrected information to us.",
      "The right to have a rebuttal statement attached to the alleged erroneous information, if the previous employer and you cannot agree on the accuracy of the information.",
    ],
    /** §391.23(i)(2), restated with every limit it sets. */
    howTo: [
      "To see it, ask us in writing — at any time, including now, or up to 30 days after you are hired or told you were not.",
      "We will give it to you within 5 business days of your request, or within 5 business days of receiving it if it has not arrived yet.",
      "If you do not collect it within 30 days of it being made available, we may treat your request as withdrawn.",
    ],
  },
} as const;
