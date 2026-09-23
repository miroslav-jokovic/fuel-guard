import type { CardDocument } from "../lib/efsCardXml.js";
import { EfsSoapError } from "../lib/efsSoapSession.js";
import { CardControlError } from "../services/efsCardControlErrors.js";

/**
 * Put a proof's card back, trying more than once when that is safe (OEG-5).
 *
 * ── Why this exists (2026-09-23, proof `efe2b98a`, ••••6122) ─────────────────────────────────────
 * The prompts_set proof flipped UNIT from EXACT_MATCH "669" to REPORT_ONLY. The flip landed. The
 * revert then made one attempt, and that attempt's first read timed out at 10 s. It failed before
 * anything was sent, and the harness stopped there, leaving the card changed. A read is safe to
 * repeat, and docs/28 standing rule 14 says never leave a QA card dirty. So one failed read must not
 * be the end.
 *
 * ── Why a retry cannot write twice, or over someone else ───────────────────────────────────────
 * The retry is NOT fenced by `assertNoneInFlight`: a proof run's own ledger rows are exempt from
 * it, by design (the 2026-08-18 incident). What fences it instead is the version. `CardDocument.version`
 * is a hash of the card's whole configuration, and `planCardMutation` refuses with
 * `card_state_changed` unless the card is exactly at `expectedVersion`. Every attempt is sent expecting
 * `changedVersion`, the state the apply left behind. So:
 *
 *   card still at the changed state            → the revert is sent (again)
 *   card back at the before-state              → an earlier attempt landed; nothing is sent; done
 *   card at any THIRD state                    → someone else changed it mid-proof; nothing is sent
 *                                                and we stop, because the revert would overwrite them
 *
 * That holds even for a revert whose write went out and whose outcome was `sent` or `failed`: the
 * next attempt's plan read settles it, and the version decides.
 *
 * ── What stops the loop at once ──────────────────────────────────────────────────────────────────
 * A refusal that is a DECISION rather than a fault: another operator's write in flight, a governance
 * refusal, anything that is not an `EfsSoapError`. Retrying those would just ask the same question
 * again three seconds later, and one of them (`mutation_in_flight`) exists to make us wait for a human.
 */

export const REVERT_ATTEMPTS = 3;
/** Long enough for a slow vendor spell to pass, short enough that the operator is still waiting. */
export const REVERT_RETRY_PAUSE_MS = 3_000;

export interface RevertIo {
  /** Dispatch the revert through the orchestrator, expecting the card to be exactly `from`. */
  send: (from: CardDocument) => Promise<{ status: string }>;
  /** A fresh read of the card. */
  read: () => Promise<CardDocument>;
  pause: (ms: number) => Promise<void>;
}

export interface RevertResult {
  landed: boolean;
  /** One line per attempt that did not settle it, in order. Goes into the proof's detail verbatim. */
  notes: string[];
}

export async function revertProof(
  before: CardDocument,
  afterApply: CardDocument | null,
  io: RevertIo,
  pauseMs: number = REVERT_RETRY_PAUSE_MS,
): Promise<RevertResult> {
  const notes: string[] = [];
  /**
   * The state the revert is allowed to write over. Known from OEG-4's read when that read worked.
   * When it did not, the first read here stands in for it. That is the same assumption the old
   * single attempt made, one read later: that nobody else wrote to the card within the proof.
   */
  let changedVersion = afterApply?.version ?? null;
  let from = afterApply;

  for (let attempt = 1; attempt <= REVERT_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await io.pause(pauseMs);
    const note = (text: string) => notes.push(`revert attempt ${attempt}: ${text}`);

    if (!from) {
      try {
        from = await io.read();
      } catch (error) {
        note(`could not read the card: ${String(error)}`);
        continue;
      }
      changedVersion ??= from.version;
    }
    if (from.version === before.version) return { landed: true, notes };
    if (from.version !== changedVersion) {
      note("the card changed in EFS during the proof, so the revert was not sent over that change");
      return { landed: false, notes };
    }

    try {
      const out = await io.send(from);
      if (out.status === "succeeded") return { landed: true, notes };
      note(`revert → ${out.status}`);
      // The write may have gone out. Read before deciding anything else, and let the version answer.
      from = null;
    } catch (error) {
      if (error instanceof CardControlError && error.code === "card_state_changed") {
        if (error.detail?.currentVersion === before.version) return { landed: true, notes };
        note("the card changed in EFS during the proof, so the revert was not sent over that change");
        return { landed: false, notes };
      }
      note(`revert threw: ${String(error)}`);
      if (!(error instanceof EfsSoapError)) return { landed: false, notes };
      // An EfsSoapError that reaches here was thrown before the ledger row opened, so nothing was
      // sent (`applyCardMutation` holds every vendor error after that point and returns a status).
      // `from` stays: the next attempt's plan read checks it against the card anyway.
    }
  }
  return { landed: false, notes };
}
