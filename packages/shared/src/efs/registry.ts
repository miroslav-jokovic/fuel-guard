import type { z } from "zod";
import { cardLockContract } from "./capabilities/cardLock.contract.js";
import { cardUnlockContract } from "./capabilities/cardUnlock.contract.js";
import { overrideGrantContract } from "./capabilities/overrideGrant.contract.js";
import { deleteOverrideContract, overrideClearContract } from "./capabilities/overrideClear.contract.js";
import { promptsSetContract } from "./capabilities/promptsSet.contract.js";
import type { CapabilityContract } from "./types.js";

/**
 * Every card capability's CONTRACT, by key. The browser-safe half of the registry.
 *
 * One entry today. The point of the index is not the list — it is that the API's router, the
 * limiter fitness test, the promotion key set and the drawer's operation list now iterate ONE
 * declaration instead of each keeping their own copy (docs/27 §6.4).
 *
 * Step 3.6 fills it — `card_unlock` is in — and 3.7 deletes `CardMutationIntentSpec` and the
 * hand-written handlers once `override_grant`, `override_clear` and `prompts_set` follow.
 *
 * Two entries may share an `intent` — `override_clear` has two mechanisms — but each `key` is
 * unique, and `mountedCapabilities(env)` decides which of a pair is actually served.
 *
 * ── Why the values are typed loosely and the individual exports are not ──────────────────────────
 * A map has one value type, so putting five contracts in it erases each one's `z.infer`. Anything
 * that needs the BODY type imports the contract directly — `cardLockContract` keeps its schema's
 * inference, and `defineContract` exists to pin it. This map is for the consumers that iterate:
 * they read `key`, `route`, `writeBucket`, `scope` and `ui`, none of which depend on the body.
 */
export const CARD_CAPABILITY_CONTRACTS: Readonly<Record<string, CapabilityContract<z.ZodTypeAny>>> = {
  [cardLockContract.key]: cardLockContract,
  [cardUnlockContract.key]: cardUnlockContract,
  [overrideGrantContract.key]: overrideGrantContract,
  [overrideClearContract.key]: overrideClearContract,
  [deleteOverrideContract.key]: deleteOverrideContract,
  [promptsSetContract.key]: promptsSetContract,
};

/** The keys, for anything that needs the set rather than the declarations. */
export const CARD_CAPABILITY_KEYS = Object.keys(CARD_CAPABILITY_CONTRACTS);

export { cardLockContract } from "./capabilities/cardLock.contract.js";
export type { CardLockBody } from "./capabilities/cardLock.contract.js";
export { cardUnlockContract } from "./capabilities/cardUnlock.contract.js";
export type { CardUnlockBody } from "./capabilities/cardUnlock.contract.js";
export { overrideGrantContract, overrideStepUpMessage } from "./capabilities/overrideGrant.contract.js";
export type { OverrideGrantBody } from "./capabilities/overrideGrant.contract.js";
export { deleteOverrideContract, overrideClearContract } from "./capabilities/overrideClear.contract.js";
export type { OverrideClearBody } from "./capabilities/overrideClear.contract.js";
export { promptsSetContract } from "./capabilities/promptsSet.contract.js";
export type { PromptsSetBody } from "./capabilities/promptsSet.contract.js";
