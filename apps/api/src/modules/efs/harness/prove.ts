import { CARD_CAPABILITY_CONTRACTS } from "@silvicom/shared";
import { getCardV2 } from "../lib/efsCardOps.js";
import { documentShape, type CardDocument } from "../lib/efsCardXml.js";
import { resolveOrgEditableInfoIds } from "../orchestrator/editableInfoIds.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import type { EditsCtx } from "../types.js";
import type { MountedCapability } from "../registry.js";
import { observeField, judgeField } from "./configScan.js";

/**
 * Prove one capability against one real card, then put the card back (Step 4.5).
 *
 * ── Everything runs through production's own path ───────────────────────────────────────────────
 * The apply and the revert are `executeCapability` calls — the same orchestrator, the same echo
 * guard, the same verifying re-read, the same ledger. A harness with its own dispatch would be
 * proving a second implementation, and the one that drifts is the one nobody runs. What is proved
 * here is what a person pressing the button gets.
 *
 * ── The OEG (docs/24 §3.2), and what each gate can actually say ─────────────────────────────────
 * **OEG-1 entitled** — the account may call the operations. Evidenced negatively: any vendor
 *   refusal of the `not_allowed` family fails it, everything else leaves it true.
 * **OEG-2b no-op stable** — a dispatch that changes nothing must not move `cardVersion`. QA ONLY,
 *   because it requires a write; a production promotion carries its absence as a named risk.
 * **OEG-3 change landed** — the sample body applied and was seen on re-read. **Void unless the
 *   before-state differs from the target**: a proof starting in the target state reports success for
 *   a write the vendor silently ignored, which is the H1 failure exactly.
 * **OEG-4 vocabulary** — every `vocabularyField` came back spelled the way we sent it, judged on RAW
 *   wire text by the Step 4.4 scanner rather than by a second comparison written here.
 * **OEG-5 revert landed** — the card is back, proven by re-read, through whichever capability undoes
 *   this one (usually not this one — see `ProofPlan.revert`).
 *
 * ── It never promotes ───────────────────────────────────────────────────────────────────────────
 * The harness moves a promotion to `proving`, then `proven` or `denied`. It cannot write `enabled`;
 * only a person through Step 4.6 can. Evidence that could promote itself is not evidence.
 */

export interface ProofOutcome {
  proofId: string;
  outcome: "proven" | "denied" | "void" | "error";
  detail: string | null;
  oeg1Entitled: boolean | null;
  oeg2bNoopStable: boolean | null;
  oeg3ChangeLanded: boolean | null;
  oeg4Vocabulary: boolean | null;
  oeg5RevertLanded: boolean | null;
  applyLatencyMs: number | null;
  vocabulary: Record<string, string[]>;
  documentShape: string | null;
  cardStillChanged: boolean;
}

/** Vendor fault codes that mean "this account may not do that", as opposed to "that did not work". */
const NOT_ENTITLED = new Set(["not_allowed", "auth", "endpoint_changed"]);

const read = (ctx: CardMutationContext): Promise<CardDocument> =>
  getCardV2(ctx.env, ctx.creds, ctx.cardNumber, {
    priority: "interactive",
    timeoutMs: ctx.env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
    // Threaded explicitly. The orchestrator carries `fetchImpl` on its own context, so a read taken
    // OUTSIDE it — as these OEG reads are — silently uses the global fetch unless it is passed here.
    fetchImpl: ctx.fetchImpl,
    signal: ctx.signal,
  });

/**
 * Run one capability body through the real orchestrator, with the version taken from a fresh read.
 *
 * The proof plan's bodies carry `expectedVersion: ""` because a plan cannot know it — the harness
 * fills it here, from the document it just read, so the optimistic-concurrency check is exercised
 * rather than bypassed.
 */
async function dispatch(
  ctx: CardMutationContext,
  capabilityKey: string,
  body: unknown,
  doc: CardDocument,
  capabilities: Readonly<Record<string, MountedCapability>>,
): Promise<{ status: string; faultCode: string | null; faultMessage: string | null; applyLatencyMs: number | null }> {
  const capability = capabilities[capabilityKey];
  // Refused rather than skipped: a revert whose capability cannot be resolved leaves a QA card
  // changed, and reporting OEG-5 as merely "false" would lose why.
  if (!capability) throw new Error(`proof: no capability named "${capabilityKey}"`);

  // PARSED by the capability's own `accept`, never cast. A revert body belongs to ANOTHER
  // capability's schema, so its contract is the only thing that may vouch for it — and `accept`
  // is the same entry point the router uses, so a proof exercises the real validation too.
  const accepted = capability.accept({ ...(body as object), expectedVersion: doc.version });
  if (!accepted.ok) {
    throw new Error(`proof: ${capabilityKey} refused its own proof body: ${accepted.error.issues[0]?.message}`);
  }

  const outcome = await accepted.run({ ...ctx, expectedVersion: doc.version });
  // `applyLatencyMs` is carried out of the orchestrator rather than timed here (Step 4.7) — only
  // `verifyStep` knows which re-read saw the change.
  return {
    status: outcome.status,
    faultCode: outcome.faultCode,
    faultMessage: outcome.faultMessage,
    applyLatencyMs: outcome.applyLatencyMs ?? null,
  };
}

