import { sentenceCase } from "./sentenceCase";
/**
 * The orientation videos page's words (HW8a, 0539; HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8) — the page the
 * office's "Send the videos" opens, `/apply/<token>/videos`. Its own file for the reason the handbook's is
 * (`strings.handbook.ts`), spread into `APPLY_COPY` so `strings.test.ts` walks it.
 *
 * ── WHAT THE PAGE HAS TO SAY ──────────────────────────────────────────────────────────────────
 * Which videos, which are required, that the driver opens each and comes back, and that the tick is
 * their word: "I watched these" with their name. Nothing says the page knows they watched — it cannot.
 */
export const APPLY_VIDEOS_COPY = {
  videos: {
    heading: "Orientation videos",
    intro: (carrier: string): string =>
      `${sentenceCase(carrier)} asks you to watch these before you come in. It shortens your day in the office. Open each one, watch it, then come back to this page.`,
    required: "Required",
    optional: "Optional",
    minutes: (n: number): string => `${n} min`,
    open: "Watch",
    ticked: "You said you watched this",
    none: (carrier: string): string =>
      `${sentenceCase(carrier)} has not added any videos yet. You can close this page.`,
    attestHeading: "When you have watched them",
    attestLabel: "I watched these videos",
    nameLabel: "Your full name",
    submit: "Send",
    submitting: "Sending…",
    done: (when: string): string => `Thank you. You said you watched these videos on ${when}.`,
    allDone: "You have watched every video. There is nothing more to do here.",
    failed: "That did not go through. Try again.",
    changed: "The list of videos changed. The page has been refreshed — please look at it again.",
    backToApplication: "Open my application",
  },
} as const;
