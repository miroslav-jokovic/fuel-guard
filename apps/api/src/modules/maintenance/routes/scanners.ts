import { Router, type Response } from "express";
import { z } from "zod";
import {
  createScannerSchema,
  recordId,
  releaseScannerSchema,
  takeScannerSchema,
  updateScannerSchema,
  type CreateScannerRequest,
  type ReleaseScannerRequest,
  type TakeScannerRequest,
  type UpdateScannerRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { isServiceError, type ServiceError } from "../inventory/types.js";
import { createScanner, listScanners, listStationPorts, releaseScanner, takeScanner, updateScanner, waitForReads } from "../printing/scanners.js";

/**
 * `/api/maintenance/scanners` — a scanner on one PC, used from any device (SCANNER-RELAY-PLAN.md SR2).
 *
 * ── WHO MAY DO WHAT (D-SR9) ──────────────────────────────────────────────────────────────────
 * Seeing the scanners, holding one and receiving its reads is `view` — the Scan page's own gate
 * (`maintenance.scan`, `section("maintenance")`), so the relay never needs more rights than the page
 * it feeds. Adding, renaming, moving and retiring a scanner is `manage`, as for printers.
 *
 * ── THE WAIT ─────────────────────────────────────────────────────────────────────────────────
 * `GET /:id/reads` holds up to `WAIT_MS` and is called again at once, as the station's job poll is.
 * One request per 25 s per tab holding a scanner — well inside the office's per-address budget —
 * and a read reaches the page within half a second of the station sending it.
 */

export const WAIT_MS = 25_000;
const POLL_EVERY_MS = 500;
const HOLDER_CHECK_EVERY_MS = 5_000;

const STATUS: Record<string, number> = {
  not_found: 404,
  duplicate_scanner: 409,
  duplicate_port: 409,
};

function send(res: Response, result: ServiceError): void {
  res.status(STATUS[result.code] ?? 500).json(apiError(result.code, result.error));
}

const waitQuerySchema = z.object({
  session: recordId(),
  after: z.coerce.number().int().min(0).default(0),
});

export function scannersRouter(options: { waitMs?: number; pollEveryMs?: number; holderCheckEveryMs?: number } = {}): Router {
  const router = Router();
  router.use(requireAuth);

  const ctx = (req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) => ({
    admin: getSupabaseAdmin(getAppLocals(req).env),
    orgId: req.auth!.orgId!,
    userId: req.auth!.userId ?? null,
  });

  router.get(
    "/",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const result = await listScanners(admin, orgId, userId);
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, scanners: result });
    }),
  );

  router.get(
    "/ports",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const { admin, orgId } = ctx(req);
      const result = await listStationPorts(admin, orgId);
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, stations: result });
    }),
  );

  router.post(
    "/",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(createScannerSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const result = await createScanner(admin, orgId, userId, res.locals.body as CreateScannerRequest);
      if (isServiceError(result)) return send(res, result);
      await writeAudit(admin, { orgId, actorId: userId, action: "printing.scanner_added", entity: "scanners", entityId: result.id });
      res.status(201).json({ ok: true, id: result.id });
    }),
  );

  router.patch(
    "/:id",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(updateScannerSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const patch = res.locals.body as UpdateScannerRequest;
      const result = await updateScanner(admin, orgId, String(req.params.id), patch);
      if (isServiceError(result)) return send(res, result);
      await writeAudit(admin, {
        orgId,
        actorId: userId,
        action: patch.retired ? "printing.scanner_retired" : "printing.scanner_updated",
        entity: "scanners",
        entityId: result.id,
      });
      res.json({ ok: true, id: result.id });
    }),
  );

  router.post(
    "/:id/take",
    requireOrg,
    requireSection("maintenance", "view"),
    validateBody(takeScannerSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      if (!userId) return send(res, { code: "not_found", error: "Sign in to use a scanner." });
      const body = res.locals.body as TakeScannerRequest;
      const result = await takeScanner(admin, orgId, userId, String(req.params.id), body.session, body.force);
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    "/:id/release",
    requireOrg,
    requireSection("maintenance", "view"),
    validateBody(releaseScannerSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      if (!userId) return send(res, { code: "not_found", error: "Sign in to use a scanner." });
      const body = res.locals.body as ReleaseScannerRequest;
      const error = await releaseScanner(admin, orgId, userId, String(req.params.id), body.session);
      if (error) return send(res, error);
      res.json({ ok: true });
    }),
  );

  router.get(
    "/:id/reads",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      if (!userId) return send(res, { code: "not_found", error: "Sign in to use a scanner." });
      const query = waitQuerySchema.safeParse(req.query);
      if (!query.success) {
        res.status(400).json(apiError("invalid_query", "A tab id is required."));
        return;
      }
      // The response's close, not the request's: a request with no body can report "close" as soon
      // as it has been read, while the response closing before it ended is the browser hanging up.
      let gone = false;
      res.on("close", () => {
        if (!res.writableEnded) gone = true;
      });
      const result = await waitForReads(admin, orgId, userId, String(req.params.id), query.data.session, query.data.after, {
        waitMs: options.waitMs ?? WAIT_MS,
        pollEveryMs: options.pollEveryMs ?? POLL_EVERY_MS,
        holderCheckEveryMs: options.holderCheckEveryMs ?? HOLDER_CHECK_EVERY_MS,
        gone: () => gone,
      });
      if (gone) return;
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}
