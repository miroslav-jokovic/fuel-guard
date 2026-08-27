import { Router } from "express";
import { z } from "zod";
import { cardLast4 } from "@silvicom/shared";
import { getAppLocals } from "../../../lib/appLocals.js";
import type { Env } from "../../../env.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { capabilityRegistry } from "../registry.js";
import { proveCapability, type ProofOutcome } from "../harness/prove.js";
import { efsEndpointHost } from "../services/efsSoapCredentialIdentity.js";
import { controlErrorResponse } from "./controlPrepare.js";
import { resolveProbeCredentials } from "./probeGuards.js";
import { cardRefHmac } from "../services/efsCardMirror.js";

/**
 * `POST /api/fuel-cards/prove/:capability` — run the OEG against a real card (Step 4.5).
 *
 * ── Every guard the write probe has, for the same reason ────────────────────────────────────────
 * This writes to a real fuel card twice. Admin, step-up re-authentication,
 * `EFS_CARD_CONTROL_PROBE_ENABLED` (default false, and standing rule 15 says unset it afterwards),
 * plus `resolveProbeCredentials`, which carries the Phase 1 org-ownership check and the production
 * gate. A typed confirmation naming the card's last four is demanded exactly as `/write-check`
 * demands one: a proof run is not a read, and the operator should have to say which card.
 *
 * ── It cannot promote ───────────────────────────────────────────────────────────────────────────
 * The harness writes `proving`, then `proven` or `denied`. `enabled` is reachable only through Step
 * 4.6, by a person, citing the proof this route produced. Evidence that promotes itself is not
 * evidence, and the two endpoints are separate so that no single call can do both.
 */

/** The card's `efs_cards.id`, resolved the same way `assertOrgOwnsCard` proves ownership. */
async function cardRowId(
  admin: ReturnType<typeof getSupabaseAdmin>,
  env: Env,
  orgId: string,
  cardNumber: string,
): Promise<string> {
  const { data } = await admin
    .from("efs_cards")
    .select("id")
    .eq("card_ref_hmac", cardRefHmac(env, orgId, cardNumber))
    .eq("org_id", orgId)
    .maybeSingle();
  // Unreachable after `assertOrgOwnsCard` inside `resolveProbeCredentials`, and thrown rather than
  // defaulted: a proof attributed to the wrong card row is worse than one that refuses to run.
  if (!data) throw new Error("proof: the card passed ownership but has no mirror row");
  return (data as { id: string }).id;
}

const proveSchema = z.object({
  /** Full PAN, held for the operation only — never logged, never stored. Last four is what persists. */
  cardNumber: z.string().trim().min(12).max(25),
  /** `PROVE <last4>`, typed by the operator. The same shape `/write-check` demands. */
  confirm: z.string().trim().min(1),
});

/** Persists the proof row and the promotion state — the harness's only route to the database. */
function makeDeps(
  admin: ReturnType<typeof getSupabaseAdmin>,
  orgId: string,
  userId: string,
  environment: string,
  endpointHost: string,
  last4: string,
) {
  return {
    capabilities: capabilityRegistry(),
    openProof: async (capabilityKey: string): Promise<string> => {
      const { data, error } = await admin
        .from("efs_capability_proofs")
        .insert({
          org_id: orgId, capability_key: capabilityKey, outcome: "running",
          environment, endpoint_host: endpointHost, card_last4: last4, run_by: userId,
        })
        .select("id")
        .single();
      // Thrown, not swallowed: a proof that cannot record itself must not run. The whole value of a
      // proof is the row, and a run with nowhere to land is a write to a card for no reason.
      if (error) throw new Error(`could not open the proof row: ${error.message}`);
      return (data as { id: string }).id;
    },
    settleProof: async (proofId: string, r: ProofOutcome): Promise<void> => {
      await admin.from("efs_capability_proofs").update({
        outcome: r.outcome, outcome_detail: r.detail,
        oeg1_entitled: r.oeg1Entitled, oeg2b_noop_stable: r.oeg2bNoopStable,
        oeg3_change_landed: r.oeg3ChangeLanded, oeg4_vocabulary: r.oeg4Vocabulary,
        oeg5_revert_landed: r.oeg5RevertLanded,
        apply_latency_ms: r.applyLatencyMs, vocabulary: r.vocabulary,
        document_shape: r.documentShape, completed_at: new Date().toISOString(),
      }).eq("id", proofId).eq("org_id", orgId);
    },
    setPromotionState: async (capabilityKey: string, state: string, proofId: string): Promise<void> => {
      // `enabled` is deliberately unreachable from here. The harness's own type forbids it; this is
      // the second, independent refusal, because the type is erased at runtime and this is the line
      // that actually writes the column.
      if (state === "enabled") throw new Error("the proof harness may never write `enabled`");
      await admin.from("efs_capability_promotions").upsert({
        org_id: orgId, capability_key: capabilityKey, state,
        proof_id: proofId, updated_at: new Date().toISOString(),
      }, { onConflict: "org_id,capability_key" });
    },
  };
}

export function fuelCardProveRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/prove/:capability",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const capabilityKey = String(req.params.capability);

      if (!env.EFS_CARD_CONTROL_PROBE_ENABLED) {
        res.status(403).json(apiError(
          "probe_disabled",
          "Capability proofs are switched off. Set EFS_CARD_CONTROL_PROBE_ENABLED=true, run the proof, then unset it.",
        ));
        return;
      }

      const parsed = proveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid proof request"));
        return;
      }
      const { cardNumber, confirm } = parsed.data;
      const last4 = cardLast4(cardNumber) ?? "";
      if (confirm.toUpperCase() !== `PROVE ${last4}`) {
        res.status(400).json(apiError(
          "confirmation_required",
          `Type "PROVE ${last4}" to confirm a proof run against this card. It will be written to twice.`,
        ));
        return;
      }

      if (!capabilityRegistry()[capabilityKey]?.proof) {
        res.status(404).json(apiError(
          "unknown_capability",
          `"${capabilityKey}" has no proof plan, so it cannot be proven — and cannot be promoted.`,
        ));
        return;
      }

      try {
        // `resolveProbeCredentials` carries the org-ownership check and the production gate but
        // returns only credentials; the ledger needs the card's row id, so it is looked up here
        // against the same HMAC that check used rather than by any second identity.
        const creds = await resolveProbeCredentials(admin, env, orgId, cardNumber);
        const efsCardId = await cardRowId(admin, env, orgId, cardNumber);
        const deps = makeDeps(admin, orgId, req.auth!.userId!, creds.environment, efsEndpointHost(creds.endpointUrl), last4);

        const result = await proveCapability(
          {
            admin, env, creds, orgId, efsCardId, cardNumber,
            userId: req.auth!.userId!,
            expectedVersion: "", idempotencyKey: null, stepUp: true,
          },
          capabilityKey,
          deps,
        );

        res.json({
          ok: result.outcome === "proven",
          capability: capabilityKey,
          last4,
          ...result,
          // Restated at the top level because it is the one field an operator must act on, and it
          // must not be something they have to scroll for.
          ...(result.cardStillChanged
            ? { warning: `The card ••••${last4} is STILL CHANGED. Restore it in the WEX portal before anything else.` }
            : {}),
        });
      } catch (error) {
        controlErrorResponse(res, error);
      }
    }),
  );

  return router;
}

