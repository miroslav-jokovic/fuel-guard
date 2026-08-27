import type { CardCapabilities } from "@silvicom/shared";
import { allowedInfoIdsFrom, allowedLimitsFrom } from "./promptDrafts";
import { typeToConfirmSatisfied } from "./TypeToConfirm.vue";
import type { CapabilityConfirmation } from "./capabilities/types";
import {
  type CardOperationSpec,
  type OperationCard,
  type OperationDraft,
  blockedSentence,
  operationBlockedBy,
} from "./cardOperations";

/**
 * Why Confirm is disabled, in words — invariant 6, out of the drawer so it can be read at a glance.
 *
 * Returns the SENTENCE, never a boolean. A disabled button whose tooltip says "invalid" tells an
 * operator to go and hunt; every branch here names either what to type or who to ask. Null means
 * ready.
 *
 * ── The ORDER is the design, not an accident of how it was written ──────────────────────────────
 * Permissions first, then the card's own state, then the operation's own inputs, and the typed
 * confirmation LAST. Each step is a thing the operator can do less about than the one after it:
 * naming an unfinished field in front of somebody who is not an approver would send them typing at a
 * button no amount of typing will enable.
 *
 * Extracted from `CardOperationDrawer.vue` in Step 8.1 — the file hit `lint:filesize`'s 500-line
 * budget — and it is a real seam: this is a pure function of the drawer's inputs, with no reactive
 * state, which is exactly why it can be tested without mounting anything.
 */
export interface BlockerInputs {
  operation: CardOperationSpec | null;
  draft: OperationDraft;
  card: OperationCard;
  capabilities: CardCapabilities;
  scopes: readonly string[];
  /** True when the operator has ticked the status the card is already at — a vendor call that changes nothing. */
  statusUnchanged: boolean;
  confirmation: CapabilityConfirmation | null;
  /** The four digits from the card's MASKED reference, or `""` when none could be recovered. */
  expectedLastFour: string;
  typed: string;
}

export function operationBlocker(input: BlockerInputs): string | null {
  const { operation, draft, card, capabilities, scopes } = input;
  if (!operation) return null;

  const blockedBy = operationBlockedBy(operation, capabilities, scopes, draft);
  if (blockedBy) return blockedSentence(blockedBy);
  // The account's set, not the hardcoded pair — `promptAdd` applies when the card LACKS an id this
  // account permits, and that is a per-account question since Step 9.1.
  if (!operation.applies(card, allowedInfoIdsFrom(capabilities))) {
    return "This card is not in a state where that applies.";
  }

  // Step 10.3: the same shape as `allowedInfoIdsFrom` above — the ACCOUNT's vocabulary, so the
  // diesel-pair rule can check whether this account even offers the partner code before demanding it.
  const blocker = operation.blocker?.(draft, card, allowedLimitsFrom(capabilities));
  if (blocker) return blocker;
  if (input.statusUnchanged) return "This card is already at that status.";

  /**
   * Step 8.1's typed last-four, on `card_deactivate` alone.
   *
   * `typeToConfirmSatisfied` is the SAME predicate `TypeToConfirm.vue` shows its own mismatch hint
   * from, so the button cannot enable while the field still displays an error — two copies of "has
   * the operator typed the right digits" is exactly how that pair drifts apart.
   */
  const typeToConfirm = input.confirmation?.typeToConfirm;
  if (typeToConfirm && !typeToConfirmSatisfied(input.expectedLastFour, input.typed)) {
    // Fail CLOSED on a reference with no recoverable last four. If we cannot say what the operator
    // should type, accepting whatever they type would make the gate decoration.
    return input.expectedLastFour === ""
      ? "This card's number is not available, so it cannot be deactivated here."
      : typeToConfirm.label;
  }
  return null;
}
