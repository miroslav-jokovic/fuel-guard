import { writeAudit } from "../lib/audit.js";
import { driftAgainstExpected, editPath, fieldPath, type CardEdit, type EchoDiff } from "../lib/efsCardEcho.js";
import { VOLATILE_FIELDS, type CardDocument } from "../lib/efsCardXml.js";
import type { EfsSoapError } from "../lib/efsSoapSession.js";
import { upsertCardDetail } from "./efsCardMirror.js";
import { cardLast4 } from "@fuelguard/shared";
import { efsEndpointHost } from "./efsSoapCredentialIdentity.js";
import type { LedgerAdapter } from "../efs/orchestrator/ledger.js";
import type { CardMutationContext, CardMutationOutcome, SettleFacts } from "../efs/orchestrator/types.js";

/**
 * What actually happened, and writing it down. The second half of every mutation.
 *
 * Split from `efsCardControl.ts` at the 500-line budget, along the line the design already draws:
 * that file DECIDES and DISPATCHES, this one CLASSIFIES and RECORDS. Everything here runs after the
 * vendor call has been made and nothing here can prevent it — which is why nothing here throws for a
 * bad outcome. By the time these functions run, the only remaining question is what to write down,
 * and refusing to write it down because the write failed is how a mutation becomes invisible.
 *
 * ── Why the ledger arrives as an argument (Step 3.4) ─────────────────────────────────────────────
 * These functions used to run their own `UPDATE efs_card_mutations`. They now settle through the
 * `LedgerAdapter` they are handed, so the seam docs/27 §5.2 describes is real: every write to the
 * ledger, from the pending insert to the final settle, goes through one implementation. A finaliser
 * that kept its own UPDATE would be a second writer, and the first non-card target would find half
 * the orchestrator already ported and half of it hardcoded to the card table.
 *
 * They take `SettleFacts` rather than the plan for the same reason: nothing here can dispatch,
 * snapshot or judge, so a finaliser cannot acquire the power to re-run the write it is recording.
 */

// ─── Classification ────────────────────────────────────────────────────────────────────────────

/**
 * Did the change we asked for actually take?
 *
 * Compares only the paths the edits NAMED. Anything else that moved is drift, which is a separate
 * finding with a separate remedy — conflating them would report a successful lock as a failure
 * because somebody in the WEX portal changed a policy number in the same second.
 */
export function intentLanded(before: CardDocument, after: CardDocument, edits: readonly CardEdit[]): boolean {
  return unlandedEditNames(before, after, edits).length === 0;
}

/**
 * WHICH edits the vendor did not echo back. `intentLanded` is exactly this list being empty.
 *
 * Split out for Step 3.11, and the split is the whole point: a capability that needs to reason about
 * a PARTICULAR field cannot do it through a boolean, and the alternative — widening `intentLanded`
 * so the capability's case slips through — would hide every genuine partial failure on every other
 * capability. The strictness stays here; only the resolution changes.
 *
 * `editPath` rather than a hand-built `/${e.name}`: on the nested response shape a scalar lives at
 * `/header/status`, and `/status` matches nothing there. The failure is not a false negative but a
 * false POSITIVE — with no path recognised as ours, nothing is ever collected and EVERY mutation
 * reports as landed, including one EFS accepted and silently did not apply. The two tests in
 * efsCardReconcile.test.ts named "NOT land" are the ones that go red if this reverts.
 */
export function unlandedEditNames(
  before: CardDocument,
  after: CardDocument,
  edits: readonly CardEdit[],
): string[] {
  // `driftAgainstExpected` with the volatile fields excluded gives the full difference; an edit
  // failed iff a differing path is the one it named, or lives beneath it (a collection's records).
  const diffs = driftAgainstExpected(before, edits, after, VOLATILE_FIELDS)
    .filter((d) => !vendorNormalisedOnly(d));
  return edits
    .filter((edit) => {
      const path = editPath(before, edit);
      return diffs.some((d) => d.path === path || d.path.startsWith(`${path}/`));
    })
    .map((edit) => edit.name);
}

