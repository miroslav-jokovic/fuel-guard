import type { z } from "zod";
import { cardLockContract } from "./capabilities/cardLock.contract.js";
import type { CapabilityContract } from "./types.js";

/**
 * Every card capability's CONTRACT, by key. The browser-safe half of the registry.
 *
 * One entry today. The point of the index is not the list — it is that the API's router, the
 * limiter fitness test, the promotion key set and the drawer's operation list now iterate ONE
 * declaration instead of each keeping their own copy (docs/27 §6.4).
 *
 * Steps 3.6 and 3.7 fill it: `card_unlock`, `override_grant`, `override_clear`, `prompts_set`, and
 * then `CardMutationIntentSpec` and the hand-written handlers are deleted.
 *
 * ── Why the values are typed loosely and the individual exports are not ──────────────────────────
 * A map has one value type, so putting five contracts in it erases each one's `z.infer`. Anything
 * that needs the BODY type imports the contract directly — `cardLockContract` keeps its schema's
 * inference, and `defineContract` exists to pin it. This map is for the consumers that iterate:
 * they read `key`, `route`, `writeBucket`, `scope` and `ui`, none of which depend on the body.
 */
export const CARD_CAPABILITY_CONTRACTS: Readonly<Record<string, CapabilityContract<z.ZodTypeAny>>> = {
  [cardLockContract.key]: cardLockContract,
};

/** The keys, for anything that needs the set rather than the declarations. */
export const CARD_CAPABILITY_KEYS = Object.keys(CARD_CAPABILITY_CONTRACTS);

export { cardLockContract } from "./capabilities/cardLock.contract.js";
export type { CardLockBody } from "./capabilities/cardLock.contract.js";
