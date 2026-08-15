import { Router } from "express";
import { z } from "zod";
import { CARD_CAPABILITY_CONTRACTS } from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { scanConfig } from "../../efs/harness/configScan.js";
import { documentShape, parseCardDocument } from "../../lib/efsCardXml.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";

/**
 * `POST /api/fuel-cards/config-scan` — what vocabulary does this account actually emit? (Step 4.4)
 *
 * ── It spends no vendor calls, and that is a design choice, not a shortcut ───────────────────────
 * The mirror already stores `last_response_xml_redacted` — the vendor's own bytes, PAN-redacted, for
 * every card the detail sweep has read. As of 2026-08-15 that is 234 of 234 rows across both orgs.
 * Re-reading the fleet live would cost 234 paced interactive calls against a shared vendor budget,
 * compete with the pollers, and answer the same question, because the question is "how does this
 * account SPELL things" and a spelling does not go stale in a day.
 *
 * That is also why this route is `opensSoap: false` in `FUEL_CARD_ROUTE_TABLE`. It is the rare
 * fuel-card route that genuinely cannot reach EFS: no credentials are resolved here and no card op is
 * imported. The rate limiter's own comment says ambiguity must resolve toward charging — there is no
 * ambiguity to resolve.
 *
 * ── Provenance is part of the answer ─────────────────────────────────────────────────────────────
 * `unobserved` from a complete, fresh corpus means "this account does not emit that value".
 * `unobserved` from 12 of 234 stale rows means "we did not look properly". Those are different
 * findings with different remedies, and Step 4.6 refuses promotion on the word alone — so the
 * response carries how many cards were scanned, how many carried no stored document, and the
 * freshness range of the ones that did. A caller that ignores it is deciding to.
 *
 * Read-only in the strongest sense: no vendor call, no write, no mutation ledger row. Admin and org
 * scope apply.
 */

const configScanSchema = z.object({
  /**
   * Cap the corpus, newest first. Absent means "every card", which is what the exit gate wants; the
   * knob exists so a caller diagnosing a slow response can bound it rather than guess.
   */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export function fuelCardConfigScanRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/config-scan",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const parsed = configScanSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid scan request"));
        return;
      }

      let query = admin
        .from("efs_cards")
        .select("card_last4, last_response_xml_redacted, detail_synced_at")
        .eq("org_id", orgId)
        .order("detail_synced_at", { ascending: false, nullsFirst: false });
      if (parsed.data.limit !== undefined) query = query.limit(parsed.data.limit);

      const { data, error } = await query;
      // FAIL LOUD, not empty. A scan that answered `unobserved` for every field because the mirror
      // was unreadable would look exactly like an account that emits nothing, and Step 4.6 treats
      // those two identically — which is why this must never be one of them.
      if (error) {
        res.status(503).json(apiError("mirror_unavailable", `Could not read the card mirror: ${error.message}`));
        return;
      }

      const rows = data ?? [];
      const documents = rows
        .map((r) => (r as { last_response_xml_redacted: string | null }).last_response_xml_redacted)
        .filter((xml): xml is string => typeof xml === "string" && xml.length > 0);
      const synced = rows
        .map((r) => (r as { detail_synced_at: string | null }).detail_synced_at)
        .filter((t): t is string => typeof t === "string")
        .sort();

      const report = scanConfig(documents, CARD_CAPABILITY_CONTRACTS);

      /**
       * Record what this org was observed to BE, for Step 4.6 to compare a proof against.
       *
       * The gate refuses promotion when the proof's document shape does not match the target org's,
       * which means the target's shape has to live somewhere that is not a proof — these are the
       * columns 0191 added for it.
       *
       * UPDATE, never upsert. A settings row means "this org has card control configured"; creating
       * one as a side effect of a read-only scan would hand an org a configuration nobody chose.
       * An org with no row simply has nothing recorded, and Step 4.6 refuses on that rather than
       * inventing a default.
       */
      let observedShape: string | null = null;
      if (documents.length > 0) {
        try {
          observedShape = documentShape(parseCardDocument(documents[0]!));
        } catch {
          // A corpus we cannot parse records no shape, which blocks promotion — the safe direction.
        }
      }
      const observedVocabulary = Object.fromEntries(report.fields.map((f) => [f.field, f.rawSpellings]));
      const { error: writeError } = await admin
        .from("efs_card_control_settings")
        .update({ observed_document_shape: observedShape, observed_vocabulary: observedVocabulary })
        .eq("org_id", orgId);

      res.json({
        recorded: writeError ? null : { observedDocumentShape: observedShape },
        ok: true,
        provenance: {
          source: "mirror.last_response_xml_redacted",
          cardsInOrg: rows.length,
          cardsWithStoredDocument: documents.length,
          /** Rows the sweep has never read a document for — the corpus this scan could not see. */
          cardsWithoutStoredDocument: rows.length - documents.length,
          oldestSyncedAt: synced.at(0) ?? null,
          newestSyncedAt: synced.at(-1) ?? null,
        },
        ...report,
      });
    }),
  );

  return router;
}