/**
 * A difference that is the vendor writing our value back in its own casing.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────────────────────────
 * We send `status = Hold`, following the guide's documented spelling (p134). This account's EFS
 * stores and returns `HOLD`. The canonical diff saw `/status` differ, `intentLanded` said no, and a
 * lock that had WORKED was recorded `failed`, audited `card.mutation_failed`, and reported to the
 * operator as "EFS accepted the request but the card is unchanged" — inviting them to try again on a
 * card that was already locked. Discovered against real mirror data before the first live write.
 *
 * ── Why this is narrow, and why it is safe ──────────────────────────────────────────────────────
 * Only a value differing SOLELY by letter case counts, and only on a path an edit named. `Hold` vs
 * `HOLD` passes; `Hold` vs `Held`, vs empty, vs nil, vs a different number of records does not. Drift
 * on fields we did not touch is untouched by this and still reported exactly.
 *
 * Nothing is hidden by the tolerance: `after_document` on the ledger row records what EFS actually
 * holds, so the row shows `HOLD` whatever this function concludes.
 */
function vendorNormalisedOnly(diff: EchoDiff): boolean {
  if (diff.expected.length !== diff.actual.length || diff.expected.length === 0) return false;
  return diff.expected.every((expected, i) => {
    const actual = diff.actual[i] ?? "";
    // Both must be real values: the encoding prefixes a leaf with "v", so a nil (`n`) or a container
    // (`c`) sentinel can never be "the same text in another case".
    if (!expected.startsWith("v") || !actual.startsWith("v")) return expected === actual;
    return expected.slice(1).toLowerCase() === actual.slice(1).toLowerCase();
  });
}

/**
 * Fields that moved which no edit named, minus the ones the vendor legitimately maintains itself.
 *
 * `originalStatus` is the only exclusion, and only when the status was changed: the field's name and
 * the guide's note that it is "often returned as nil" (p35) both point at EFS keeping the status a
 * card will return to. We do NOT silently drop it — it is recorded under `vendorMaintained` in the
 * ledger's drift column, so if the pilot shows it behaving differently the evidence is already there.
 * Anything else moving is real drift and says so.
 */
function classifyDrift(
  before: CardDocument,
  after: CardDocument,
  edits: readonly CardEdit[],
  /** Header fields a dedicated vendor op is EXPECTED to move (D1: the three override fields).
   *  Recorded as vendor-maintained — visible in the ledger's drift column, never alarmed. */
  vendorMovesFields: readonly string[] = [],
): { unexplained: EchoDiff[]; vendorMaintained: EchoDiff[] } {
  const diffs = driftAgainstExpected(before, edits, after, VOLATILE_FIELDS);
  const touchedStatus = edits.some((e) => e.name === "status");
  const editedPaths = new Set(edits.map((e) => editPath(before, e)));
  const vendorMovedPaths = new Set(vendorMovesFields.map((name) => fieldPath(before, name)));
  const originalStatusPath = fieldPath(before, "originalStatus");
  const unexplained: EchoDiff[] = [];
  const vendorMaintained: EchoDiff[] = [];
  for (const diff of diffs) {
    // EFS keeping the status a card will return to, when we moved the status.
    if (touchedStatus && diff.path === originalStatusPath) vendorMaintained.push(diff);
    // The vendor writing OUR value back in its own casing on a field we edited — `Hold` → `HOLD`.
    // `intentLanded` already accepts it, so counting it as drift would report every single lock as
    // "Applied, with other changes" and turn the drift signal into noise on the first live write.
    else if (editedPaths.has(diff.path) && vendorNormalisedOnly(diff)) vendorMaintained.push(diff);
    // A field the dedicated vendor op was sent to move (deleteOverride clearing the override
    // trio). The op's `landed` predicate already judged the outcome; these are its footprint.
    else if (vendorMovedPaths.has(diff.path)) vendorMaintained.push(diff);
    else unexplained.push(diff);
  }
  return { unexplained, vendorMaintained };
}

// ─── Finalizers — one per outcome, each writing ledger + audit ─────────────────────────────────

