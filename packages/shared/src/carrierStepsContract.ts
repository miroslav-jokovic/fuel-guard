import { z } from "zod";
import { recordId } from "./recordId.js";
import { HIRING_STEPS } from "./hiringSteps.js";
import type { HiringStepKey } from "./hiringStepGraph.js";

/**
 * The carrier's own hiring steps (HIRING-WORKFLOW-AUDIT-2026-10-31 §10, D-CE1…D-CE7; the tables are 0545).
 *
 * ── WHAT A CARRIER STEP IS ────────────────────────────────────────────────────────────────────
 * A hair test, fingerprinting, ELD training, the fuel card issued — a step this carrier runs that the
 * built-in catalogue (`hiringSteps.ts`) does not. It has a name, what to do, a place (AFTER a built-in
 * step, D-CE4 — the built-in order is the owner's ruling and is not reordered), who owes it, what proves
 * it (D-CE2: a tick, or a filed paper), and whether the hire waits for it (D-CE6).
 *
 * ── WHAT IS DONE ──────────────────────────────────────────────────────────────────────────────
 * Each act on an applicant is an append-only record (0545): `done`, or `undone` with a reason. The LATEST
 * act per step is the answer — so a mistaken tick withdrawn reads open again, and the record still shows
 * who ticked it and who took it back.
 *
 * ── WHAT A CARRIER MAY HIDE (D-CE3) ───────────────────────────────────────────────────────────
 * Only the built-in steps the catalogue itself marks `carrierMayHide` — derived here, never listed. The
 * fold IGNORES any other key it is given, so a stored list naming `drug_test` hides nothing.
 *
 * ⚠ The lengths are 0545's CHECKs, restated so the browser can say so before a round trip; the database
 * stays the authority.
 */

/** 0545's `label` length, after trimming. */
export const CARRIER_STEP_LABEL_MAX = 80;
/** 0545's `instructions` and `note` lengths. */
export const CARRIER_STEP_TEXT_MAX = 1000;
/** 0545's `position between 0 and 1000`. */
export const CARRIER_STEP_POSITION_MAX = 1000;

export const CARRIER_STEP_PROOFS = ["tick", "document"] as const;
export type CarrierStepProof = (typeof CARRIER_STEP_PROOFS)[number];

/** The words for each proof, for the editor and the drawer. */
export const CARRIER_STEP_PROOF_LABELS: Record<CarrierStepProof, string> = {
  tick: "A tick (who and when)",
  document: "A document on file",
};

/** The built-in steps a carrier may say it does not run (D-CE3), in the catalogue's order. */
export const HIDEABLE_HIRING_STEPS: readonly HiringStepKey[] =
  HIRING_STEPS.filter((s) => s.carrierMayHide === true).map((s) => s.key);

/** Where a carrier step may go: after any built-in step but the hire, which is always last. */
export const CARRIER_STEP_ANCHORS: readonly HiringStepKey[] =
  HIRING_STEPS.filter((s) => s.key !== "hired").map((s) => s.key);

/**
 * §14 D-OF1: what the Settings screen OFFERS — rows only. The two lists above stay whole because they are
 * also the PUT schema's enums, and a carrier whose stored settings name a step that §14 took off the list
 * (live orientation) or drew inside another row (the medical card) must still be able to save them.
 */
export const HIDEABLE_ROW_STEPS: readonly HiringStepKey[] =
  HIDEABLE_HIRING_STEPS.filter((k) => HIRING_STEPS.some((s) => s.key === k && s.listed !== false && !s.shownIn));
export const CARRIER_STEP_ANCHOR_ROWS: readonly HiringStepKey[] =
  CARRIER_STEP_ANCHORS.filter((k) => HIRING_STEPS.some((s) => s.key === k && s.listed !== false && !s.shownIn));

/** The keys a stored hidden list may hold that the checklist will honour — anything else is ignored. */
export function hiddenHiringSteps(stored: readonly string[] | null | undefined): Set<HiringStepKey> {
  const allowed = new Set<string>(HIDEABLE_HIRING_STEPS);
  return new Set((stored ?? []).filter((k): k is HiringStepKey => allowed.has(k)));
}

