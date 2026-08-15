import { Router } from "express";
import { z } from "zod";
import { CARD_CAPABILITY_CONTRACTS } from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { requireFreshAuth } from "../../middleware/requireFreshAuth.js";
import { decidePromotion, type OrgObservation, type ProofEvidence } from "../../efs/harness/promote.js";
import { judgeField, observeField } from "../../efs/harness/configScan.js";

/**
 * `POST /api/fuel-cards/promote/:capability` — the only way a capability becomes `enabled` (Step 4.6).
 *
 * ── Two actions, deliberately asymmetric ────────────────────────────────────────────────────────
 * `enable` demands a proof and passes it through `decidePromotion`, which refuses by default.
 * `suspend` demands nothing but a reason. That asymmetry is the point: turning a capability OFF is
 * the thing an operator does when it is actively causing harm, and a gate on the way out is a gate
 * between a person and stopping the damage. Turning it ON is where the evidence belongs.
 *
 * ── The decision is not made here ───────────────────────────────────────────────────────────────
 * This route gathers facts and writes the outcome; `decidePromotion` decides. A rule embedded in a
 * request handler can only be tested by standing up a request, and this rule decides whether code
 * may touch a customer's fuel cards.
 */

const promoteSchema = z.object({
  action: z.enum(["enable", "suspend"]),
  /** Required both ways. "Why was this allowed" and "why was this stopped" are both audit questions. */
  reason: z.string().trim().min(3).max(500),
  /** The proof being cited. Required to enable; meaningless to suspend. */
  proofId: z.string().uuid().optional(),
});

/**
 * Write the audit row for a promotion decision, and say whether it landed.
 *
 * ── Two bugs in one, found by checking the database after the first real promotion ──────────────
 * `audit_logs.entity_id` is a **uuid** column and the first version passed the capability KEY —
 * `"card_lock"` — so every insert failed. `writeAudit` retried, logged to stderr and returned
 * `false`, and the route ignored the return: the promotion landed, the audit row did not, and the
 * response said `ok: true`. A promotion is precisely the act that must never be unattributable.
 *
 * So: the promotion ROW's id, which is a uuid and is the thing the audit entry is about, and the
 * capability key moves into `meta` where it was always meaningful. The boolean is returned rather
 * than swallowed — `efsCardReconcile.ts` already treats a failed audit write as worth shouting
 * about, and this is the same rule applied at the more consequential end.
 */
async function recordDecision(
  admin: ReturnType<typeof getSupabaseAdmin>,
  entry: { orgId: string; actorId: string | null; action: string; rowId: string | null; meta: Record<string, unknown> },
): Promise<boolean> {
  const recorded = await writeAudit(admin, {
    orgId: entry.orgId,
    actorId: entry.actorId,
    action: entry.action,
    entity: "efs_capability_promotions",
    entityId: entry.rowId ?? undefined,
    meta: entry.meta,
  });
  if (!recorded) {
    console.error("[card-control] capability decision recorded WITHOUT an audit row", {
      orgId: entry.orgId, action: entry.action, capability: entry.meta.capability,
    });
  }
  return recorded;
}

/** Re-judge the org's stored scan spellings against the contract, so one rule reads the vocabulary. */
function scanVerdicts(
  capabilityKey: string,
  observedVocabulary: Record<string, string[]> | null,
): OrgObservation["scanVerdicts"] {
  const contract = CARD_CAPABILITY_CONTRACTS[capabilityKey];
  const verdicts: OrgObservation["scanVerdicts"] = {};
  for (const field of contract?.vocabularyFields ?? []) {
    const spellings = observedVocabulary?.[field];
    // No recorded scan is NOT "match". It is the absence of evidence, and `decidePromotion` refuses
    // on `unobserved` unless a proof supplies the observation itself.
    if (!spellings) { verdicts[field] = "unobserved"; continue; }
    // Rebuilt through the scanner's own judgement rather than compared here — a second definition of
    // "the account spells it this way" is how H1 happened in the first place.
    const observation = { ...observeField([], field), rawSpellings: spellings, observedValues: spellings.map((text) => ({ text, count: 1 })) };
    verdicts[field] = judgeField(
      capabilityKey, field, contract?.emittableValues[field] ?? [], observation,
      contract?.casingAdaptiveFields?.includes(field) ?? false,
    ).state;
  }
  return verdicts;
}