interface WirePayload {
  requestXmlRedacted: string | null;
  responseXmlRedacted: string | null;
  writeError?: EfsSoapError | null;
  readError?: unknown;
}

export async function finalizeLanded(
  ctx: CardMutationContext,
  ledger: LedgerAdapter,
  plan: SettleFacts,
  after: CardDocument,
  wire: WirePayload,
): Promise<CardMutationOutcome> {
  const { unexplained, vendorMaintained } = classifyDrift(
    plan.before, after, plan.edits, plan.vendorMovesFields,
  );
  const drifted = unexplained.length > 0;
  const driftFields = unexplained.map((d) => d.path);

  await ledger.settle(ctx, plan.mutationId, {
    status: drifted ? "drift_detected" : "succeeded",
    after_version: after.version,
    reconciled_version: after.version,
    after_document: after.card,
    drift: drifted || vendorMaintained.length > 0
      ? { unexplained: unexplained.slice(0, 20), vendorMaintained: vendorMaintained.slice(0, 20) }
      : null,
    ...wireColumns(wire),
  });

  await audit(ctx, plan, plan.auditAction, after, {
    outcome: drifted ? "drift_detected" : "succeeded",
    driftFields,
  });
  if (drifted) {
    await audit(ctx, plan, "card.drift_detected", after, { outcome: "drift_detected", driftFields });
  }

  return {
    mutationId: plan.mutationId,
    status: drifted ? "drift_detected" : "succeeded",
    version: after.version,
    driftFields,
    faultCode: null,
    faultMessage: null,
  };
}

export async function finalizeFailed(
  ctx: CardMutationContext,
  ledger: LedgerAdapter,
  plan: SettleFacts,
  after: CardDocument,
  wire: WirePayload,
): Promise<CardMutationOutcome> {
  const fault = wire.writeError;
  // No fault and no change is its own diagnosis: EFS accepted the request and did nothing with it,
  // which is a vendor behaviour worth naming rather than reporting as an unexplained failure.
  const faultCode = fault?.code ?? "no_change";
  const faultMessage = fault?.message
    ?? "EFS accepted the request but the card is unchanged. Check the card in the WEX portal before retrying.";

  await ledger.settle(ctx, plan.mutationId, {
    status: "failed",
    after_version: after.version,
    reconciled_version: after.version,
    after_document: after.card,
    efs_fault_code: faultCode,
    efs_fault_message: faultMessage.slice(0, 500),
    ...wireColumns(wire),
  });

  await audit(ctx, plan, "card.mutation_failed", after, {
    outcome: "failed", efsFaultCode: faultCode, efsFaultMessage: faultMessage.slice(0, 300),
    /**
     * WHICH edits the vendor did not carry — the one fact a failed row could not previously state.
     *
     * Step 3.11's investigation was told to read `drift->'unexplained'`. That column is null on every
     * failed row: `finalizeLanded` writes `drift`, this function never has, and the diagnosis had to
     * be reconstructed from `edits` against `after_document` by a script written for the purpose.
     * A `no_change` failure naming no field is a failure nobody can act on.
     *
     * The audit row rather than the `drift` column deliberately: `drift` means "fields that moved
     * which no edit named", and these are the opposite — fields an edit named that did NOT move.
     * Overloading one jsonb column with two inverted meanings is how `sync_error` came to say two
     * unrelated things (docs/30 §6.F).
     */
    unlandedFields: unlandedEditNames(plan.before, after, plan.edits),
  });

  return {
    mutationId: plan.mutationId, status: "failed", version: after.version,
    driftFields: [], faultCode, faultMessage,
  };
}

/**
 * The write went out and we could not confirm what became of it.
 *
 * Terminal on purpose. Retrying is not an option (the write may have landed), and calling it a
 * failure would tell somebody a card is unchanged when it may not be. The row stays 'sent', the audit
 * says `card.mutation_unverified`, and the operator is told to go and look.
 */
