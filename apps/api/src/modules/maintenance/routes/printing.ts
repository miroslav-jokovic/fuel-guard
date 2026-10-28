import { Router, type Response } from "express";
import {
  createPrinterSchema,
  createStationSchema,
  printLabelsSchema,
  setDefaultSchema,
  updatePrinterSchema,
  type CreatePrinterRequest,
  type CreateStationRequest,
  type PrintLabelsRequest,
  type SetDefaultRequest,
  type UpdatePrinterRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { isServiceError, type ServiceError } from "../inventory/types.js";
import { createStation, listStations, renewPairingCode, revokeStation } from "../printing/stations.js";
import { createPrinter, getDefaults, listPrinters, setDefault, updatePrinter } from "../printing/printers.js";
import { cancelJob, listJobs, printLabels } from "../printing/jobs.js";

/**
 * `/api/maintenance/print` — Settings → Devices and the Print button (PRINTERS-AND-SCANNERS-PLAN.md
 * PS2; 0526).
 *
 * ── WHO MAY DO WHAT ──────────────────────────────────────────────────────────────────────────
 * Seeing printers, their status and the job list, and choosing one's OWN default, is `view`: anybody
 * who can open the shop can see why their label did not come out, and pick the printer next to them.
 * Adding a station, naming a printer, setting the ORGANIZATION's default and printing labels are
 * `manage` — printing mints tag codes that are immutable once stuck to a thing, the same class of act
 * as the sheet route in `inventoryLabels.ts`.
 */

const STATUS: Record<string, number> = {
  not_found: 404,
  duplicate_station: 409,
  duplicate_printer: 409,
  job_not_cancellable: 409,
  printer_retired: 422,
  unknown_stock: 422,
  no_printer: 409,
};

function send(res: Response, result: ServiceError): void {
  res.status(STATUS[result.code] ?? 500).json(apiError(result.code, result.error));
}

export function printingRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const ctx = (req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) => ({
    admin: getSupabaseAdmin(getAppLocals(req).env),
    orgId: req.auth!.orgId!,
    userId: req.auth!.userId ?? null,
  });

  // ── Stations ────────────────────────────────────────────────────────────────────────────────

  router.get(
    "/stations",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const { admin, orgId } = ctx(req);
      const result = await listStations(admin, orgId);
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, stations: result });
    }),
  );

  router.post(
    "/stations",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(createStationSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const body = res.locals.body as CreateStationRequest;
      const result = await createStation(admin, orgId, userId, body.name);
      if (isServiceError(result)) return send(res, result);
      await writeAudit(admin, { orgId, actorId: userId, action: "printing.station_added", entity: "print_stations", entityId: result.station.id });
      res.status(201).json({ ok: true, ...result });
    }),
  );

  router.post(
    "/stations/:id/pairing-code",
    requireOrg,
    requireSection("maintenance", "manage"),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const result = await renewPairingCode(admin, orgId, String(req.params.id));
      if (isServiceError(result)) return send(res, result);
      await writeAudit(admin, { orgId, actorId: userId, action: "printing.station_pairing_code", entity: "print_stations", entityId: result.station.id });
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    "/stations/:id/revoke",
    requireOrg,
    requireSection("maintenance", "manage"),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const result = await revokeStation(admin, orgId, String(req.params.id));
      if (isServiceError(result)) return send(res, result);
      await writeAudit(admin, { orgId, actorId: userId, action: "printing.station_revoked", entity: "print_stations", entityId: result.id });
      res.json({ ok: true, station: result });
    }),
  );

  // ── Printers ────────────────────────────────────────────────────────────────────────────────

  router.get(
    "/printers",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const { admin, orgId } = ctx(req);
      const result = await listPrinters(admin, orgId);
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, printers: result });
    }),
  );

  router.post(
    "/printers",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(createPrinterSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const result = await createPrinter(admin, orgId, userId, res.locals.body as CreatePrinterRequest);
      if (isServiceError(result)) return send(res, result);
      res.status(201).json({ ok: true, printer: result });
    }),
  );

  router.patch(
    "/printers/:id",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(updatePrinterSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId } = ctx(req);
      const result = await updatePrinter(admin, orgId, String(req.params.id), res.locals.body as UpdatePrinterRequest);
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, printer: result });
    }),
  );

  // ── Defaults ────────────────────────────────────────────────────────────────────────────────

  router.get(
    "/defaults",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const result = await getDefaults(admin, orgId, userId, "label");
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, defaults: result });
    }),
  );

  // One route, two gates: choosing one's own printer is `view`; the organization's is `manage`.
  router.put(
    "/defaults",
    requireOrg,
    requireSection("maintenance", "view"),
    validateBody(setDefaultSchema),
    asyncHandler(async (req, res, next) => {
      const body = res.locals.body as SetDefaultRequest;
      if (body.scope === "organization") {
        return requireSection("maintenance", "manage")(req, res, async () => {
          try {
            await respondSetDefault(req, res, body);
          } catch (e) {
            next(e);
          }
        });
      }
      await respondSetDefault(req, res, body);
    }),
  );

  async function respondSetDefault(
    req: Parameters<Parameters<typeof asyncHandler>[0]>[0],
    res: Response,
    body: SetDefaultRequest,
  ): Promise<void> {
    const { admin, orgId, userId } = ctx(req);
    if (!userId) {
      res.status(401).json(apiError("unauthorized", "Sign in again."));
      return;
    }
    const result = await setDefault(admin, orgId, userId, body);
    if (isServiceError(result)) return send(res, result);
    res.json({ ok: true, defaults: result });
  }

  // ── Jobs ────────────────────────────────────────────────────────────────────────────────────

  router.get(
    "/jobs",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const { admin, orgId } = ctx(req);
      const result = await listJobs(admin, orgId);
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, jobs: result });
    }),
  );

  router.post(
    "/jobs/:id/cancel",
    requireOrg,
    requireSection("maintenance", "manage"),
    asyncHandler(async (req, res) => {
      const { admin, orgId } = ctx(req);
      const result = await cancelJob(admin, orgId, String(req.params.id));
      if (isServiceError(result)) return send(res, result);
      res.json({ ok: true, job: result });
    }),
  );

  /** Print labels on the default printer — or the one named — without asking. */
  router.post(
    "/labels",
    requireOrg,
    requireSection("maintenance", "manage"),
    validateBody(printLabelsSchema),
    asyncHandler(async (req, res) => {
      const { admin, orgId, userId } = ctx(req);
      const result = await printLabels(admin, orgId, userId, res.locals.body as PrintLabelsRequest);
      if (isServiceError(result)) return send(res, result);
      // Audited for the reason the PDF sheet is (inventoryLabels.ts): who printed labels for what.
      await writeAudit(admin, {
        orgId,
        actorId: userId,
        action: "maintenance.labels_printed",
        entity: "print_jobs",
        entityId: result.job.id,
        meta: { count: result.job.labelCount, dropped: result.dropped, printer: result.job.printerId },
      });
      res.status(202).json({ ok: true, job: result.job, dropped: result.dropped });
    }),
  );

  return router;
}
