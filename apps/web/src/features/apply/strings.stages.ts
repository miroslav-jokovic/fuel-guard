import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS, MVR_LOOKBACK_YEARS, type ApplicationStage } from "@silvicom/shared";
import { sentenceCase } from "./sentenceCase";

/**
 * The three stages of an application, and what the driver is told before the first (B7, U1).
 *
 * ⚠ Split out of `strings.ts` on 2026-11-14, at 490 of its 500 lines, with the screen that reads it
 * (`ApplyExpectations`) and the bar every screen carries (`ApplyStages`). Spread back into `APPLY_COPY`,
 * so it is still `APPLY_COPY.expectations`; `strings.ts`'s header — the voice, and no CFR citation in any
 * string — governs every line here too.
 */
export const APPLY_STAGES_COPY = {
  /**
   * The stages by name, for the bar on every screen (SCREEN-MAP §1: "a three-stage progress bar"). Short,
   * because three of them share a phone's width.
   */
  stages: {
    label: "Your application, in three stages",
    names: { today: "Today", history: "Your history", signing: "Signing" } satisfies Record<ApplicationStage, string>,
    /** For a screen reader, which cannot see which of the three is filled. */
    state: { done: "done", current: "you are here", ahead: "later" },
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
    /** The one sentence the screen exists for: it is three visits, not one sitting. */
    howLong: "It is done in three stages, on this same link. You do not have to finish in one sitting.",
    /**
     * ⚠ Rounded to the nearest five minutes on the way out. The estimates are judgements nobody has
     * measured; printing one to the minute would dress it up as a stopwatch.
     */
    minutes: (minutes: number): string => `about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`,
    /**
     * What each stage is, and when it happens. The waits are said here because they are the part nobody
     * expects: the office checks the driver's record before it sends the application (AF4), and reads
     * the application before anybody signs it (F4).
     */
    stage: {
      today: {
        what: "Your license, a few questions, and the permissions to check your record.",
        when: "Now, with your CDL in your hand.",
      },
      history: {
        what: "Where you have lived and worked, and your driving record.",
        when: (carrier: string): string => `After ${carrier} has checked your record. We email you when it is ready, and you can do it any time that week.`,
      },
      signing: {
        // ⚠ D-AW14 (2026-09-26): signed on the driver's own phone, from a link the office sends — never
        // on an office computer. This said "in their office, when you come in for your road test" (AF5)
        // for seven weeks after that ruling.
        what: "You read the finished application and sign it.",
        when: (carrier: string): string => `After ${carrier} has read it. We send you the link to sign on your phone.`,
      },
    },
    needHeading: "What to have with you",
    needs: [
      `Every address you have lived at in the last ${EMPLOYMENT_WINDOW_YEARS} years.`,
      `Every job you have held in the last ${EMPLOYMENT_WINDOW_YEARS} years, and every driving job in the last ${CMV_WINDOW_YEARS} — with dates.`,
      `Your license, and every other license or permit you hold or have held in the last ${MVR_LOOKBACK_YEARS} years.`,
    ],
    /** Introduces the photographs, which are named from the capture catalogue rather than retyped. */
    photographHeading: "And these, to photograph if you have them:",
    /**
     * Shown only when the permissions will actually be asked for: they are skipped while the wording is
     * still draft, and a screen promising a step the page then skips is worse than saying nothing.
     */
    signFirst: (carrier: string): string =>
      `${sentenceCase(carrier)} asks for your license details and a few signed permissions first.`,
    savesItself: "Your answers save as you go, so you can stop part-way and open your link again later.",
    start: "Start",
  },
} as const;
