import type { z } from "zod";
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
 * `CardOperationDrawer.vue` renders from these (Step 6.1). `cardControlModel.ts` no longer holds any
 * confirmation copy.
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
  /**
   * Turn an EFS location id into what a person calls that place — "Loves station 442, Effingham IL".
   *
   * A resolver rather than a field because the drawer holds the locations list and a view must not
   * fetch. Returns null when the id is not in that list, and the caller falls back to the id: an
   * override confirmation that cannot name the station must still name the number, because the
   * number is what the driver will be declined at.
   */
  locationLabel?: (locationId: string) => string | null;
}

export interface CapabilityView<TBody> {
  confirmation: (body: TBody, card: CapabilityCardContext) => CapabilityConfirmation;
  /** Rendered above the confirm button. Empty is legitimate — a lock changes one field. */
  diff: (before: CapabilityCardContext["card"], body: TBody) => CapabilityDiffRow[];
  /**
   * The sentence warning that this request will ask for a password, or null (Step 6.1, invariant 5).
   *
   * Every implementation MUST delegate to `@fuelguard/shared`'s `efs/stepUp.ts`, never restate the
   * rule: the API's gates read the same predicates, and a second copy of a security threshold fails
   * silently — the drawer promises no password, the server asks for one. The registry's fitness test
   * asserts that every capability whose API behaviour declares a gate has a view that predicts it.
   *
   * Absent means "this capability has no step-up gate", which is a claim: `card_lock` is the 2am
   * safety action and deliberately has none.
   *
   * A prediction, not a guarantee. Two of the three gates decide against the document EFS returns at
   * write time and this only has the mirror, so the drawer must still handle a `step_up_required`
   * refusal it did not foresee. `efs/stepUp.ts` has the table of which is which.
   */
  stepUp?: (body: TBody, card: CapabilityCardContext) => string | null;
}

/**
 * Bind a view to its contract so the body type flows from the same z.infer the behaviour uses.
 *
 * Inference only; the contract is not stored. The registry pairs the three artifacts by key, and a
 * second link here would be one that could drift.
 *
 * Corrected in Step 3.5 alongside `defineBehaviour`, which had the same two faults: a
 * `CapabilityContract<never>` bound that no real contract satisfies, and a free `TBody` the contract
 * could not constrain. Deriving `z.infer<TSchema>` is what makes docs/27 §7.3's claim — one body type
 * across all three artifacts — actually hold.
 */
export const defineView = <TSchema extends z.ZodTypeAny>(
  _contract: CapabilityContract<TSchema>,
  view: CapabilityView<z.infer<TSchema>>,
): CapabilityView<z.infer<TSchema>> => view;
