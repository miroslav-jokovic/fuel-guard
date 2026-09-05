/**
 * The exception ledger's routes (F6a).
 *
 * A finding is produced by a detector and moved by a person, and neither happens from a browser:
 * `fuel_exceptions` has no client write policy, so every lifecycle move comes through here and is
 * recorded in the append-only act log in the same breath. That pairing is what makes "who closed a
 * $9,000 dispute, and when" a question with an answer.
 */
import type { Router } from "express";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  FUEL_EXCEPTION_KINDS, FUEL_EXCEPTION_STATUSES,
  type FuelExceptionStatus,
} from "@silvicom/shared";
import { exceptionTotals, listExceptions, moveException, readException } from "../fuelExceptions.js";
import { exportExceptions } from "../fuelExceptionExport.js";
import { renderDisputePacket } from "../fuelDisputePacket.js";
import { ExportTooLargeError, MAX_EXPORT_ROWS } from "../../../lib/csvExport.js";

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

/**
 * The trucks a ledger request names, resolved from vehicle ids to the UNIT NUMBERS the findings carry
 * (FUEL-P3, D-FUI17).
 *
 * ── WHY THE PARAMETER IS IDS AND THE FILTER IS UNITS ────────────────────────────────────────────
 * The page's truck filter is `useSpendFilters`' `?trucks=`, a list of vehicle ids, shared with the
 * spend page and the spend report — one vocabulary for "which trucks" across the section. The LEDGER
 * keys on `unit_number`, because that is what the producer writes and `fuel_exceptions.vehicle_id` has
 * never been written at all (see `ExceptionFilters.unitNumbers`). Resolving here rather than changing
 * either end keeps one truck vocabulary on the wire and one truth in the table.
 *
 * ⚠ Ids that resolve to nothing return an EMPTY list, not null: a link naming trucks this org does not
 * have must answer with no findings, never with everybody's. A UUID list is validated before it
 * reaches a service-role query, which is the only tenant boundary this code has.
 */
async function unitsForVehicles(
  admin: ReturnType<typeof getSupabaseAdmin>,
  orgId: string,
  raw: unknown,
): Promise<string[] | null> {
  const ids = (typeof raw === "string" ? raw.split(",") : [])
    .map((s) => s.trim())
    .filter((s) => UUID.test(s))
    .slice(0, 500);
  if (ids.length === 0) return null;
  const { data, error } = await admin.from("vehicles").select("unit_number").eq("org_id", orgId).in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => (v as { unit_number: string }).unit_number).filter(Boolean);
}

/**
 * ⚠ Role gates here are DERIVED, never listed (FUEL-T2, D-FUI12, 2026-09-01). This is the surface the
 * 2026-08-27 audit named (D-SEP10) and the one where the cost was visible: `accountant` and `auditor`
 * hold `fuel: "view"` in `SECTION_ACCESS`, so the nav offered them this ledger, the route is
 * `requiresAuth` so the page loaded — and then the API answered 403, because the hand-written list
 * said `admin, fleet_manager, dispatcher`. The nav, the router and the API each held their own
 * opinion about one question.
 *
 * Reads take `rolesThatCanView("fuel")`, writes take `rolesThatManage("fuel")`, and nobody gained a
 * write: the manage set IS `admin, fleet_manager`, which is what the PATCH already said. What changed
 * is that a dispatcher's read is now a consequence of the matrix rather than a coincidence of a list,
 * and `accountant`, `auditor` and `safety_manager` stopped being refused a page they were shown.
 *
 * `GET /exceptions/packet.pdf` widened further than the audit finding named — it was
 * `admin, fleet_manager` and is now the view set. Deliberate: producing the packet reads findings the
 * caller may already read and writes no business row, and an accountant is exactly who assembles a
 * claim. Deciding a finding's outcome is the PATCH below, and that stayed where it was.
 */
export function registerExceptionRoutes(router: Router): void {
  router.get(
    "/exceptions",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { rows, total } = await listExceptions(admin, req.auth!.orgId!, {
        status: closedSet(req.query.status, FUEL_EXCEPTION_STATUSES),
        kind: closedSet(req.query.kind, FUEL_EXCEPTION_KINDS),
        assignedTo: typeof req.query.assignedTo === "string" && UUID.test(req.query.assignedTo) ? req.query.assignedTo : null,
        unitNumbers: await unitsForVehicles(admin, req.auth!.orgId!, req.query.vehicles),
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
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const totals = await exceptionTotals(admin, req.auth!.orgId!, {
        from: ymd(req.query.from),
        to: ymd(req.query.to),
        // The tiles take the same truck and owner scope the list takes, or they answer a different
        // question from the rows beneath them.
        unitNumbers: await unitsForVehicles(admin, req.auth!.orgId!, req.query.vehicles),
        assignedTo: typeof req.query.assignedTo === "string" && UUID.test(req.query.assignedTo) ? req.query.assignedTo : null,
      });
      res.json({ ok: true, totals });
    }),
  );

  /**
   * The filtered ledger as a spreadsheet (FUEL-P2/P3).
   *
   * Declared BEFORE `/exceptions/:id` for the reason the packet route gives: Express matches in order,
   * and `export.csv` would otherwise be read as an id and answer 404.
   *
   * A read, so it takes the view set — an accountant assembling a claim is exactly who needs it.
   */
  router.get(
    "/exceptions/export.csv",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const filters = {
        status: closedSet(req.query.status, FUEL_EXCEPTION_STATUSES),
        kind: closedSet(req.query.kind, FUEL_EXCEPTION_KINDS),
        assignedTo: typeof req.query.assignedTo === "string" && UUID.test(req.query.assignedTo) ? req.query.assignedTo : null,
        unitNumbers: await unitsForVehicles(admin, orgId, req.query.vehicles),
        from: ymd(req.query.from),
        to: ymd(req.query.to),
      };

      let out;
      try {
        out = await exportExceptions(admin, {
          orgId,
          filters,
          scope: {
            title: "Fuel findings",
            from: ymd(req.query.from),
            to: ymd(req.query.to),
            trucks: filters.unitNumbers?.length ?? 0,
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (e) {
        if (e instanceof ExportTooLargeError) {
          res.status(400).json(
            apiError(
              "export_too_large",
              `${e.message} This export stops at ${MAX_EXPORT_ROWS.toLocaleString("en-US")} — narrow the window and try again.`,
            ),
          );
          return;
        }
        throw e;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "export.generated",
        entity: "fuel_exceptions",
        meta: { report: "findings.csv", from: ymd(req.query.from), to: ymd(req.query.to), rows: out.rows },
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fuel-findings-${ymd(req.query.from) ?? "all"}-to-${ymd(req.query.to) ?? "all"}.csv"`,
      );
      // The BOM, so Excel reads it as UTF-8 — station and brand names carry accents.
      res.send(`\uFEFF${out.csv}`);
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
    requireSection("fuel", "view"),
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
    requireSection("fuel", "view"),
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
    requireSection("fuel"),
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
