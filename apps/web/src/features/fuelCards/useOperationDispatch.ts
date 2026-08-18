import type { OverrideLimit, PromptInput } from "@fuelguard/shared";
import type { CardOperationId } from "./cardOperations";
import {
  useClearOverride,
  useDeactivateCard,
  useGrantOverride,
  useLockCard,
  useSetPrompts,
  useUnlockCard,
  type CardMutationOutcome,
} from "./useCardControl";

/**
 * Which endpoint a settled operation actually calls — the drawer's last step, on its own.
 *
 * Extracted from `CardOperationDrawer.vue` in Step 8.1, when adding `card_deactivate` pushed that
 * file to 538 lines against `lint:filesize`'s 500-line budget. The seam is a real one rather than a
 * convenient one: everything left in the drawer is about STATE — what is frozen, what is dirty, what
 * is on screen — and this is the one part that is about the network. It has no reactive state of its
 * own and returns a plain function.
 *
 * ── Why it takes a capability key and not just the body ─────────────────────────────────────────
 * The `status` operation spans three capabilities, and since Step 8.1 two of them send an EMPTY body:
 * `card_unlock` and `card_deactivate` each write exactly one status and carry none. So the request
 * genuinely cannot be recovered from the body — `b.status === undefined` used to mean "unlock" and
 * now means "unlock or deactivate". The key is the frozen one the operator confirmed against
 * (invariant 1), which is also why it is a parameter here and not something this re-derives from a
 * live draft it cannot see.
 */

export interface DispatchArgs {
  cardId: string;
  expectedVersion: string;
  idempotencyKey: string;
}

export function useOperationDispatch() {
  const lock = useLockCard();
  const unlock = useUnlockCard();
  const deactivate = useDeactivateCard();
  const grant = useGrantOverride();
  const clear = useClearOverride();
  const setPrompts = useSetPrompts();

  return function dispatch(
    operationId: CardOperationId,
    capabilityKey: string,
    body: Record<string, unknown>,
    common: DispatchArgs,
  ): Promise<CardMutationOutcome> {
    switch (operationId) {
      /**
       * Routed by the frozen CAPABILITY, never by the operation and never by the body: `card_unlock`
       * is the only path to Active and `card_deactivate` the only path to Inactive (audit P0-3).
       * Routing Active through the lock endpoint let a lock-only approver reactivate a Fraud-held
       * card while the audit row said `card.locked`; routing Inactive through it recorded a
       * retirement as a lock, which is the same finding's other half.
       */
      case "status":
        switch (capabilityKey) {
          case "card_unlock": return unlock.mutateAsync(common);
          case "card_deactivate": return deactivate.mutateAsync(common);
          default:
            return lock.mutateAsync({
              ...common,
              status: body.status as "Hold",
              // H16's Option B. Dropped here until 2026-08-17, which made the checkbox and its
              // confirmation clause promise something the request never asked for.
              clearException: body.clearException === true,
            });
        }
      case "grant":
        return grant.mutateAsync({
          ...common,
          uses: body.uses as number,
          scope: body.scope as never,
          limits: (body.limits ?? []) as OverrideLimit[],
        });
      case "clear":
        return clear.mutateAsync(common);
      /**
       * All three prompt actions dispatch through ONE capability, and that is deliberate.
       *
       * `replaceAll` means the array IS the card's prompts afterwards (guide p137), so an add, an
       * edit and a removal are the same `prompts_set` call with a different array. Step 9.6 split
       * the operator's DECISION into three, not the wire into three — the opposite of the `status`
       * case above, where three statuses genuinely are two capabilities with two approver scopes.
       */
      case "promptAdd":
      case "prompts":
      case "promptRemove":
        return setPrompts.mutateAsync({
          ...common,
          prompts: body.prompts as PromptInput[],
          allowRemoveDriverId: body.allowRemoveDriverId as boolean,
        });
    }
  };
}
