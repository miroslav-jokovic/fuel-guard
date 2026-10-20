import { Router } from "express";
import {
  isCalendarDay,
  roadsideAttributionDecisionSchema,
  roadsideDocumentRegisterSchema,
  roadsideRepairCertifySchema,
  roadsideRepairDecisionSchema,
  shiftDay,
  type CalendarDay,
  type RoadsideSummary,
  VIOLATION_CATEGORY_NAMES,
  roadsideStats,
  recordId,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readRoadsideInspections } from "../read/inspectionsList.js";
import { readRoadsideInspection } from "../read/inspectionDetail.js";
import { readRoadsideFeed } from "../feed/store.js";
import { decideAttribution } from "../attribution/decide.js";
import { readInspectionRepairs, readRepairCertification } from "../read/inspectionRepairs.js";
import { readRepairsDue } from "../read/repairsDue.js";
import { readInspectionsWork } from "../read/inspectionsWork.js";
import { orgToday } from "../read/orgToday.js";
import { citationRoutes } from "./citations.js";
import { decideRepair } from "../repair/decide.js";
import { certifyRepairs } from "../repair/certify.js";
import { listInspectionDocuments, registerInspectionDocument, signInspectionDocumentDownload } from "../documents/inspectionDocuments.js";

/**
 * `GET /api/roadside-inspections` — the Inspections inbox's first slice — `/:id`, the inspection a
 * row opens, and `/summary`, the Operations tab's Roadside card (INSPECTION-CHALLENGE-PLAN §6, D-IC12:
 * the `safety` section; FLEET-MANAGER-HOME-PLAN FM5, Q-FM7 (a)). The two writes need the section's manage
 * level: `POST /:id/attribution`, a person confirming or correcting who was driving (IC5,
 * `attribution/decide.ts`), and `POST /:id/documents`, filing the ticket, the court's result or the
 * officer's copy (IC2, `documents/inspectionDocuments.ts`). Nothing here is a case or a filing yet.
 *
 * The repair record (IC11, D-IC14) is read on the safety section like the rest of the page, but DECIDED on
 * the maintenance section's manage level (`POST /:id/repairs`): Q-IC13 ruled that maintenance names THE
 * work order and safety certifies. A technician holds maintenance but not safety and so cannot open this
 * page — their way to the same decision is a maintenance-side list of repairs due (plan §8, IC11 B2).
 * Safety then certifies the report (`POST /:id/repairs/certify`, 396.9(d)(3)(i), `repair/certify.ts`) on its
 * own manage level, which files the rendered repair record on the Documents card.
 *
 * ── THE CARD'S WINDOW IS CUT ON THE CARRIER'S CALENDAR, HERE ───────────────────────────────────
 * "Last 90 days" ends on today in the org zone, not on the server's (UTC on Railway, so a Chicago
 * evening would already be tomorrow). The answer names its first day (`from`), and the page asks for
 * the same window with `roadsidePeriodStart` on its own clock, so the page's row count is the card's
 * figure (D-FM7) — the summary is that list's rows counted by `summarizeRoadside`, not a second query.
 */

/**
 * `?from=&to=` as calendar days, either optional. `isCalendarDay` is shape only; a day that does not exist
 * (02-31) would reach Postgres and come back a 500, so each must also survive a round trip through the calendar.
 */
function dayRange(q: Record<string, unknown>): { from: CalendarDay | null; to: CalendarDay | null } | { error: string } {
  const out: { from: CalendarDay | null; to: CalendarDay | null } = { from: null, to: null };
  for (const key of ["from", "to"] as const) {
    const v = typeof q[key] === "string" ? (q[key] as string) : null;
    if (v !== null && (!isCalendarDay(v) || shiftDay(v, 0) !== v)) return { error: `${key} must be a calendar day, YYYY-MM-DD.` };
    out[key] = v;
  }
  if (out.from && out.to && out.from > out.to) return { error: "from must not be after to." };
  return out;
}