const label = z
  .string()
  .trim()
  .min(1, "Give the step a name.")
  .max(CARRIER_STEP_LABEL_MAX, `A name can be at most ${CARRIER_STEP_LABEL_MAX} characters.`);
const instructions = z
  .string()
  .trim()
  .max(CARRIER_STEP_TEXT_MAX, `Keep it under ${CARRIER_STEP_TEXT_MAX} characters.`)
  .transform((v) => (v === "" ? null : v))
  .nullable();
const anchor = z.enum(CARRIER_STEP_ANCHORS as [HiringStepKey, ...HiringStepKey[]], {
  message: "Choose the step this one comes after.",
});
const owes = z.enum(["us", "them"]);

/** A new step on the carrier's list. What proves it is fixed from here on (CS011). */
export const carrierStepCreateSchema = z.object({
  label,
  instructions: instructions.optional().default(null),
  afterStep: anchor,
  owes: owes.optional().default("us"),
  proof: z.enum(CARRIER_STEP_PROOFS).optional().default("tick"),
  blocksHire: z.boolean().optional().default(false),
});
export type CarrierStepCreate = z.infer<typeof carrierStepCreateSchema>;

/**
 * What the office may change on a step: its words, its place, who owes it, whether the hire waits — or
 * retire it, which is one-way (CS012). Never what proves it (CS011), so there is no `proof` here.
 */
export const carrierStepUpdateSchema = z
  .object({
    label: label.optional(),
    instructions: instructions.optional(),
    afterStep: anchor.optional(),
    position: z.number().int().min(0).max(CARRIER_STEP_POSITION_MAX).optional(),
    owes: owes.optional(),
    blocksHire: z.boolean().optional(),
    retire: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
export type CarrierStepUpdate = z.infer<typeof carrierStepUpdateSchema>;

/**
 * One act on one applicant's step. A `done` on a document step names the filed paper; an `undone` says
 * why (CS028) and carries no paper (CS027). The database checks the paper is THIS driver's (CS026).
 */
export const carrierStepRecordSchema = z
  .object({
    act: z.enum(["done", "undone"]),
    note: z.string().trim().max(CARRIER_STEP_TEXT_MAX).optional().transform((v) => (v ? v : null)),
    documentId: recordId().nullable().optional().transform((v) => v ?? null),
  })
  .refine((v) => v.act === "done" || v.note !== null, {
    message: "Say why you are taking this back.", path: ["note"],
  })
  .refine((v) => v.act === "done" || v.documentId === null, {
    message: "Taking a step back files no document.", path: ["documentId"],
  });
export type CarrierStepRecordInput = z.infer<typeof carrierStepRecordSchema>;

/** The built-in steps this carrier does not run (Settings → Recruiting). Only hideable keys are accepted. */
export const hiddenHiringStepsSchema = z
  .array(z.enum(HIDEABLE_HIRING_STEPS as [HiringStepKey, ...HiringStepKey[]]))
  .max(HIDEABLE_HIRING_STEPS.length)
  .transform((v) => [...new Set(v)]);

/** One step on the carrier's list, as the API returns it — 0545's row. */
export interface CarrierStep {
  id: string;
  label: string;
  instructions: string | null;
  after_step: string;
  position: number;
  owes: "us" | "them";
  proof: CarrierStepProof;
  blocks_hire: boolean;
  created_at: string;
  retired_at: string | null;
}

/** The latest act on one step for one applicant. */
export interface CarrierStepLatest {
  stepId: string;
  act: "done" | "undone";
  at: string;
  byName: string;
  note: string | null;
  documentId: string | null;
}

/**
 * What the fold is given (`HiringChecklistInputs.carrierSteps`): the carrier's LIVE steps and, for this
 * applicant, the latest act on each. A retired step is not here — it neither shows nor holds the hire.
 */
export interface CarrierStepFacts {
  steps: readonly CarrierStep[];
  latest: readonly CarrierStepLatest[];
}

/** `POST /api/recruitment/applicants/:driverId/carrier-steps/:stepId` — what was recorded. */
export interface CarrierStepRecorded {
  latest: CarrierStepLatest;
}
