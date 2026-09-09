import { Router } from "express";
import { z } from "zod";
import { countSessionInputSchema } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import {
  closeCountSession,
  getCountSession,
  listCountSessions,
  openCountSession,
} from "../inventory/countSessions.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/count-sessions` — the walks (INVENTORY-PLAN.md step I5, PR 2a).
 *
 * ── CLOSING IS A NAMED VERB, NOT A `PATCH` ─────────────────────────────────────────────────────
 * `PATCH /:id` would advertise a general edit, and 0332's trigger refuses every edit but this one:
 * the place, the counter and the blind flag are fixed once the walk exists, because a variance is
 * only readable against the conditions it was recorded under. A route shaped like a general update
 * would be a promise the database spends its life breaking — the same reasoning that made the six
 * movement verbs six routes rather than one `POST /movements` with a reason.
 *
 * ── NOTHING HERE WRITES `audit_logs`, AND THAT IS DELIBERATE ───────────────────────────────────
 * The same call the movement routes make. A session records who opened it, when, whether it was
 * blind and when it closed; its entries are `counted` rows in an append-only ledger. A second row
 * in `audit_logs` per walk would restate what the walk already says, and worse than the movements
 * case — there the duplication was merely wasteful, here the audit row would carry LESS than the
 * thing it describes. Creating a PART is audited because the catalogue is not itself a record.
 */

const listSchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  kind: z.enum(["location", "unit"]).optional(),
  locationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const closeSchema = z.object({ note: z.string().trim().max(2000).nullable().optional() });

export function inventoryCountSessionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("maintenance", "view");
  const canManage = requireSection("maintenance");

  router.get(
    "/",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listCountSessions(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  router.get(
    "/:id",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await getCountSession(admin, req.auth!.orgId!, String(req.params.id ?? ""));
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That count is not on file."));
        return;
      }
      res.json({ ok: true, session: result });
    }),
  );

  /**
   * Open a walk. 201 with the session, because the caller navigates to it by id.
   *
   * ⚠ The id is the SERVER's, and the body carries none — the opposite of a movement, where D-INV27
   * makes the CLIENT's UUID the idempotency key because a movement is what a phone queues in a dead
   * bay. A session is opened with the network up, since the screen cannot show what to count without
   * it, and accepting a client id would let two taps of Start produce two walks of one bay.
   */
  router.post(
    "/",
    requireOrg,
    canManage,
    validateBody(countSessionInputSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await openCountSession(
        admin,
        req.auth!.orgId!,
        req.auth!.userId,
        res.locals.body as z.infer<typeof countSessionInputSchema>,
      );
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.status(201).json({ ok: true, session: result });
    }),
  );

  /**
   * Close a walk. Irreversible — 0332's trigger refuses a second close with `IV017`, which
   * `httpStatus.ts` maps to 409, so a phone that closed and then retried reads "already closed"
   * rather than "something went wrong".
   */
  router.post(
    "/:id/close",
    requireOrg,
    canManage,
    validateBody(closeSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { note } = res.locals.body as z.infer<typeof closeSchema>;
      const result = await closeCountSession(
        admin,
        req.auth!.orgId!,
        String(req.params.id ?? ""),
        note,
      );
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That count is not on file."));
        return;
      }
      res.json({ ok: true, session: result });
    }),
  );

  return router;
}
