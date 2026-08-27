/**
 * The exception ledger's routes (F6a).
 *
 * A finding is produced by a detector and moved by a person, and neither happens from a browser:
 * `fuel_exceptions` has no client write policy, so every lifecycle move comes through here and is
 * recorded in the append-only act log in the same breath. That pairing is what makes "who closed a
 * $9,000 dispute, and when" a question with an answer.
 */
import type { Router } from "express";
import { requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  FUEL_EXCEPTION_KINDS, FUEL_EXCEPTION_STATUSES,
  type FuelExceptionStatus,
} from "@silvicom/shared";
import { exceptionTotals, listExceptions, moveException, readException } from "../fuelExceptions.js";
import { renderDisputePacket } from "../fuelDisputePacket.js";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Express 5 types a route param as `string | string[] | undefined`; an id here is one value. */
const param = (v: unknown): string => (typeof v === "string" ? v : "");

/** Split a repeated query parameter and keep only the values the vocabulary admits. */
const closedSet = <T extends string>(raw: unknown, allowed: readonly T[]): T[] | null => {
  const parts = (typeof raw === "string" ? raw.split(",") : []).map((s) => s.trim()).filter(Boolean);
  const kept = parts.filter((p): p is T => (allowed as readonly string[]).includes(p));
  return kept.length ? kept : null;
};
const ymd = (raw: unknown): string | null => (typeof raw === "string" && YMD.test(raw) ? raw : null);

export function registerExceptionRoutes(router: Router): void {
  router.get(
    "/exceptions",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { rows, total } = await listExceptions(admin, req.auth!.orgId!, {
        status: closedSet(req.query.status, FUEL_EXCEPTION_STATUSES),
        kind: closedSet(req.query.kind, FUEL_EXCEPTION_KINDS),
        assignedTo: typeof req.query.assignedTo === "string" && UUID.test(req.query.assignedTo) ? req.query.assignedTo : null,
        from: ymd(req.query.from),
        to: ymd(req.query.to),
        limit: Number(req.query.limit) || 50,
        offset: Number(req.query.offset) || 0,
      });
      res.json({ ok: true, exceptions: rows, total });
    }),
  );

  /** identified / claimed / recovered — three numbers, never one (E3). */
  router.get(
    "/exceptions/totals",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const totals = await exceptionTotals(admin, req.auth!.orgId!, { from: ymd(req.query.from), to: ymd(req.query.to) });
      res.json({ ok: true, totals });
    }),
  );

  /**
   * The document you send the vendor (E2). Rendered from `fuel_exceptions` rather than from whatever
   * the browser was showing: a figure in a dispute packet is quoted back months later, so it comes
   * from the records the finding was written to.
   *
   * Declared BEFORE `/exceptions/:id` — Express matches in order, and `packet.pdf` would otherwise be
   * read as an id and answer 404.
   */
  router.get(
    "/exceptions/packet.pdf",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const ids = (typeof req.query.ids === "string" ? req.query.ids.split(",") : [])
        .map((s) => s.trim())
        .filter((s) => UUID.test(s))
        .slice(0, 500);
      if (ids.length === 0) {
        res.status(400).json(apiError("bad_request", "Name the findings to claim, as a comma-separated list of ids."));
        return;
      }
      const { pdf, lines, total } = await renderDisputePacket(admin, {
        orgId: req.auth!.orgId!,
        ids,
        generatedBy: req.auth!.userId,
        generatedAt: new Date().toISOString(),
      });
      await writeAudit(admin, {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        action: "export.generated",
        entity: "fuel_exceptions",
        meta: { report: "dispute-packet.pdf", lines, total },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="fuel-dispute-packet.pdf"`);
      res.send(pdf);
    }),
  );

  router.get(
    "/exceptions/:id",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const found = await readException(admin, req.auth!.orgId!, param(req.params.id));
      if (!found) {
        res.status(404).json(apiError("not_found", "No such exception."));
        return;
      }
      res.json({ ok: true, ...found });
    }),
  );

  /**
   * Move a finding. Dispatchers read the ledger and do not move it: a disposition on a billing dispute
   * is a decision with money attached, and the section matrix puts that with the people who own it.
   */
  router.patch(
    "/exceptions/:id",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const body = req.body as Record<string, unknown>;

      const status = typeof body?.status === "string" && (FUEL_EXCEPTION_STATUSES as readonly string[]).includes(body.status)
        ? (body.status as FuelExceptionStatus)
        : undefined;
      if (body?.status !== undefined && !status) {
        res.status(400).json(apiError("bad_request", "That is not a status a finding can be in."));
        return;
      }
      // `resolved_by_reingest` is the DETECTOR's answer — "it stopped appearing" — and a person
      // claiming it would erase the difference between that and a decision.
      if (status === "resolved_by_reingest") {
        res.status(400).json(apiError("bad_request", "Only a later reconciliation can close a finding that way."));
        return;
      }

      const result = await moveException(admin, req.auth!.orgId!, param(req.params.id), req.auth!.userId, {
        status,
        assignedTo: body?.assignedTo === undefined
          ? undefined
          : typeof body.assignedTo === "string" && UUID.test(body.assignedTo) ? body.assignedTo : null,
        note: typeof body?.note === "string" ? body.note.slice(0, 4000) : undefined,
        creditedAmount: body?.creditedAmount == null ? null : Number(body.creditedAmount) || 0,
        creditedOn: ymd(body?.creditedOn),
      });
      if (!result.ok) {
        res.status(result.error?.startsWith("No such") ? 404 : 400).json(apiError("bad_request", result.error ?? "Could not move that finding."));
        return;
      }

      await writeAudit(admin, {
        orgId: req.auth!.orgId!,
        actorId: req.auth!.userId,
        action: "fuel.exception_moved",
        entity: "fuel_exceptions",
        entityId: param(req.params.id),
        meta: { status: status ?? null, assigned: body?.assignedTo ?? null, credited: body?.creditedAmount ?? null },
      });
      res.json({ ok: true, exception: result.exception });
    }),
  );
}
