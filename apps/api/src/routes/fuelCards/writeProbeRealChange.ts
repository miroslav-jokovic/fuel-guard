import { efsStatusEquals, matchStatusCasing } from "@fuelguard/shared";
import type { Env } from "../../env.js";
import { getCardV2 } from "../../lib/efsCardOps.js";
import { setCardV2 } from "../../lib/efsCardWrite.js";
import { EfsSoapError } from "../../lib/efsSoapSession.js";
import { redactCardXml, type CardDocument } from "../../lib/efsCardXml.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";

/**
 * Steps 7–10 of the write probe: prove EFS APPLIES an edit, not merely that it tolerates an echo.
 *
 * The original six proofs establish that our echo is faithful and that a no-op write changes
 * nothing. They never establish that a real edit takes effect — and the first live mutation
 * (2026-08-12, card ••••7671) failed on exactly that gap: setCardv2 returned its void success and
 * the card stayed Active. `write_entitlement = confirmed` now requires this half too (audit P0-1).
 *
 *   7. apply  — one real, reversible edit: `status → realChangeStatus` (default Hold), spelled in
 *               the account's own casing per H1 (`matchStatusCasing`).
 *   8. verify — re-read at 0s/+3s/+8s until the edit lands; the FIRST landing timestamp is the
 *               measured APPLY LATENCY, which calibrates EFS_CARD_VERIFY_RETRY_MS (audit P0-2).
 *   9. revert — write the card's ORIGINAL status back, verbatim as EFS reported it.
 *  10. verify — same re-read schedule for the revert.
 *
 * A failure in 9/10 leaves the card in the changed state: the step text says so explicitly and
 * names the WEX portal as the restore path, because a probe that can strand a card silently is
 * worse than no probe. Everything here shares production's own write path (`setCardV2`,
 * retry:false, echo guard inside) — proving anything else would prove nothing.
 */

export interface ProbeStep {
  step: number;
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  errorCode?: string;
  error?: string;
}

export async function runStep(step: number, name: string, run: () => Promise<string | undefined>): Promise<ProbeStep> {
  const started = Date.now();
  try {
    const detail = await run();
    return { step, name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) };
  } catch (error) {
    const efs = error instanceof EfsSoapError ? error : null;
    return {
      step, name, ok: false, ms: Date.now() - started,
      errorCode: efs?.code ?? "unknown",
      // Redacted unconditionally: a refusal usually quotes the card number back at us.
      error: redactCardXml(error instanceof Error ? error.message : String(error)).slice(0, 300),
    };
  }
}

/** Re-read schedule, ms after the previous read. Mirrors the Phase 0 experiment endpoint so a
 *  lagged apply is measured, not misread as "not applied". */
const VERIFY_DELAYS_MS = [0, 3_000, 5_000] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RealChangeResult {
  steps: ProbeStep[];
  /** ms from the apply write's completion to the first re-read that saw it landed. Null = never. */
  applyLatencyMs: number | null;
  revertLatencyMs: number | null;
  /** The document as the last successful read left it — the base for anything that follows. */
  finalDoc: CardDocument | null;
}