export async function finalizeUnverified(
  ctx: CardMutationContext,
  ledger: LedgerAdapter,
  plan: SettleFacts,
  wire: WirePayload,
  /**
   * The document the verification DID manage to read, when there was one.
   *
   * Null only when the re-read itself failed — the original reason this outcome exists. Step 3.11
   * added a second route in: a capability that reads the card successfully and cannot judge what it
   * sees. That row was landing with `after_document` null, which is strictly LESS evidence than the
   * `failed` row it replaced, on the very outcome that asks an operator to go and look. Found by the
   * Phase 3 live re-run on 2026-08-15 — the first row this outcome ever produced in anger.
   */
  after: CardDocument | null,
): Promise<CardMutationOutcome> {
  const readMessage = wire.readError instanceof Error ? wire.readError.message : String(wire.readError ?? "");
  const faultCode = wire.writeError?.code ?? "unverified";
  const faultMessage =
    `The change was sent but could not be confirmed: ${wire.writeError?.message ?? readMessage}`.slice(0, 500);
  // Which edits the document does not carry. The point of an unverified row is that somebody has to
  // look — telling them WHERE to look is the difference between evidence and a shrug.
  const unlandedFields = after ? unlandedEditNames(plan.before, after, plan.edits) : null;

  await ledger.settle(ctx, plan.mutationId, {
    status: "sent",
    efs_fault_code: faultCode,
    efs_fault_message: faultMessage,
    ...(after
      ? { after_version: after.version, reconciled_version: after.version, after_document: after.card }
      : {}),
    ...wireColumns(wire),
  });

  await audit(ctx, plan, "card.mutation_unverified", after, {
    outcome: "sent", efsFaultCode: faultCode, efsFaultMessage: faultMessage.slice(0, 300),
    unlandedFields,
  });

  return {
    mutationId: plan.mutationId, status: "sent", version: after?.version ?? null,
    driftFields: [], faultCode, faultMessage,
  };
}

/** `echo_unfaithful`: our own guard refused to send. Nothing reached EFS, so nothing is reconciled. */
export async function finalizeUnsent(
  ctx: CardMutationContext,
  ledger: LedgerAdapter,
  plan: SettleFacts,
  error: EfsSoapError,
): Promise<CardMutationOutcome> {
  await ledger.settle(ctx, plan.mutationId, {
    status: "failed",
    efs_fault_code: error.code,
    efs_fault_message: error.message.slice(0, 500),
    // attempts back to 0: nothing was dispatched, and a row claiming an attempt would send the next
    // reader looking for a request that never existed.
    attempts: 0,
  });
  await audit(ctx, plan, "card.mutation_failed", null, {
    outcome: "failed", efsFaultCode: error.code, efsFaultMessage: error.message.slice(0, 300), sent: false,
  });
  return {
    mutationId: plan.mutationId, status: "failed", version: null, driftFields: [],
    faultCode: error.code, faultMessage: error.message,
  };
}

/**
 * A sequence that applied some of its steps and then stopped.
 *
 * Terminal but ACTIONABLE (docs/27 §5.1, migration 0190), and the distinction is the whole reason the
 * status exists: telling an operator a half-applied sequence `failed` sends them to re-run steps that
 * already landed, and telling them it `succeeded` is a lie. The row keeps `step_index`, so recovery
 * is re-running from there.
 *
 * Only reachable after at least one step landed — a first-step failure settles as one of the four
 * original outcomes, which is what keeps every single-step capability behaving exactly as before.
 * The UI must name the step by its `label`, never by its number.
 */
