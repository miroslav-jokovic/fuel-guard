/**
 * HazmatGuard load state machine (plan H4) — the LOCKED set of legal transitions. Pure + dependency-free
 * so it is testable in isolation and shared by the API (enforcement) and the web UI (button gating). The
 * transition table mirrors docs/18-HAZMATGUARD-PLAN.md §H4 exactly; changing it is a plan change.
 *
 * The state machine decides ONLY from→to legality. Payload guards live at the call site:
 *   - `cancel` requires a reason; `review_cleared` requires a named attestation (D8);
 *   - clearing (`analysis_green` / `review_cleared`) is additionally REFUSED by the service when the
 *     active dataset is `provisional: true` (H1.6/D2) — the state machine permits it, the clear path
 *     blocks it, so the two concerns stay separate and independently testable.
 */

export const HAZMAT_LOAD_STATUSES = [
  "draft", "submitted", "extracting", "needs_review", "cleared", "rejected", "superseded", "cancelled",
] as const;
export type HazmatLoadStatus = (typeof HAZMAT_LOAD_STATUSES)[number];

export const HAZMAT_LOAD_EVENTS = [
  "submit", "start_extraction", "analysis_green", "analysis_flagged",
  "review_cleared", "review_rejected", "cancel", "supersede", "resubmit", "rerun",
] as const;
export type HazmatLoadEvent = (typeof HAZMAT_LOAD_EVENTS)[number];

interface TransitionSpec {
  from: readonly HazmatLoadStatus[];
  to: HazmatLoadStatus;
  /** Short human description for error messages + the review log. */
  what: string;
}

/** The locked transition table (plan H4). */
const TRANSITIONS: Record<HazmatLoadEvent, TransitionSpec> = {
  submit:           { from: ["draft"],                    to: "submitted",    what: "driver/dispatcher submits" },
  start_extraction: { from: ["submitted"],                to: "extracting",   what: "extraction job starts (photo path)" },
  analysis_green:   { from: ["submitted", "extracting"],  to: "cleared",      what: "analysis completes green (auto-clear)" },
  analysis_flagged: { from: ["submitted", "extracting"],  to: "needs_review", what: "analysis completes with any flag" },
  review_cleared:   { from: ["needs_review"],             to: "cleared",      what: "reviewer resolves flags → re-run green + attestation" },
  review_rejected:  { from: ["needs_review"],             to: "rejected",     what: "reviewer rejects (illegible / wrong document)" },
  cancel:           { from: ["draft", "submitted", "needs_review"], to: "cancelled", what: "creator/admin/dispatcher cancels (reason required)" },
  supersede:        { from: ["cleared"],                  to: "superseded",   what: "a superseding load is cleared" },
  resubmit:         { from: ["rejected"],                 to: "submitted",    what: "driver resubmits documents" },
  rerun:            { from: ["cleared"],                  to: "needs_review", what: "any new run on a cleared load (prior verdict superseded-by-run)" },
};

export interface TransitionResult {
  ok: boolean;
  to?: HazmatLoadStatus;
  error?: string;
}

/** Validate a transition. Returns the resulting status or a clear, safe error message. */
export function hazmatTransition(from: HazmatLoadStatus, event: HazmatLoadEvent): TransitionResult {
  const spec = TRANSITIONS[event];
  if (!spec) return { ok: false, error: `Unknown hazmat load event "${event}".` };
  if (!spec.from.includes(from)) {
    return { ok: false, error: `Illegal transition: cannot "${event}" (${spec.what}) from status "${from}".` };
  }
  return { ok: true, to: spec.to };
}

/** The events legal from a given status (for UI button gating + tests). */
export function legalEvents(from: HazmatLoadStatus): HazmatLoadEvent[] {
  return HAZMAT_LOAD_EVENTS.filter((e) => TRANSITIONS[e].from.includes(from));
}

/** A cleared load is IMMUTABLE — only a `draft` may be edited (PATCH). Everything else creates a new run/load. */
export function canEditLoad(status: HazmatLoadStatus): boolean {
  return status === "draft";
}

/** Statuses from which no forward progress is possible without creating a NEW load. */
export const TERMINAL_STATUSES: readonly HazmatLoadStatus[] = ["superseded", "cancelled"] as const;
export function isHazmatLoadTerminal(status: HazmatLoadStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Clearing events — the service must additionally refuse these on a provisional dataset (H1.6/D2). */
export const CLEARING_EVENTS: readonly HazmatLoadEvent[] = ["analysis_green", "review_cleared"] as const;
export function isClearingEvent(event: HazmatLoadEvent): boolean {
  return CLEARING_EVENTS.includes(event);
}