/**
 * OEG-4, judged on raw wire text by the Step 4.4 scanner.
 *
 * Reusing `observeField`/`judgeField` rather than comparing here is the point: a second vocabulary
 * comparison would be a second definition of "the account spells it this way", and the H1 incident
 * is what happens when two such definitions disagree. `casingAdaptive` is honoured for the same
 * reason it is honoured in the scan — a field spelled from the account's own fresh read cannot
 * mis-spell itself.
 */
function judgeVocabulary(
  after: CardDocument,
  contractKey: string,
): { ok: boolean; observed: Record<string, string[]> } {
  const contract = CARD_CAPABILITY_CONTRACTS[contractKey];
  const observed: Record<string, string[]> = {};
  if (!contract || contract.vocabularyFields.length === 0) return { ok: true, observed };

  let ok = true;
  for (const field of contract.vocabularyFields) {
    const observation = observeField([after.root], field);
    observed[field] = observation.rawSpellings;
    const verdict = judgeField(
      contractKey, field, contract.emittableValues[field] ?? [], observation,
      contract.casingAdaptiveFields?.includes(field) ?? false,
    );
    // `unobserved` on a SINGLE card is not a finding — one card cannot carry every emittable value.
    // Only an outright mis-spelling fails OEG-4, which is the H1 signature and the thing this gate
    // was written for.
    if (verdict.state === "mismatch") ok = false;
  }
  return { ok, observed };
}

export interface ProveDeps {
  /** The capability registry, injected so a test can prove one without standing up the whole app. */
  capabilities: Readonly<Record<string, MountedCapability>>;
  /** Opens the `efs_capability_proofs` row and returns its id. */
  openProof: (capabilityKey: string) => Promise<string>;
  settleProof: (proofId: string, result: ProofOutcome) => Promise<void>;
  setPromotionState: (capabilityKey: string, state: "proving" | "proven" | "denied", proofId: string) => Promise<void>;
}

/** A run that never reached the vendor still has to settle its row, or it stays `running` forever. */
const voided = (proofId: string, detail: string, outcome: ProofOutcome["outcome"] = "void"): ProofOutcome => ({
  proofId, outcome, detail,
  oeg1Entitled: null, oeg2bNoopStable: null, oeg3ChangeLanded: null,
  oeg4Vocabulary: null, oeg5RevertLanded: null,
  applyLatencyMs: null, vocabulary: {}, documentShape: null, cardStillChanged: false,
});