export function fuelCardPromoteRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/promote/:capability",
    requireOrg,
    requireRole("admin"),
    // Both directions: enabling hands a capability production fuel cards, and suspending takes them
    // away mid-incident. Neither should be reachable with a stale session.
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const capabilityKey = String(req.params.capability);

      if (!CARD_CAPABILITY_CONTRACTS[capabilityKey]) {
        res.status(404).json(apiError("unknown_capability", `"${capabilityKey}" is not a capability.`));
        return;
      }

      const parsed = promoteSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid promotion request"));
        return;
      }
      const { action, reason, proofId } = parsed.data;

      if (action === "suspend") {
        const { data: suspendedRow } = await admin.from("efs_capability_promotions").upsert({
          org_id: orgId, capability_key: capabilityKey, state: "suspended",
          suspended_reason: reason, reason, promoted_by: req.auth!.userId,
          promoted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: "org_id,capability_key" }).select("id").single();
        await recordDecision(admin, {
          orgId, actorId: req.auth!.userId, action: "card.capability_suspended",
          rowId: (suspendedRow as { id: string } | null)?.id ?? null,
          meta: { capability: capabilityKey, reason },
        });
        // No cache anywhere in the gate, so the next card write already sees this.
        res.json({ ok: true, capability: capabilityKey, state: "suspended" });
        return;
      }

      if (!proofId) {
        res.status(400).json(apiError("proof_required", "Cite the proof run that justifies enabling this capability."));
        return;
      }

      const [{ data: proofRow }, { data: settings }] = await Promise.all([
        admin.from("efs_capability_proofs")
          .select("outcome, oeg1_entitled, oeg2b_noop_stable, oeg3_change_landed, oeg4_vocabulary, oeg5_revert_landed, document_shape, vocabulary, capability_key")
          .eq("id", proofId).eq("org_id", orgId).maybeSingle(),
        admin.from("efs_card_control_settings")
          .select("observed_document_shape, observed_vocabulary")
          .eq("org_id", orgId).maybeSingle(),
      ]);

      const row = proofRow as Record<string, unknown> | null;
      // A proof for a DIFFERENT capability is not evidence for this one, and citing one is the kind
      // of mistake that looks like a typo and reads like an approval.
      if (row && row.capability_key !== capabilityKey) {
        res.status(400).json(apiError(
          "proof_mismatch",
          `That proof is for "${String(row.capability_key)}", not "${capabilityKey}".`,
        ));
        return;
      }

      const proof: ProofEvidence | null = row
        ? {
            outcome: String(row.outcome),
            oeg1Entitled: row.oeg1_entitled as boolean | null,
            oeg2bNoopStable: row.oeg2b_noop_stable as boolean | null,
            oeg3ChangeLanded: row.oeg3_change_landed as boolean | null,
            oeg4Vocabulary: row.oeg4_vocabulary as boolean | null,
            oeg5RevertLanded: row.oeg5_revert_landed as boolean | null,
            documentShape: (row.document_shape as string | null) ?? null,
            vocabulary: (row.vocabulary as Record<string, string[]> | null) ?? {},
          }
        : null;

      const observedVocabulary = (settings as { observed_vocabulary?: Record<string, string[]> } | null)?.observed_vocabulary ?? null;
      const decision = decidePromotion(capabilityKey, proof, {
        observedDocumentShape: (settings as { observed_document_shape?: string | null } | null)?.observed_document_shape ?? null,
        scanVerdicts: scanVerdicts(capabilityKey, observedVocabulary),
      });

      if (!decision.allowed) {
        // 409, not 403: the caller is permitted to ask, and the evidence is what is missing. Every
        // reason is returned, so one round trip tells them everything they have to fix.
        res.status(409).json({
          ...apiError("promotion_refused", "This capability cannot be enabled yet."),
          refusals: decision.refusals,
          residualRisks: decision.residualRisks,
        });
        return;
      }

      const { data: promotedRow } = await admin.from("efs_capability_promotions").upsert({
        org_id: orgId, capability_key: capabilityKey, state: "enabled",
        proof_id: proofId, reason, promoted_by: req.auth!.userId,
        promoted_at: new Date().toISOString(), suspended_reason: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "org_id,capability_key" }).select("id").single();

      const audited = await recordDecision(admin, {
        orgId, actorId: req.auth!.userId, action: "card.capability_promoted",
        rowId: (promotedRow as { id: string } | null)?.id ?? null,
        // The residual risks ride ON the audit row, not just the response: "what did we know we did
        // not know when we allowed this" is the question asked after an incident, not before.
        meta: { capability: capabilityKey, reason, proofId, residualRisks: decision.residualRisks },
      });

      res.json({
        ok: true, capability: capabilityKey, state: "enabled",
        residualRisks: decision.residualRisks,
        // Surfaced, not swallowed. A promotion is the act that lets code touch a customer's fuel
        // cards; one that left no audit row is a fact the operator has to know while they still
        // remember doing it.
        ...(audited ? {} : { warning: "This promotion was NOT recorded in the audit log. Report it." }),
      });
    }),
  );

  return router;
}
