import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { searchEntries, summarizeByCategory } from "../../financial/index.js";
import { inspectionsRouter, inspectionPrintingRouter } from "./inspections.js";
import { inspectorsRouter } from "./inspectors.js";
import { printProfilesRouter } from "./printProfiles.js";
import { inventoryPartsRouter } from "./inventoryParts.js";
import { inventoryLocationsRouter } from "./inventoryLocations.js";
import { inventoryStockRouter } from "./inventoryStock.js";
import { inventoryCountSessionsRouter } from "./inventoryCountSessions.js";
import { inventoryAssetsRouter } from "./inventoryAssets.js";
import { inventoryAssetTypesRouter } from "./inventoryAssetTypes.js";
import { inventoryUnitsRouter, kitExpectationsRouter } from "./inventoryUnits.js";
import { inventoryLabelsRouter } from "./inventoryLabels.js";

const spendSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * The maintenance surface (P5.3) — a real section with an honest amount of data. It reads
 * `category = 'maintenance'` from the financial store, WHICH IS EMPTY TODAY and says so: the
 * projection assigns that category to nothing yet, because McLeod's repair dollars sit inside
 * AP vouchers under GL accounts finance has not yet ruled on (§6 Q5), with unit numbers in
 * free text ("754 Repair") that D-FS5 forbids guessing at. The response carries that state
 * explicitly so the page can render the truth instead of a mysterious zero.
 *
 * When data DOES arrive it comes through ONE door, not the two this comment described until
 * 2026-09-08: finance's GLID ruling promoting repair-flavored AP accounts to
 * category='maintenance'. The second door — the FleetPal collector projecting work-order expense
 * under a matched dedup_key — was closed by the 2026-09-03 fleet ruling (D-FLEET2), which made
 * McLeod's general ledger the entire financial input and took FleetPal out of Finance. FleetPal is
 * operational now (D-INV10): work orders, PM schedules, DVIR defects. Nor does the inventory
 * feature open a third door: a part issue is not a spend event, GL 30230000 Shop Parts already
 * carries the money, and D-INV11 says it never arrives here.
 */
export function maintenanceRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("maintenance", "view");

  // The §396.17 annual inspection (ANNUAL-INSPECTION-PLAN.md, step A4) — the module's first owned
  // tables, mounted beside the repair-spend read it was born with. Each sub-router carries its own
  // per-verb gates derived from the same matrix.
  router.use("/inspections", inspectionsRouter());
  router.use("/inspectors", inspectorsRouter());
  // Printing onto the pre-printed pads (D-AVI8): the per-printer offsets, and the sheet they are
  // measured with.
  router.use("/print-profiles", printProfilesRouter());
  router.use("/printing", inspectionPrintingRouter());

  // Shop inventory (INVENTORY-PLAN.md step I3, D-S360-7) — the module's second feature. Three
  // sub-routers under one prefix rather than one file, because the 500-line budget is a hard gate
  // and the seam is the plan's own: the catalogue, the places, and the shelves with their ledger.
  router.use("/inventory/parts", inventoryPartsRouter());
  router.use("/inventory/locations", inventoryLocationsRouter());
  // Mounted BEFORE the catch-all `/inventory` below. Express would fall through to this one anyway —
  // `inventoryStockRouter` has no `/count-sessions` route and calls next() — but relying on that
  // makes the ordering load-bearing in a way nothing states, and the day someone adds a `/:id`
  // there it stops being true.
  router.use("/inventory/count-sessions", inventoryCountSessionsRouter());
  // I8's half of §2.1's seam: the things with identities. `asset-types` is its own prefix rather
  // than `/assets/types`, because that WOULD collide with `/assets/:id` — see the header of
  // `inventoryAssetTypes.ts` for why this is the one place in the module where segment ordering
  // would have been load-bearing.
  router.use("/inventory/assets", inventoryAssetsRouter());
  router.use("/inventory/asset-types", inventoryAssetTypesRouter());
  // I9's units: the same assets read from the other end — what a truck is expected to hold against
  // what it does. `kit-expectations` is the rules behind those numbers, and gets its own prefix for
  // the reason `asset-types` did: `/units/kit-expectations` would collide with `/units/:kind/:id`.
  // Labels (I10). Mounted above the catch-all for the same reason `/count-sessions` is: it is a
  // distinct concern rather than a shelf verb, and relying on the stock router falling through is a
  // dependency on a file that has no reason to know this route exists.
  router.use("/inventory/labels", inventoryLabelsRouter());
  router.use("/inventory/units", inventoryUnitsRouter());
  router.use("/inventory/kit-expectations", kitExpectationsRouter());
  router.use("/inventory", inventoryStockRouter());

  router.get(
    "/spend",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = spendSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const f = parsed.data;
      const orgId = req.auth!.orgId!;
      const result = await searchEntries(admin, orgId, {
        category: "maintenance",
        from: f.from,
        to: f.to,
        limit: f.limit,
        offset: f.offset,
      });
      /**
       * The window's TOTAL, and the reason it is a second read rather than a sum of the page.
       *
       * The page stops at fifty rows. A card adding it up would report a number that is right for
       * fifty repairs and wrong for the fifty-first, and would be believed — the exact defect the
       * 2026-09-09 review found in `/low-stock`, where a list of what to order stopped early and
       * said "nothing more to order". I4 shipped the shop home counting LINES for want of this
       * figure and recorded it as owed; this is that debt paid.
       *
       * It asks `summarizeByCategory`, which is the ledger's own aggregation substrate and pages the
       * window fully. A sum written here would be a second arithmetic over the same rows.
       */
      const byCategory = await summarizeByCategory(admin, orgId, f.from, f.to);
      const spend = byCategory.find((c) => c.category === "maintenance" && c.direction === "out");
      res.json({
        ok: true,
        ...result,
        /** Dollars over the whole window, not over the page. Null is impossible; zero is a real answer. */
        totalAmount: spend?.amount ?? 0,
        /**
         * The page renders this reason verbatim while the store holds nothing — the truth, instead
         * of a mysterious zero.
         *
         * ⚠ **THE SECOND SENTENCE OUTLIVED THE RULING IT DESCRIBED, AND THIS IS THE ONLY PLACE A
         * CUSTOMER COULD READ ONE.** Until 2026-09-10 it said the FleetPal feed "awaits its dedup
         * contract" — true when written on 2026-08-27, false from 2026-09-03, when D-FLEET2 made
         * McLeod's general ledger the entire financial input and took FleetPal out of Finance. There
         * is no second door left for a dedup key to guard. I0 rewrote the module header above on
         * 2026-09-09 and missed this string underneath it: the header is read by us, this sentence
         * is read by the shop, and a ruling nobody can see from the screen decays.
         * FLEETPAL-INTEGRATION-PLAN.md step F0 corrects it, and the replacement is pinned by
         * "says the ledger is the only door, now that FleetPal is not a second one".
         *
         * What replaces it is the standing position rather than a softer version of the old promise:
         * FleetPal work orders are the repair RECORD (D-INV10, D-FP3) and their cost is already in
         * the ledger under the maintenance GL family (D-INV11), so FleetPal will never add a dollar
         * to this figure however the integration lands.
         */
        pendingSources:
          result.total === 0
            ? "Repair spend is not classified yet: McLeod AP repair dollars await finance's GL-account ruling. FleetPal will not add to this figure — its work orders are the repair record, and their cost is already in the ledger."
            : null,
      });
    }),
  );

  return router;
}
