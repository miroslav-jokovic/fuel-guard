import { Router } from "express";
import { z } from "zod";
import { parseTag, type ScanResult } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getTagResolver } from "./registry.js";
import { findPartsByUpc, listStock } from "../modules/maintenance/inventory/index.js";
import { isServiceError } from "../modules/maintenance/inventory/types.js";

/**
 * `GET /api/tags/resolve?code=` — one scan, one answer (D-INV7; INVENTORY-PLAN.md step I6).
 *
 * ── WHY THE FAILURES ARE 200s ─────────────────────────────────────────────────────────────────
 * `unknown_tag` and `malformed` come back as ordinary results with ordinary 200s, because on a shop
 * floor they are ordinary events with different useful next actions: a well-formed tag whose kind
 * has no resolver is probably a label from a newer version of the product, and a string that is not
 * a tag at all is a damaged label or a barcode from something else. A 404 for both would collapse
 * that difference into one dead end, and what the good products do here is offer "attach or create"
 * rather than a shrug — which needs to know which of the two happened, and needs the code kept.
 * `inventoryScanContract.ts` carries the whole argument; this route is its one implementation.
 *
 * ── THE FALL-THROUGH TO A SUPPLIER UPC IS SAFE BECAUSE OF THE GRAMMAR ─────────────────────────
 * `parseTag` accepts nothing that does not begin `SIL1:`, and every retail symbology in the shop
 * encodes digits (§2.10). So the two spaces cannot overlap, and a string that is not one of ours can
 * be tried as a UPC without any risk of a tag being misread as a barcode.
 *
 * ── IT IS GATED `maintenance: view`, WHICH IS NARROWER THAN IT LOOKS ──────────────────────────
 * The route lives outside the maintenance module because §2.10 makes it product-wide — a future
 * `document` or `invite` kind belongs to other sections entirely. Today every registered kind is
 * maintenance's, so the gate is maintenance's. **The kind a code names must not widen that**: when
 * the second section registers a kind, this gate becomes per-resolver, and the resolver declares
 * its own. Recorded here because the wrong move is to relax the gate now, in advance, to a section
 * nobody has built.
 */

const querySchema = z.object({ code: z.string().min(1).max(120) });

export function tagsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/resolve",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Scan or type a code."));
        return;
      }
      const code = parsed.data.code.trim();
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      const tag = parseTag(code);

      // ── one of ours ──────────────────────────────────────────────────────────────────────────
      if (tag) {
        const resolver = getTagResolver(tag.kind);
        // No resolver, or a resolver that found nothing in THIS org. Deliberately the same answer:
        // reporting them differently would confirm another tenant's label to whoever scanned it.
        const result = resolver
          ? await resolver({ admin, orgId, id: tag.id, code })
          : null;
        res.json({
          ok: true,
          result: result ?? ({ kind: "unknown_tag", code, tagKind: tag.kind } satisfies ScanResult),
        });
        return;
      }

      // ── not ours: try it as a supplier barcode ───────────────────────────────────────────────
      const parts = await findPartsByUpc(admin, orgId, code);
      if (isServiceError(parts)) {
        // A lookup that failed is not a scan that found nothing, and saying so would send a
        // technician looking for a label that is fine.
        res.status(500).json(apiError(parts.code, parts.error));
        return;
      }
      const part = parts[0];
      if (!part) {
        res.json({ ok: true, result: { kind: "malformed", code } satisfies ScanResult });
        return;
      }

      // Where that part is held, which may be empty — knowing the part and knowing where it sits
      // are different lookups, and a part stocked nowhere is a real state the sheet offers to fix.
      const stock = await listStock(admin, orgId, { partId: part.id });
      res.json({
        ok: true,
        result: {
          kind: "part_by_upc",
          code,
          part,
          stockLines: isServiceError(stock) ? [] : stock.lines,
        } satisfies ScanResult,
      });
    }),
  );

  return router;
}