async function writeAndVerify(
  env: Env,
  creds: EfsSoapCredentials,
  cardNumber: string,
  base: CardDocument,
  statusValue: string,
  stepNumbers: [number, number],
  stepLabel: string,
): Promise<{ writeStep: ProbeStep; verifyStep: ProbeStep; latencyMs: number | null; doc: CardDocument | null }> {
  let latencyMs: number | null = null;
  let doc: CardDocument | null = null;

  const writeStep = await runStep(stepNumbers[0], `setCardV2 — ${stepLabel}`, async () => {
    const result = await setCardV2(env, creds, base, cardNumber, [
      { op: "setField", name: "status", value: statusValue },
    ], { priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS });
    return `shape=${result.shape} result=${result.resultText ?? "(empty)"}`;
  });
  if (!writeStep.ok) {
    return { writeStep, verifyStep: { step: stepNumbers[1], name: `getCardv2 — verify ${stepLabel}`, ok: false, ms: 0, error: "skipped: the write step failed" }, latencyMs, doc };
  }

  const verifyStarted = Date.now();
  const verifyStep = await runStep(stepNumbers[1], `getCardv2 — verify ${stepLabel}`, async () => {
    const seen: string[] = [];
    for (const delay of VERIFY_DELAYS_MS) {
      if (delay > 0) await sleep(delay);
      const read = await getCardV2(env, creds, cardNumber, {
        priority: "interactive", timeoutMs: env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
      });
      doc = read;
      seen.push(read.card.status ?? "(null)");
      if (efsStatusEquals(read.card.status, statusValue)) {
        latencyMs = Date.now() - verifyStarted;
        return `landed as "${read.card.status}" after ${latencyMs}ms`;
      }
    }
    // THE finding this half exists to catch: EFS accepted the write and did not apply it. The step
    // fails loudly with what each look saw, so the verdict can say "no_change" with evidence.
    throw new Error(
      `the ${stepLabel} write was accepted but never landed — status read as [${seen.join(", ")}] across ${VERIFY_DELAYS_MS.length} looks. This is the live no_change failure; do not enable writes.`,
    );
  });
  return { writeStep, verifyStep, latencyMs, doc };
}

/**
 * Run the real-change half against the disposable card. `base` is the document the no-op half left
 * behind (step 6's re-read) so the echo is built from the freshest possible read.
 */
export async function runRealChangeSteps(
  env: Env,
  creds: EfsSoapCredentials,
  cardNumber: string,
  base: CardDocument,
  realChangeStatus: string,
): Promise<RealChangeResult> {
  const steps: ProbeStep[] = [];
  const originalStatus = base.card.status;

  if (originalStatus === null || efsStatusEquals(originalStatus, realChangeStatus)) {
    steps.push({
      step: 7, name: "setCardV2 — real change", ok: false, ms: 0,
      error: `the card already reads "${originalStatus ?? "(null)"}" — a change to "${realChangeStatus}" would prove nothing. Re-run with the other target status.`,
    });
    return { steps, applyLatencyMs: null, revertLatencyMs: null, finalDoc: base };
  }

  // The forward write is spelled in the account's own casing (H1): a target cased differently from
  // the account's vocabulary is answered with void success and silently not applied — which would
  // read here as "accepted but never landed" and fail the probe against a healthy account.
  const applyStatus = matchStatusCasing(originalStatus, realChangeStatus);

  const apply = await writeAndVerify(env, creds, cardNumber, base, applyStatus, [7, 8], "real change");
  steps.push(apply.writeStep, apply.verifyStep);
  const afterApply = apply.doc ?? base;
  if (!apply.writeStep.ok || !apply.verifyStep.ok) {
    // No revert attempt when the apply provably did not land — there is nothing to revert, and a
    // write on top of an unexplained state is how probe runs turn into incidents.
    return { steps, applyLatencyMs: apply.latencyMs, revertLatencyMs: null, finalDoc: afterApply };
  }

  // Revert to the ORIGINAL status, byte-for-byte as this account reported it — which also exercises
  // the account's own casing on the write path, a Phase 0 hypothesis in itself.
  const revert = await writeAndVerify(env, creds, cardNumber, afterApply, originalStatus, [9, 10], "revert");
  steps.push(revert.writeStep, revert.verifyStep);
  if (!revert.writeStep.ok || !revert.verifyStep.ok) {
    const last = steps[steps.length - 1]!;
    last.error = `${last.error ?? ""} ⚠ THE CARD IS STILL "${applyStatus}" — restore it to "${originalStatus}" in the WEX portal before anything else.`.trim();
  }
  return { steps, applyLatencyMs: apply.latencyMs, revertLatencyMs: revert.latencyMs, finalDoc: revert.doc ?? afterApply };
}