export function roadsideInspectionsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);
  const canView = requireSection("safety", "view");

  /**
   * The Roadside card's answer over `?from=&to=` (IC16): the statistics of that range's inspections, from the
   * list and the work lines the Roadside inspections page reads, through `roadsideStats` — so the card's every
   * figure is a list the page shows. No range: the last 30 days, the Operations tab's own default.
   */
  router.get(
    "/summary",
    canView,
    asyncHandler(async (req, res) => {
      const range = dayRange(req.query);
      if ("error" in range) {
        res.status(400).json(apiError("bad_request", range.error));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const today = await orgToday(admin, orgId);
      const from = range.from ?? shiftDay(today, -30);
      const to = range.to ?? today;
      const [rows, work] = await Promise.all([
        readRoadsideInspections(admin, orgId, { from, to }),
        readInspectionsWork(admin, orgId, { from, to, today }),
      ]);
      if ("error" in rows || "error" in work) {
        dbErrorResponse(res, "roadside-inspections.summary", ("error" in rows ? rows : (work as { error: { message: string } })).error, "Could not load the roadside inspections");
        return;
      }
      const stats = roadsideStats(rows, new Map(work.map((w) => [w.id, w])), (id) => VIOLATION_CATEGORY_NAMES[id] ?? String(id));
      const data: RoadsideSummary = { from, to, stats, feed: await readRoadsideFeed(admin, orgId, Date.now()) };
      res.json({ ok: true, data });
    }),
  );

  /** How current our copy of FMCSA's record is (IC1c) — the list's line above its rows, without the card's statistics. */
  router.get(
    "/feed",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ ok: true, data: await readRoadsideFeed(admin, req.auth!.orgId!, Date.now()) });
    }),
  );

  /** The whole list from `?from=` (or the whole record), unpaginated: a list that stopped early would be believed. */
  router.get(
    "/",
    canView,
    asyncHandler(async (req, res) => {
      const range = dayRange(req.query);
      if ("error" in range) {
        res.status(400).json(apiError("bad_request", range.error));
        return;
      }
      const rows = await readRoadsideInspections(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, {
        ...range,
        withUnits: true,
      });
      if ("error" in rows) {
        dbErrorResponse(res, "roadside-inspections.list", rows.error, "Could not load the roadside inspections");
        return;
      }
      res.json({ ok: true, data: rows });
    }),
  );

  /**
   * One line of work per inspection from `?from=` (the inbox's period): its open steps, driver and CSA points
   * (Q-IC17, IC15). Its own read so the list draws without waiting on it. Declared before `/:id`.
   */
  router.get(
    "/work",
    canView,
    asyncHandler(async (req, res) => {
      const range = dayRange(req.query);
      if ("error" in range) {
        res.status(400).json(apiError("bad_request", range.error));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const out = await readInspectionsWork(admin, orgId, { ...range, today: await orgToday(admin, orgId) });
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.work", out.error, "Could not work out what is left on the roadside inspections");
        return;
      }
      res.json({ ok: true, data: out });
    }),
  );

  /**
   * Every violated unit of the last year with its inspection — the Shop's "Roadside repairs due" (Q-IC16 (a)).
   * On the MAINTENANCE section, not safety: it is the technician's way to the decision, and the inspection
   * page it complements is the one they cannot open. Declared before `/:id` for the same reason as `/summary`.
   */
  router.get(
    "/repairs-due",
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const out = await readRepairsDue(admin, orgId, await orgToday(admin, orgId));
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.repairs-due", out.error, "Could not load the roadside repairs");
        return;
      }
      res.json({ ok: true, data: out });
    }),
  );

  /** One inspection, the row the list opens. Declared after `/summary`, which would otherwise read as an id. */
  router.get(
    "/:id",
    canView,
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const found = await readRoadsideInspection(admin, orgId, id.data, await orgToday(admin, orgId));
      if (found && "error" in found) {
        dbErrorResponse(res, "roadside-inspections.detail", found.error, "Could not load the roadside inspection");
        return;
      }
      if (!found) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      res.json({ ok: true, data: found });
    }),
  );

  /** The inspection's paper (IC2), newest first. Its own read: the signed URLs live five minutes and the page caches the inspection for ten. */
  router.get(
    "/:id/documents",
    canView,
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const out = await listInspectionDocuments(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, id.data);
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.documents", out.error, "Could not load the inspection's documents");
        return;
      }
      if (!out.ok) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.json({ ok: true, data: out.data });
    }),
  );

  /** One document as a download (the viewer's button). Its own route: the DQ file's is gated on `roster`. */
  router.get(
    "/:id/documents/:documentId/download",
    canView,
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      const documentId = recordId().safeParse(req.params.documentId);
      if (!id.success || !documentId.success) {
        res.status(404).json(apiError("not_found", "That document is not on file for this inspection."));
        return;
      }
      const out = await signInspectionDocumentDownload(
        getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, id.data, documentId.data, req.auth!.userId,
      );
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.document-download", out.error, "Could not sign the download");
        return;
      }
      if (!out.ok) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.json(out.data);
    }),
  );

  router.post(
    "/:id/documents",
    requireSection("safety"),
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const body = roadsideDocumentRegisterSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(apiError("bad_request", body.error.issues[0]?.message ?? "Invalid document"));
        return;
      }
      const { env } = getAppLocals(req);
      const out = await registerInspectionDocument(getSupabaseAdmin(env), env, req.auth!.orgId!, id.data, req.auth!.userId, body.data);
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.document-register", out.error, "Could not file the document");
        return;
      }
      if (!out.ok) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.status(201).json({ ok: true, data: out.data });
    }),
  );

  /** The repair record of the inspection's vehicle violations (IC11): one entry per violated unit the engine has read. */
  router.get(
    "/:id/repairs",
    canView,
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const out = await readInspectionRepairs(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, id.data);
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.repairs", out.error, "Could not load the repair record");
        return;
      }
      res.json({ ok: true, data: out });
    }),
  );

  router.post(
    "/:id/repairs",
    requireSection("maintenance"),
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const body = roadsideRepairDecisionSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(apiError("bad_request", body.error.issues[0]?.message ?? "Invalid decision"));
        return;
      }
      const out = await decideRepair(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, id.data, req.auth!.userId, body.data);
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.repair-decide", out.error, "Could not record the repair");
        return;
      }
      if (!out.ok) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.status(201).json({ ok: true, data: { id: out.id } });
    }),
  );

  /** The newest certification and whether it still stands over the record (IC11 B2); `null` before the first. */
  router.get(
    "/:id/repairs/certification",
    canView,
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const out = await readRepairCertification(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, id.data);
      if (out && "error" in out) {
        dbErrorResponse(res, "roadside-inspections.repair-certification", out.error, "Could not load the certification");
        return;
      }
      res.json({ ok: true, data: out });
    }),
  );

  router.post(
    "/:id/repairs/certify",
    requireSection("safety"),
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const body = roadsideRepairCertifySchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(apiError("bad_request", body.error.issues[0]?.message ?? "Invalid certification"));
        return;
      }
      const out = await certifyRepairs(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, id.data, req.auth!.userId, body.data);
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.repair-certify", out.error, "Could not certify the repairs");
        return;
      }
      if (!out.ok) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.status(201).json({ ok: true, data: out.data });
    }),
  );

  citationRoutes(router, canView);

  router.post(
    "/:id/attribution",
    requireSection("safety"),
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const body = roadsideAttributionDecisionSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(apiError("bad_request", body.error.issues[0]?.message ?? "Invalid decision"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const out = await decideAttribution(admin, req.auth!.orgId!, id.data, req.auth!.userId, body.data);
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.attribution", out.error, "Could not record the decision");
        return;
      }
      if (!out.ok) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.status(201).json({ ok: true, data: { id: out.id } });
    }),
  );

  return router;
}
