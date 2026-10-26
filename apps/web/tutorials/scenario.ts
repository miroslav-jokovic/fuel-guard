import type { Locator, Page } from "@playwright/test";

/**
 * A tutorial is DATA: chapters of steps, each a line to say, an optional thing to do, and what the
 * page must show afterwards. The director plays it (`director.ts`), the narration and captions are
 * made from its lines (`produce/`), and the written instructions are printed from it — one definition,
 * so the video, the subtitles and the handout can never describe different clicks.
 *
 * Any agent can propose one (`README.md` says how). `status: "proposed"` is never recorded; a person
 * reads it and flips it to `"approved"`.
 */
export type Target = (page: Page) => Locator;

export type Action =
  | { kind: "goto"; path: string }
  /** Move to it and ring it, touch nothing — for "this column tells you…". */
  | { kind: "point"; target: Target }
  | { kind: "click"; target: Target }
  | { kind: "type"; target: Target; text: string; clear?: boolean }
  | { kind: "select"; target: Target; value: string }
  | { kind: "press"; key: string };

export interface TutorialStep {
  /** Spoken, and shown as the caption. One or two plain sentences, written for a dispatcher. */
  say: string;
  act?: Action;
  /**
   * What must be true on the page once `act` is done — a web-first assertion. Required, because a
   * tutorial that carries on past a click that did nothing records a lie.
   */
  expect: (page: Page) => Promise<void>;
  /** A still for the written instructions; on unless a step only moves the cursor. */
  shot?: boolean;
}

export interface TutorialChapter {
  title: string;
  description?: string;
  steps: TutorialStep[];
}

export interface Tutorial {
  id: string;
  status: "proposed" | "approved";
  title: string;
  /** One sentence for the instructions' opening line. */
  summary: string;
  audience: "dispatcher";
  /** Where the recording opens. */
  start: string;
  /** What a reader must have before the steps make sense — e.g. an admin turning a screen on. */
  prerequisites?: string[];
  chapters: TutorialChapter[];
  /** `METHOD /path` patterns this tutorial may send; every other write is refused (`stub.ts`). */
  allowWrites?: RegExp[];
}

export const click = (target: Target): Action => ({ kind: "click", target });
export const point = (target: Target): Action => ({ kind: "point", target });
export const type = (target: Target, text: string, clear = false): Action => ({ kind: "type", target, text, clear });
export const goto = (path: string): Action => ({ kind: "goto", path });
export const press = (key: string): Action => ({ kind: "press", key });
