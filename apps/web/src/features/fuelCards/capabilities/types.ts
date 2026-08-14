import type { CapabilityContract, WsCard } from "@fuelguard/shared";

/**
 * The VIEW half of a capability: the words an operator reads before they commit.
 *
 * Deliberately separate from the contract's `ui` block. The contract says which CONTROLS exist and
 * which rows a diff should show — data the API's router and the config scanner also read. This says
 * what the confirmation SAYS, which is prose, belongs with the front end, and is the part most
 * likely to be reworded without any behaviour changing (docs/27 §6.3).
 *
 * Web-side only. Nothing here may import from the API, and the contract it binds to is browser-safe.
 *
 * Nothing consumes these yet. Step 3.6 moves the per-intent confirmation builders out of
 * `cardControlModel.ts` and into views; until then that file remains the source of the five
 * confirmations the drawer renders.
 */

/**
 * The confirmation step, which is the last thing between an operator and a real card.
 *
 * A separate `busyLabel` and `doneLabel` are not decoration: the drawer must never report an outcome
 * nobody confirmed, so the button says what is HAPPENING while a write is in flight and what
 * actually happened once the API has answered (audit finding, web #3).
 */
export interface CapabilityConfirmation {
  tone: "neutral" | "warning" | "danger";
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel: string;
  doneLabel: string;
}

/** One before/after line in the confirmation's diff. */
export interface CapabilityDiffRow {
  label: string;
  before: string;
  after: string;
}

export const row = (label: string, before: string, after: string): CapabilityDiffRow => ({ label, before, after });

/**
 * What the view is given to describe a change.
 *
 * The CARD as the drawer currently holds it, plus the masked reference. `maskedRef` rather than a
 * card number, because a view has no legitimate use for a PAN and the type is the cheapest place to
 * make that impossible.
 */
export interface CapabilityCardContext {
  maskedRef: string;
  card: Pick<WsCard, "status" | "infos" | "limits" | "overrideUses" | "overrideAllLocations" | "locationOverrideId">;
}

export interface CapabilityView<TBody> {
  confirmation: (body: TBody, card: CapabilityCardContext) => CapabilityConfirmation;
  /** Rendered above the confirm button. Empty is legitimate — a lock changes one field. */
  diff: (before: CapabilityCardContext["card"], body: TBody) => CapabilityDiffRow[];
}

/**
 * Bind a view to its contract so the body type flows from the same z.infer the behaviour uses.
 *
 * Inference only; the contract is not stored. The registry pairs the three artifacts by key, and a
 * second link here would be one that could drift.
 */
export const defineView = <TContract extends CapabilityContract<never>, TBody>(
  _contract: TContract,
  view: CapabilityView<TBody>,
): CapabilityView<TBody> => view;
