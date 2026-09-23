import { getCardV2 } from "../lib/efsCardOps.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { resolveOrgEditableInfoIds } from "../orchestrator/editableInfoIds.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import type { MountedCapability } from "../registry.js";

/**
 * Put a card back to where a proof found it, from the proof's own ledger row (docs/28 rule 14).
 *
 * ── Why this exists (2026-09-23, proof `efe2b98a`, ••••6122) ─────────────────────────────────────
 * The prompts proof's revert failed and left UNIT flipped. The only complete record of the card's
 * earlier state was `efs_card_mutations.before_document`, and the only way back was an owner
 * retyping it into the WEX portal. This replays that record through the same orchestrator, the same
 * capability and the same undo the proof itself would have used.
 *
 * ── What it restores, and from what ──────────────────────────────────────────────────────────────
 * The undo is the capability's own `proof.revert`, handed a snapshot whose card VIEW is the ledger's
 * `before_document` and whose document is a fresh read. Every `revert` reads only `snap.doc.card`
 * (checked for all six on 2026-09-23), and the write itself is built against the fresh document,
 * like any other write. So the fields that capability writes go back to their earlier values and
 * nothing else is touched. Deriving the undo from the capability rather than writing a second one
 * is the point: a restore that disagreed with the proof's own revert would be a third definition of
 * "back".
 *
 * ── The refusals, and what each one protects ────────────────────────────────────────────────────
 *  - Only a PROOF's write. An operator's change is undone with the opposite card action, through the
 *    promoted, audited path. This is cleanup for a proof, not a second write path.
 *  - Only the proof's APPLY row. Its revert row is also in the ledger under the same proof id, and
 *    "restoring" that would re-apply the change the proof was trying to take back.
 *  - Only while the card still reads exactly as that write left it (`after_version`). Anything else
 *    means someone has changed the card since, and a restore would overwrite them. The orchestrator
 *    repeats the check at plan time and again just before the write, so it holds to the last moment
 *    we control.
 *  - A card that already reads as it did before the write is reported as such, and nothing is sent.
 */

export interface RestoreRow {
  id: string;
  capabilityKey: string | null;
  proofRunId: string | null;
  /** The capability the proof was proving, from `efs_capability_proofs`. Null for no proof row. */
  proofCapabilityKey: string | null;
  beforeVersion: string | null;
  afterVersion: string | null;
  /** `before_document`: the parsed card view the ledger stored, not vendor XML. */
  beforeCard: CardDocument["card"] | null;
}

export interface RestoreOutcome {
  outcome: "restored" | "already_restored" | "refused" | "not_restored";
  detail: string;
  /** The restore write's own ledger status, when one was sent. */
  mutationStatus: string | null;
  /** Whether a fresh read after the write matches `before_version`. Null when nothing was sent. */
  matchesBefore: boolean | null;
}

const refused = (detail: string): RestoreOutcome =>
  ({ outcome: "refused", detail: `${detail} Nothing was sent.`, mutationStatus: null, matchesBefore: null });

const read = (ctx: CardMutationContext): Promise<CardDocument> =>
  getCardV2(ctx.env, ctx.creds, ctx.cardNumber, {
    priority: "interactive",
    timeoutMs: ctx.env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
    fetchImpl: ctx.fetchImpl,
    signal: ctx.signal,
  });

export async function restoreFromLedger(
  ctx: CardMutationContext,
  row: RestoreRow,
  capabilities: Readonly<Record<string, MountedCapability>>,
): Promise<RestoreOutcome> {
  if (!row.proofRunId) {
    return refused(
      "Only a capability proof's own write can be restored here. Undo an operator's change with the "
        + "opposite card action.",
    );
  }
  if (!row.capabilityKey || row.capabilityKey !== row.proofCapabilityKey) {
    return refused(
      "That row is not the proof's change. It is most likely the proof's revert, and restoring it would "
        + "put the proof's change back on the card. Restore the row whose capability is the one the proof was proving.",
    );
  }
  if (!row.beforeCard || !row.beforeVersion || !row.afterVersion) {
    return refused("The ledger row does not record the card both before and after the write, so there is no safe state to restore.");
  }
  const mounted = capabilities[row.capabilityKey];
  if (!mounted?.proof) return refused(`"${row.capabilityKey}" has no proof plan, so it has no defined undo.`);

  const current = await read(ctx);
  if (current.version === row.beforeVersion) {
    return {
      outcome: "already_restored",
      detail: "The card already reads exactly as it did before that write. Nothing was sent.",
      mutationStatus: null,
      matchesBefore: true,
    };
  }
  if (current.version !== row.afterVersion) {
    return refused(
      "The card has changed since that write: someone edited it, or a later write landed. A restore would "
        + "overwrite that change. Compare the card with the ledger row and put it right by hand.",
    );
  }

  const editsCtx = { editableInfoIds: await resolveOrgEditableInfoIds(ctx) };
  // The view is the ledger's; the document is today's. See "What it restores" above.
  const undo = mounted.proof.revert({ doc: { ...current, card: row.beforeCard } }, editsCtx);
  const target = capabilities[undo.capability];
  if (!target) return refused(`The undo names "${undo.capability}", which is not a mounted capability.`);
  const accepted = target.accept({ ...(undo.body as object), expectedVersion: current.version });
  if (!accepted.ok) {
    return refused(`The undo would be refused by ${undo.capability}: ${accepted.error.issues[0]?.message}.`);
  }

  const outcome = await accepted.run({ ...ctx, expectedVersion: current.version, proofRunId: row.proofRunId });
  let matchesBefore: boolean | null = null;
  try {
    matchesBefore = (await read(ctx)).version === row.beforeVersion;
  } catch {
    // Left null: the write's own verifying re-read already judged it, and "we could not look again"
    // is not "it does not match".
  }
  const restored = outcome.status === "succeeded" && matchesBefore === true;
  return {
    outcome: restored ? "restored" : "not_restored",
    detail: restored
      ? `Restored through ${undo.capability}. The card reads exactly as it did before the proof.`
      : `The restore through ${undo.capability} settled "${outcome.status}"`
        + (matchesBefore === false ? " and the card does not yet read as it did before the proof." : ".")
        + " Check the card in the WEX portal.",
    mutationStatus: outcome.status,
    matchesBefore,
  };
}