export async function finalizePartial(
  ctx: CardMutationContext,
  ledger: LedgerAdapter,
  plan: SettleFacts,
  after: CardDocument | null,
  wire: WirePayload,
): Promise<CardMutationOutcome> {
  const fault = wire.writeError;
  const readMessage = wire.readError instanceof Error ? wire.readError.message : String(wire.readError ?? "");
  const faultCode = fault?.code ?? (wire.readError ? "unverified" : "no_change");
  const faultMessage = (
    fault?.message
    ?? (wire.readError ? `The step was sent but could not be confirmed: ${readMessage}` : null)
    ?? "EFS accepted the request and the card is unchanged."
  ).slice(0, 500);

  await ledger.settle(ctx, plan.mutationId, {
    status: "partial",
    step_index: plan.stepIndex,
    ...(after ? { after_version: after.version, reconciled_version: after.version, after_document: after.card } : {}),
    efs_fault_code: faultCode,
    efs_fault_message: faultMessage,
    ...wireColumns(wire),
  });

  await audit(ctx, plan, "card.mutation_partial", after, {
    outcome: "partial",
    stepIndex: plan.stepIndex,
    stepLabel: plan.stepLabel,
    efsFaultCode: faultCode,
    efsFaultMessage: faultMessage.slice(0, 300),
  });

  return {
    mutationId: plan.mutationId,
    status: "partial",
    version: after?.version ?? null,
    driftFields: [],
    faultCode,
    faultMessage,
    ...(plan.stepIndex === null ? {} : { stepIndex: plan.stepIndex }),
    ...(plan.stepLabel === null ? {} : { stepLabel: plan.stepLabel }),
  };
}

const wireColumns = (wire: WirePayload) => ({
  // Capped: the ledger is evidence, not an archive, and a 200KB card document per row is neither.
  request_xml_redacted: wire.requestXmlRedacted?.slice(0, 60_000) ?? null,
  response_xml_redacted: wire.responseXmlRedacted?.slice(0, 60_000) ?? null,
});

/**
 * Card control is ENTIRELY compliance-relevant, so `meta` carries VALUES, not just field names —
 * the `AUDITED_VALUE_FIELDS` rule from routes/roster/drivers.ts, applied to the whole surface.
 * `matchValue` is a driver ID or a unit number: operational data an auditor asks about, not a secret.
 *
 * NEVER in here: the card number, the clientId, the SOAP password, raw XML.
 */
async function audit(
  ctx: CardMutationContext,
  plan: SettleFacts,
  action: string,
  after: CardDocument | null,
  extra: Record<string, unknown>,
): Promise<void> {
  const recorded = await writeAudit(ctx.admin, {
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action,
    entity: "efs_cards",
    entityId: ctx.efsCardId,
    meta: {
      mutationId: plan.mutationId,
      intent: plan.intent,
      reason: ctx.reason,
      stepUp: ctx.stepUp === true,
      expectedVersion: ctx.expectedVersion,
      resultVersion: after?.version ?? null,
      statusBefore: plan.before.card.status,
      statusAfter: after?.card.status ?? null,
      environment: ctx.creds.environment,
      endpointHost: efsEndpointHost(ctx.creds.endpointUrl),
      cardLast4: cardLast4(ctx.cardNumber),
      ...plan.auditMeta,
      ...extra,
    },
  });
  if (!recorded) {
    console.error(`[card-control] mutation ${plan.mutationId} settled without an audit row`, {
      orgId: ctx.orgId, action,
    });
  }
}

/**
 * Vendor truth back into the mirror — from a card document EFS has already given us.
 *
 * Takes the document instead of dialing EFS again (audit B5.1): the old version re-read the card a
 * FOURTH time to learn what the verification read had just learned, adding a paced interactive call
 * to every mutation a person was waiting on. Truth still flows only EFS → mirror; it is simply the
 * same truth, paid for once.
 *
 * TWO callers, and the document is not always an "after". The mutation path passes the verifying
 * re-read. `planCardMutation` passes the PRE-FLIGHT read when it refuses on `card_state_changed`,
 * which is what stops a stale mirror row from re-proposing the same doomed version forever.
 *
 * Best effort in both cases, and the failure mode is why: a mirror write that fails must not turn a
 * completed, correctly-recorded mutation into an error, nor a 409 into a 500 that throws away the
 * fresh card the operator needs in order to retry.
 */
export async function updateMirror(ctx: CardMutationContext, card: CardDocument): Promise<void> {
  try {
    await upsertCardDetail(ctx.admin, ctx.env, ctx.orgId, ctx.cardNumber, card);
  } catch (error) {
    console.error(
      `[card-control] mirror refresh failed on card ${ctx.efsCardId}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
