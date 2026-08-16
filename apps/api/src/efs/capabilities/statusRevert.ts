import { EFS_LOCK_STATUSES, canonicalEfsStatus, efsStatusEquals } from "@fuelguard/shared";
import type { Snapshot } from "../types.js";

/**
 * How a status proof puts the card back — one definition, because both status capabilities need it
 * and both got it wrong the same way.
 *
 * ── The defect this exists to fix (found 2026-08-16, before Step 8.2 ran) ────────────────────────
 * `cardLockBehaviour.proof.revert` and `cardUnlockBehaviour.proof.revert` each built their body as
 * `{ status: snap.doc.card.status }` — the status EFS just reported, VERBATIM. This account reports
 * `INACTIVE` and `HOLD` upper-cased (incident 2026-08-12), and `lockCardSchema.status` is a
 * case-SENSITIVE `z.enum(["Hold", "Inactive"])`. So every such revert body was refused by the
 * capability's own schema at `prove.ts`'s `accept()` call, which throws — leaving OEG-5 false,
 * `cardStillChanged` true, and a QA card sitting at the proof's target status. That is standing
 * rule 14 broken by the harness that exists to honour it.
 *
 * It had not fired yet only because of the QA fleet's shape: 33 of 35 QA cards are ACTIVE, and an
 * Active card reverts through `card_unlock`, whose body carries no status at all. `card_lock` was
 * proved on such a card on 2026-08-15 (proof `40b88b75`) and passed. `card_unlock` has never been
 * proved — its precondition needs a NON-Active card, so Step 8.2's first run would have hit this on
 * one of QA's two INACTIVE cards.
 *
 * ── Why canonical and not the observed spelling ──────────────────────────────────────────────────
 * "Reads stay tolerant, writes stay literal" (`matchStatusCasing`'s header). The literal spelling is
 * applied at `buildEdits`, from the fresh read taken at write time — which is a BETTER source than
 * the status observed when the proof was planned, because the card may have moved in between. So the
 * revert body carries the documented spelling, the API boundary stays canonical, and the account's
 * own casing is borrowed once, at the point of the write, exactly as an operator's request is.
 *
 * `canonicalEfsStatus` rather than an incidental `toLowerCase()` chain: standing rule 4 allows a
 * named, tested adapter and nothing else, and this is the one that already exists for this job.
 */

/** What a proof plan hands the prover: the capability that undoes the write, and its body. */
export interface StatusRevert {
  capability: string;
  body: Record<string, unknown>;
}

/**
 * Can a card at this status be put back at all?
 *
 * `Fraud` and `Deleted` are real statuses EFS reports and NO capability may write either, so a proof
 * that starts from one can apply its change and then has no way home. Refusing in the precondition
 * makes that a `void` outcome — nothing written, nothing learned, nothing to restore by hand — rather
 * than a `denied` one with a card left changed and a ⚠ telling somebody to open the WEX portal.
 *
 * The check is on the REVERT, not on the apply, which is why it lives here beside the thing it
 * guards rather than being restated in each precondition.
 */
export const statusIsRevertible = (observed: string | null): boolean =>
  efsStatusEquals(observed, "Active")
  || efsStatusEquals(observed, "Inactive")
  || EFS_LOCK_STATUSES.some((s) => efsStatusEquals(s, observed));

/**
 * The capability that restores `observed`, with a body its own schema accepts.
 *
 * Never assume `Active`: a card proved from INACTIVE must go back to INACTIVE. Since Phase 8.1 each
 * of the three statuses has exactly one capability that writes it, so this is a three-way routing
 * and not a capability-plus-status — two of the three carry no status field at all, which is what
 * makes the P0-3 separation structural rather than validated.
 *
 * | observed   | restored by       | body            |
 * |------------|-------------------|-----------------|
 * | `Active`   | `card_unlock`     | no status field |
 * | `Inactive` | `card_deactivate` | no status field |
 * | `Hold`     | `card_lock`       | `status: Hold`  |
 *
 * Anything else is refused upstream by `statusIsRevertible`, so the fallthrough is not a guess about
 * an unknown status — it is the one remaining case.
 */
export const statusRevert = (snap: Snapshot): StatusRevert => {
  const observed = snap.doc?.card.status ?? null;
  if (efsStatusEquals(observed, "Active")) return { capability: "card_unlock", body: {} };
  if (efsStatusEquals(observed, "Inactive")) return { capability: "card_deactivate", body: {} };
  return {
    capability: "card_lock",
    // Falls back to the documented `Hold` when the read gave us nothing to canonicalise. `Hold` is
    // now the only status `card_lock` may write, so it is the sole body this branch can produce —
    // and the reversible one, which is the right way to fail on a card we could not read.
    body: { status: canonicalEfsStatus(observed) ?? "Hold" },
  };
};
