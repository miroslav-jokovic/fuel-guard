import { deleteOverrideContract, overrideClearContract } from "@silvicom/shared";
import { defineView, row } from "./types.js";

/**
 * Cancelling an exception. One set of words for both mechanisms, deliberately.
 *
 * Whether the write goes out as a full-document echo or the vendor's dedicated op is an
 * implementation detail of ours — the operator is removing an exception either way, and a
 * confirmation that changed wording when a flag flipped would be describing our plumbing rather than
 * their decision. Prose lifted word for word from `clearOverrideConfirmation`, deleted in Step 6.4.
 */
const clearView = {
  confirmation: () => ({
    tone: "warning" as const,
    title: "Remove the exception?",
    body: "The card goes back to its normal limits immediately. Any unused exceptions are cancelled.",
    confirmLabel: "Remove exception",
    busyLabel: "Removing…",
    doneLabel: "Exception removed",
  }),
  diff: (before: { overrideUses: number | null }) => [
    row("Exception", usesLabel(before.overrideUses ?? 0), "None"),
  ],
};

const usesLabel = (uses: number): string =>
  uses === 0 ? "None" : uses === 1 ? "1 purchase" : `${uses} purchases`;

export const overrideClearView = defineView(overrideClearContract, clearView);
export const deleteOverrideView = defineView(deleteOverrideContract, clearView);