export async function proveCapability(
  baseCtx: CardMutationContext,
  capabilityKey: string,
  deps: ProveDeps,
): Promise<ProofOutcome> {
  const plan = deps.capabilities[capabilityKey]?.proof;
  if (!plan) {
    throw new Error(`proof: "${capabilityKey}" has no proof plan, so it cannot be proven or promoted`);
  }
  const proofId = await deps.openProof(capabilityKey);
  await deps.setPromotionState(capabilityKey, "proving", proofId);
  // Every write below is attributable to this proof and exempt from the org cap because of it.
  const ctx: CardMutationContext = { ...baseCtx, proofRunId: proofId };

  const settle = async (result: ProofOutcome): Promise<ProofOutcome> => {
    await deps.settleProof(proofId, result);
    if (result.outcome === "proven" || result.outcome === "denied") {
      await deps.setPromotionState(capabilityKey, result.outcome, proofId);
    }
    return result;
  };

  let before: CardDocument;
  try {
    before = await read(ctx);
  } catch (error) {
    return await settle(voided(proofId, `the planning read failed: ${String(error)}`, "error"));
  }

  const snap = { doc: before };
  /**
   * The same resolved set the write path uses, from the same lookup (Step 9.1).
   *
   * Resolved ONCE and reused by all three hooks: `precondition`, `sample` and `revert` must agree
   * about which prompts exist, or OEG-3 can void on a set the sample never had and OEG-5 can put
   * back records the proof never touched.
   */
  const editsCtx: EditsCtx = { editableInfoIds: await resolveOrgEditableInfoIds(ctx) };
  // OEG-3's precondition, and the reason it comes before any write: a proof that starts in the
  // target state dispatches, re-reads, sees the target value and reports success — for a write the
  // vendor may have ignored entirely. Void, not failed: nothing was learned either way.
  if (!plan.precondition(snap, editsCtx)) {
    return await settle(voided(
      proofId,
      "the card is already in the state this capability would write, so the run would prove nothing. "
        + "Re-run against a card in a different starting state.",
    ));
  }

  const result: ProofOutcome = {
    proofId, outcome: "denied", detail: null,
    oeg1Entitled: true, oeg2bNoopStable: null, oeg3ChangeLanded: null,
    oeg4Vocabulary: null, oeg5RevertLanded: null, applyLatencyMs: null,
    vocabulary: {}, documentShape: documentShape(before), cardStillChanged: false,
  };

  // ── OEG-3: apply ────────────────────────────────────────────────────────────────────────────
  let applied: Awaited<ReturnType<typeof dispatch>>;
  try {
    applied = await dispatch(ctx, capabilityKey, plan.sample(snap, editsCtx), before, deps.capabilities);
  } catch (error) {
    result.outcome = "error";
    result.detail = `the apply threw: ${String(error)}`;
    return await settle(result);
  }
  if (applied.faultCode && NOT_ENTITLED.has(applied.faultCode)) result.oeg1Entitled = false;
  /**
   * `sent` is accepted as OEG-3 green ONLY for a plan that declares `sentAccepted` — a capability
   * whose judge can never observe its own write because the vendor echoes nothing back (the bar is
   * documented on `ProofPlan.sentAccepted`; `override_grant` is the one holder, on live evidence
   * from both orgs). The acceptance and its reason land in the proof's detail, so a promotion
   * citing this proof carries the caveat rather than silently absorbing it.
   */
  const sentAccepted = applied.status === "sent" && plan.sentAccepted !== undefined;
  result.oeg3ChangeLanded = applied.status === "succeeded" || sentAccepted;
  /**
   * Step 4.7 — taken from the orchestrator, not measured here.
   *
   * This used to be `Date.now() - startedAt` around the whole `dispatch()` call, and migration 0191
   * documents the column as "milliseconds from dispatch to the first re-read that saw the change".
   * Those are different quantities: the wrapper also carried the write, the mirror update, the
   * ledger writes and the deliberate `EFS_CARD_VERIFY_RETRY_MS` pause. The first live proof recorded
   * 4562 ms on an account that applies a status edit in ~850 ms (`docs/22` H6), and the arithmetic
   * only made sense once you noticed the 3-second pause inside it.
   *
   * `verifyStep` knows which re-read actually saw the change; nothing out here does. So the number
   * is measured where that fact lives and carried out on the outcome — which also means the proof
   * harness and the entitlement probe now report the same physical quantity.
   */
  result.applyLatencyMs = applied.applyLatencyMs ?? null;
  result.detail = `apply → ${applied.status}${applied.faultCode ? ` (${applied.faultCode})` : ""}`
    + (sentAccepted ? ` · sent ACCEPTED as applied: ${plan.sentAccepted!.reason}` : "");

  // ── OEG-4: vocabulary, on the document the write left behind ────────────────────────────────
  let afterApply: CardDocument | null = null;
  try {
    afterApply = await read(ctx);
    const vocab = judgeVocabulary(afterApply, capabilityKey);
    result.oeg4Vocabulary = vocab.ok;
    result.vocabulary = vocab.observed;
  } catch {
    // Left null — "not reached" is not "false", and the column is nullable for exactly this.
  }

  // ── OEG-5: revert, through whichever capability undoes this one ─────────────────────────────
  // Attempted even when the apply did not land: `sent` means the write MAY have landed, and a card
  // left changed because the harness assumed otherwise is the failure this whole product prevents.
  const revert = plan.revert(snap, editsCtx);
  try {
    const reverted = await dispatch(ctx, revert.capability, revert.body, afterApply ?? before, deps.capabilities);
    result.oeg5RevertLanded = reverted.status === "succeeded";
  } catch (error) {
    result.oeg5RevertLanded = false;
    result.detail = `${result.detail ?? ""} · revert threw: ${String(error)}`;
  }
  if (result.oeg5RevertLanded === false) {
    result.cardStillChanged = true;
    result.detail = `${result.detail ?? ""} · ⚠ THE CARD IS STILL CHANGED — restore it in the WEX portal`;
  }

  // ── OEG-2b: NOT RUN, and left null rather than faked ────────────────────────────────────────
  // The gate is "cardVersion unchanged after a NO-OP DISPATCH" — a `setCardv2` carrying the echoed
  // document and zero edits. The capability model has no way to express that: every capability
  // produces edits by construction, which is the property that makes `buildEdits` the single
  // definition of what a write changes. `writeProbe.ts` has a no-op half and it is not a capability.
  //
  // Two reads compared to each other would satisfy the column and prove nothing — it would show the
  // card is quiet, not that a no-op write leaves it alone, and the whole point of OEG-2b is that
  // WSCardv2's sequence bugs live in the serializer paths a zero-edit request never reaches.
  // A null here is honest; Step 4.6 treats a null gate as "not obtained", never as a pass.

  // `proven` demands every gate that was REACHED came back true, and that the card is back. A null
  // gate never counts as a pass: `oeg2b` is null on production by construction, and Step 4.6 is
  // where that becomes a named residual risk rather than something this function quietly forgives.
  const reached = [result.oeg1Entitled, result.oeg3ChangeLanded, result.oeg4Vocabulary, result.oeg5RevertLanded];
  result.outcome = reached.every((gate) => gate === true) && !result.cardStillChanged ? "proven" : "denied";
  return await settle(result);
}
