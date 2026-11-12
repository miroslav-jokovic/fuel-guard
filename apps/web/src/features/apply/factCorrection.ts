import { sevenDayHours } from "./draft";
import {
  keyedEditPath,
  applicantIdentitySchema,
  partOneAnswerSchema,
  partOneCorrectionWith,
  partOneCorrectionSchema,
  partOneKeyThrough,
  type ApplicantIdentity,
  type ApplicationEdit,
  type PartOneAnswer,
  type PartOneCorrection,
  type PartOneFactsView,
} from "@silvicom/shared";
import { currentAddressIndex, type FactRow } from "./applicantFactRows";

/**
 * One correction on the "Applicant facts" card, as the request its door takes (F3).
 *
 * The card edits one answer at a time, whatever writer holds it, and each writer has its own shape:
 * the draft takes a path and a value; the identity takes all three of its values; Part 1 takes its
 * whole set (`partOneCorrectionSchema`'s header has why). This turns the one change into the right
 * request, and checks it against the same contract the route validates with — so a blank the route
 * would refuse is refused here, in the field's own words, before anything is sent.
 */
export type FactCorrection =
  | { door: "draft"; edit: ApplicationEdit }
  | { door: "identity"; identity: ApplicantIdentity }
  | { door: "part_one"; body: PartOneCorrection }
  | { door: "part_one_answer"; answer: PartOneAnswer }
  | { problem: string };

/** What a correction may carry beside the answer: endorsements are a list, and a statement carries a reason. */
export type FactValue = string | boolean | null | readonly string[];

export interface CorrectionContext {
  revision: number;
  partOne: PartOneFactsView | null | undefined;
  /** Every row on the card: the identity door needs its other two values as shown. */
  rows: readonly FactRow[];
  /** The draft's addresses, for which one is the current home. */
  addresses: unknown;
  /** The draft itself, so a row of a keyed list is sent by its key (Q-AM15, `keyedEditPath`). */
  payload?: unknown;
}

/** A typed answer for Part 1 and the identity: a blank is no answer (null), which their contracts read. */
const stored = (value: string | boolean | null): string | boolean | null =>
  typeof value === "string" && value.trim() === "" ? null : value;

/**
 * A typed answer for the DRAFT: a blank is `""`, the way the driver's own form writes one (`toDraftPayload`).
 *
 * ⚠ Never null. `fromDraftPayload` — which the drawer's summary AND the driver's own page read the draft
 * through — calls `.trim()` on an address's `line2` and `to`, so a null there takes both screens to
 * their error boundary. Found in the F3 browser pass (2026-11-10): clearing an apartment number from
 * the card would have done exactly that. The old correction list sent `""` too.
 */
const draftStored = (value: string | boolean | null): string | boolean =>
  value === null ? "" : typeof value === "string" && value.trim() === "" ? "" : value;

const firstProblem = (issues: ReadonlyArray<{ message: string }>): string =>
  issues[0]?.message ?? "That is not a valid answer for this field.";

export function correctionFor(row: FactRow, value: FactValue, ctx: CorrectionContext, note?: string): FactCorrection {
  const reason = note?.trim() ? note.trim() : undefined;
  // Q-AM13: the driver's own statement moves only with the office's reason, whichever writer holds it.
  if (row.rule === "statement" && !reason) {
    return { problem: "Say why you are changing the applicant's own answer — they will read this before they sign." };
  }

  if (row.door === "part_one_answer") {
    const head = String(row.path[0]);
    const key = partOneKeyThrough(`application.${head}`) ?? head;
    const parsed = partOneAnswerSchema.safeParse({ key, value, ...(row.rule === "statement" ? { note: reason } : {}) });
    return parsed.success ? { door: "part_one_answer", answer: parsed.data } : { problem: firstProblem(parsed.error.issues) };
  }
  // Page 21 (Q-AM4): the seven boxes the card types, as the hours the contract files — all seven, or none.
  if (row.input === "seven_days") {
    const hours = Array.isArray(value) ? sevenDayHours(value as string[]) : null;
    if (!hours) return { problem: "Fill in all seven days with hours from 0 to 24 — 0 for a day off." };
    return { door: "draft", edit: { path: row.path, value: hours, revision: ctx.revision, ...(reason ? { note: reason } : {}) } };
  }
  if (Array.isArray(value)) return { problem: "That answer can't be corrected here." };
  const single = value as string | boolean | null;

  if (row.door === "draft") {
    const path = keyedEditPath(row.path, ctx.payload);
    const edit = { path, value: draftStored(single), revision: ctx.revision, ...(reason ? { note: reason } : {}) };
    return { door: "draft", edit };
  }
  const next = stored(single);

  if (row.door === "identity") {
    const now = (key: string) => {
      if (row.path.length === 1 && row.path[0] === key) return next;
      return ctx.rows.find((r) => r.path.length === 1 && r.path[0] === key)?.value ?? null;
    };
    const parsed = applicantIdentitySchema.safeParse({
      date_of_birth: now("date_of_birth"), cdl_number: now("cdl_number"), cdl_state: now("cdl_state"),
    });
    return parsed.success ? { door: "identity", identity: parsed.data } : { problem: firstProblem(parsed.error.issues) };
  }

  if (!ctx.partOne || typeof next === "boolean") return { problem: "That answer can't be corrected here." };
  const body = partOneCorrectionWith(ctx.partOne, row.path, next, currentAddressIndex(ctx.addresses));
  if (!body) return { problem: "That answer can't be corrected here." };
  const parsed = partOneCorrectionSchema.safeParse(body);
  return parsed.success ? { door: "part_one", body: parsed.data } : { problem: firstProblem(parsed.error.issues) };
}
