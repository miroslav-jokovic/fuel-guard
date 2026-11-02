import type { CarrierStep, CarrierStepFacts, CarrierStepLatest, CarrierStepProof } from "./carrierStepsContract.js";
import type { HiringStepKey } from "./hiringStepGraph.js";
import { HIRING_STEPS } from "./hiringSteps.js";

/**
 * The carrier's own steps, folded for one applicant (HIRING-WORKFLOW-AUDIT §10 CE2) — the half of the
 * checklist `hiringChecklist()` does not decide itself, kept beside it because that file sits at its
 * size warning and this is a separate question: not "what does the catalogue's evidence say" but "what
 * did the office record on the steps this carrier added".
 *
 * ⚠ **Its own list, not rows in `steps`.** Every `steps` consumer — the drawers, the board's `next`, the
 * travel and send warnings — switches on `HiringStepKey`, a closed union; a carrier row there would be a
 * key nothing can switch on. So the checklist carries `carrierSteps` beside `steps`, each row saying
 * which emitted built-in it shows after (`showAfter`), and a screen interleaves the two.
 */

export type CarrierStepState = "done" | "waiting_on_us" | "waiting_on_them";

export interface CarrierChecklistRow {
  id: string;
  label: string;
  instructions: string | null;
  owes: "us" | "them";
  proof: CarrierStepProof;
  blocksHire: boolean;
  /** The step's place as the carrier set it (`after_step`). */
  afterStep: string;
  /**
   * Where a screen shows it: the nearest step the fold EMITTED at or before its place — so a step placed
   * after a hidden or unmeasured built-in still shows, where that one would have been. Null = before the
   * first emitted step.
   */
  showAfter: HiringStepKey | null;
  state: CarrierStepState;
  /** The latest act — a done one when the row is done, an undo (with why) when it was taken back. */
  record: CarrierStepLatest | null;
}

const CATALOGUE_INDEX = new Map<string, number>(HIRING_STEPS.map((s, i) => [s.key, i]));
/** A place the catalogue no longer has reads as "at the end, before the hire" (0545 header), never lost. */
const placeOf = (step: Pick<CarrierStep, "after_step">): number =>
  CATALOGUE_INDEX.get(step.after_step) ?? HIRING_STEPS.length - 2;

/**
 * The carrier rows for one applicant, in checklist order: by place, then the office's position, then when
 * added. `emitted` is the built-in keys the fold put on the checklist, in its order.
 */
export function carrierChecklistRows(
  facts: CarrierStepFacts | null | undefined,
  emitted: readonly HiringStepKey[],
): CarrierChecklistRow[] {
  if (!facts || facts.steps.length === 0) return [];
  const latest = new Map(facts.latest.map((l) => [l.stepId, l]));
  const emittedAt = emitted.map((k) => ({ key: k, at: CATALOGUE_INDEX.get(k) ?? -1 }));
  return facts.steps
    .filter((s) => s.retired_at === null)
    .slice()
    .sort((a, b) => placeOf(a) - placeOf(b) || a.position - b.position || a.created_at.localeCompare(b.created_at))
    .map((s) => {
      const place = placeOf(s);
      const before = emittedAt.filter((e) => e.at <= place);
      const record = latest.get(s.id) ?? null;
      const done = record?.act === "done";
      return {
        id: s.id,
        label: s.label,
        instructions: s.instructions,
        owes: s.owes,
        proof: s.proof,
        blocksHire: s.blocks_hire,
        afterStep: s.after_step,
        showAfter: before.length > 0 ? before[before.length - 1]!.key : null,
        state: done ? "done" : s.owes === "us" ? "waiting_on_us" : "waiting_on_them",
        record,
      };
    });
}

/** The carrier steps this hire still waits for (D-CE6) — the ones switched to hold it and not done. */
export function carrierHireBlockers(checklist: { carrierSteps: readonly CarrierChecklistRow[] }): CarrierChecklistRow[] {
  return checklist.carrierSteps.filter((s) => s.blocksHire && s.state !== "done");
}
