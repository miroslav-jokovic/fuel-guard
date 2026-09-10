import { Router } from "express";
import { LABEL_PRESETS, LABEL_PRESET_IDS, type LabelPresetId } from "@silvicom/qr";
import {
  labelFacesRequestSchema,
  labelRunSchema,
  type LabelFacesRequest,
  type LabelRun,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { resolveLabelFaces } from "../inventory/labels.js";
import { renderLabelSheet } from "../inventory/labelPdf.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/labels` — issuing tags and printing sheets (INVENTORY-PLAN.md I10).
 *
 * ── BOTH ROUTES ARE POSTs, AND THE SHEET IS ONE TOO ───────────────────────────────────────────
 * A sheet reads like a GET and is not one, for two independent reasons. It WRITES — resolving a run
 * issues a tag code to anything without one, which `labels.ts` argues at length is the only ordering
 * that cannot print a code nobody stored. And its input is a list of up to 240 targets, which is a
 * request body rather than a query string in any case.
 *
 * ── THE PRESET IS VALIDATED HERE, NOT IN THE CONTRACT ─────────────────────────────────────────
 * `labelRunSchema.presetId` is a bounded string because `@silvicom/shared` is compiled for React
 * Native and must not pull `@silvicom/qr` (and `uqr`) into the driver bundle for a screen the driver
 * app does not have — `inventoryLabelContract.ts` carries that argument. The real enum lives with
 * the geometry it names, and this is the edge where importing it is free. So the id is checked
 * against `LABEL_PRESET_IDS` here, and the start position against the preset's OWN capacity: a
 * 24-up sheet has no position 30, and `labelSheet()` would throw rather than answer.
 *
 * ── GATED `manage`, WHERE THE READ SIDE OF THIS MODULE IS GATED `view` ────────────────────────
 * Printing a label is not looking at one. It mints an identifier that gets stuck to a physical
 * object and is then immutable — 0333 refuses to change an asset's tag for the service role too —
 * so it is the same class of act as recording a movement, and it answers to the same permission.
 */

function presetOrNull(id: string): LabelPresetId | null {
  return (LABEL_PRESET_IDS as readonly string[]).includes(id) ? (id as LabelPresetId) : null;
}

export function inventoryLabelsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * The presets, so the label screen can name the stock rather than hard-coding five titles.
   *
   * `material` is the field that earns this route: §2.4 measured that adhesive paper fails in 60–90
   * days in a shop, and the screen says so at the moment somebody is choosing what to print onto —
   * which is the only moment that advice can change an outcome.
   */
  router.get(
    "/presets",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (_req, res) => {
      res.json({
        ok: true,
        presets: LABEL_PRESET_IDS.map((id) => {
          const p = LABEL_PRESETS[id];
          return {
            id: p.id,
            name: p.name,
            perSheet: p.columns * p.rows,
            material: p.material,
            label: p.label,
            sheet: p.sheet,
          };
        }),
      });
    }),
  );

  /**
   * What would be printed — the preview's read, which is also a write. See `labels.ts`.
   *
   * It takes no preset: the faces are what goes ON a label and the preset decides where the labels
   * go, and keeping them apart is what lets the screen change the stock without re-issuing anything.
   */
  router.post(
    "/faces",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(labelFacesRequestSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as LabelFacesRequest;
      const result = await resolveLabelFaces(admin, orgId, body.targets);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, faces: result.faces, dropped: result.dropped });
    }),
  );

  /**
   * The sheet itself.
   *
   * Audited, unlike the faces route above, and the split is deliberate: a preview that a technician
   * opened and closed is not an event anybody needs six months from now, while "who printed labels
   * for these forty things, and when" is exactly the question asked when two objects turn out to
   * carry the same code. The audit row names the count and the stock, not the codes — the codes are
   * already on the rows, and duplicating them into an audit payload would be a second place to read
   * an identifier from.
   */
  router.post(
    "/sheet",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(labelRunSchema),
    asyncHandler(async (req, res) => {
      const run = res.locals.body as LabelRun;
      const presetId = presetOrNull(run.presetId);
      if (!presetId) {
        res.status(422).json(apiError("unknown_preset", "That label stock is not one we can print."));
        return;
      }
      const preset = LABEL_PRESETS[presetId];
      const perSheet = preset.columns * preset.rows;
      if (run.startPosition !== undefined && run.startPosition > perSheet) {
        res
          .status(422)
          .json(
            apiError(
              "start_position_out_of_range",
              `${preset.name} has ${perSheet} labels to a sheet, so there is no position ${run.startPosition}.`,
            ),
          );
        return;
      }

      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const result = await resolveLabelFaces(admin, orgId, run.targets);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }

      const pdf = await renderLabelSheet(result.faces, {
        presetId,
        startPosition: run.startPosition,
        nudge:
          run.nudgeX !== undefined || run.nudgeY !== undefined
            ? { x: run.nudgeX ?? 0, y: run.nudgeY ?? 0 }
            : undefined,
      });

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId ?? null,
        action: "maintenance.labels_printed",
        entity: "inventory_labels",
        // No `entityId`: a print run is not a row, and `writeAudit` rejects anything that is not a
        // uuid anyway. The preset travels in `meta`, where it is a fact about the run rather than a
        // pointer to a record that does not exist.
        meta: { count: result.faces.length, dropped: result.dropped, preset: presetId },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="labels-${presetId}.pdf"`);
      res.setHeader("X-Silvicom-Label-Count", String(result.faces.length));
      res.send(pdf);
    }),
  );

  return router;
}
