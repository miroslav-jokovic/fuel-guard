import { CARD_CAPABILITY_CONTRACTS } from "@fuelguard/shared";
import { cardLockView } from "./cardLock.view.js";
import type { CapabilityView } from "./types.js";

/**
 * Every capability's VIEW, by key — the drawer's half of the registry (docs/27 §6.4).
 *
 * Nothing renders from this yet. The drawer still reads `cardControlModel.ts`'s five hand-written
 * confirmations; Phase 6 builds the shell that reads views, and Step 3.6 moves the remaining four
 * here first so that shell has something complete to read.
 *
 * What it does do today is give the cross-registry fitness test its third side: a contract with a
 * behaviour and no view is a capability the API will happily execute and the UI cannot describe, and
 * that asymmetry is invisible until somebody opens the drawer on a real card.
 *
 * Typed loosely for the same reason the shared index is: a map has one value type, so five views
 * with five body types cannot keep their inference here. Anything needing the body type imports the
 * view directly, where `defineView` pins it to the contract's own `z.infer`.
 */
export const CARD_CAPABILITY_VIEWS: Readonly<Record<string, CapabilityView<never>>> = {
  card_lock: cardLockView,
};

/** The keys the drawer can describe, in the order the shared registry declares them. */
export const CARD_CAPABILITY_VIEW_KEYS = Object.keys(CARD_CAPABILITY_CONTRACTS)
  .filter((key) => key in CARD_CAPABILITY_VIEWS);

export { cardLockView } from "./cardLock.view.js";
