import { Router } from "express";
import { z } from "zod";
import { cardLast4 } from "@silvicom/shared";
import { getAppLocals } from "../../../lib/appLocals.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { capabilityRegistry } from "../registry.js";
import { restoreFromLedger } from "../harness/restore.js";
import { cardRefHmac } from "../services/efsCardMirror.js";
import { controlErrorResponse } from "./controlPrepare.js";
import { resolveProbeCredentials } from "./probeGuards.js";

/**
 * `POST /api/fuel-cards/restore/:mutationId` — put a card back from a proof's ledger row.
 *
 * ── The prove route's guards, exactly, because it writes the same cards ─────────────────────────
 * Admin, step-up re-authentication, `EFS_CARD_CONTROL_PROBE_ENABLED`, and `resolveProbeCredentials`,
 * which carries the org-ownership check and the production gate (`EFS_ALLOW_PRODUCTION_PROBE`). A
 * restore is the end of a proof session, so it opens under the same flags and closes with them
 * (standing rule 15). The operator types `RESTORE <last4>`: the card number is typed hidden, so the
 * confirmation is the one moment they can see which card is about to be written.
 *
 * ── The card number must be the card the row wrote to ──────────────────────────────────────────
 * The ledger keeps the card's mirror id, never its PAN, and EFS needs the PAN to read or write. So
 * the operator supplies it, and it is checked against the row's `efs_card_id` through the same HMAC
 * that proves ownership. A mismatch is refused, not used: the replay would otherwise land on
 * whichever card was typed.
 *
 * What may be restored, and when, is decided in `harness/restore.ts`, not here.
 */

const restoreSchema = z.object({
  /** Full PAN, held for the operation only — never logged, never stored. */
  cardNumber: z.string().trim().min(12).max(25),
  /** `RESTORE <last4>`, typed by the operator. */
  confirm: z.string().trim().min(1),
});

const uuid = z.uuid();

interface LedgerRow {
  id: string;
  efs_card_id: string;
  capability_key: string | null;
  proof_run_id: string | null;
  before_version: string | null;
  after_version: string | null;
  before_document: CardDocument["card"] | null;
}

export function fuelCardRestoreRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/restore/:mutationId",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      if (!env.EFS_CARD_CONTROL_PROBE_ENABLED) {
        res.status(403).json(apiError(
          "probe_disabled",
          "Restores run under the proof flags. Set EFS_CARD_CONTROL_PROBE_ENABLED=true, restore, then unset it.",
        ));
        return;
      }
      const mutationId = uuid.safeParse(req.params.mutationId);
      const parsed = restoreSchema.safeParse(req.body ?? {});
      if (!mutationId.success || !parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error?.issues[0]?.message ?? "Invalid mutation id"));
        return;
      }
      const { cardNumber, confirm } = parsed.data;
      const last4 = cardLast4(cardNumber) ?? "";
      if (confirm.toUpperCase() !== `RESTORE ${last4}`) {
        res.status(400).json(apiError(
          "confirmation_required",
          `Type "RESTORE ${last4}" to confirm the restore of this card.`,
        ));
        return;
      }

      try {
        // Ownership and the production gate FIRST, before this org's ledger is even read.
        const creds = await resolveProbeCredentials(admin, env, orgId, cardNumber);

        const { data: row, error } = await admin
          .from("efs_card_mutations")
          .select("id, efs_card_id, capability_key, proof_run_id, before_version, after_version, before_document")
          .eq("id", mutationId.data)
          .eq("org_id", orgId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) {
          res.status(404).json(apiError("not_found", "No such card change in this company."));
          return;
        }
        const ledger = row as LedgerRow;

        const { data: card } = await admin
          .from("efs_cards")
          .select("id")
          .eq("card_ref_hmac", cardRefHmac(env, orgId, cardNumber))
          .eq("org_id", orgId)
          .maybeSingle();
        if ((card as { id: string } | null)?.id !== ledger.efs_card_id) {
          res.status(400).json(apiError(
            "card_mismatch",
            `The card ending ${last4} is not the card that change was written to. Nothing was sent.`,
          ));
          return;
        }

        let proofCapabilityKey: string | null = null;
        if (ledger.proof_run_id) {
          const { data: proof } = await admin
            .from("efs_capability_proofs")
            .select("capability_key")
            .eq("id", ledger.proof_run_id)
            .eq("org_id", orgId)
            .maybeSingle();
          proofCapabilityKey = (proof as { capability_key: string } | null)?.capability_key ?? null;
        }

        const result = await restoreFromLedger(
          {
            admin, env, creds, orgId, efsCardId: ledger.efs_card_id, cardNumber,
            userId: req.auth!.userId!, expectedVersion: "", idempotencyKey: null, stepUp: true,
          },
          {
            id: ledger.id,
            capabilityKey: ledger.capability_key,
            proofRunId: ledger.proof_run_id,
            proofCapabilityKey,
            beforeVersion: ledger.before_version,
            afterVersion: ledger.after_version,
            beforeCard: ledger.before_document,
          },
          capabilityRegistry(),
        );
        res.status(result.outcome === "refused" ? 409 : 200).json({
          ok: result.outcome === "restored" || result.outcome === "already_restored",
          mutationId: ledger.id,
          last4,
          ...result,
        });
      } catch (error) {
        controlErrorResponse(res, error);
      }
    }),
  );

  return router;
}
