import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  FOLLOW_UP_CATEGORIES,
  followUpActionRequestSchema,
  recordId,
  type FollowUpActionRequest,
  type FollowUpActionRow,
  type FollowUpCategory,
  type FollowUpDetail,
  type FollowUpList,
  type FollowUpVideo,
  type FollowUpWarning,
} from "@silvicom/shared";
import { requireAnySection, requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readSamsaraSubjects } from "../../roster/index.js";
import { fetchSafetyEventVideo, listSubjectWarnings, NoSamsaraTokenError, type StoredWarning } from "../../samsara/index.js";
import { listOfficeMembers } from "../../org/index.js";
import { deskAccess } from "../access.js";
import { CLOSED_LIMIT, countOpenByCategory, readFollowUpRow, readFollowUpRows, sortLines, subjectIdsOf, toLine, type FollowUpRow } from "../lines.js";
import { resolvedRules } from "../ruleViews.js";
import { followUpRulesRouter } from "./rules.js";

/**
 * `/api/follow-ups` — the warning desk (WARNING-DESK-PLAN WD4).
 *
 *  · `GET /` — the list. Maintenance › Follow-ups sees every category; Loads › Route follow-ups sees
 *    Route alone (D-WD13). Urgent → high → normal, then "warned again after the call", then oldest.
 *  · `GET /:id` — one line, its warnings in time order and its action history.
 *  · `POST /:id/actions` — one action through `transition_follow_up` (0653), the only writer of status.
 *    Its `follow_up_actions` row IS the record of who told which driver what (D-WD9), so no second
 *    audit row is written beside it.
 *  · `GET /:id/video/:eventId` — a fresh signed link from Samsara, never stored (D-WD7).
 *  · `/rules` — the admin's card (`./rules.ts`).
 *
 * The router-level gate is the union of the two sections behind the two screens; the screen itself —
 * and, for an action, the manage level behind the screen that matches the follow-up's category — is
 * asked per request (`deskAccess`).
 */

const listQuery = z.object({
  category: z.enum(["all", ...FOLLOW_UP_CATEGORIES]).default("all"),
  status: z.enum(["open", "closed"]).default("open"),
  mine: z.enum(["1", "true"]).optional(),
});

const RPC_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  WD012: { status: 404, code: "not_found", message: "That follow-up does not exist." },
  WD013: { status: 409, code: "conflict", message: "Someone else changed this follow-up. It has been refreshed — check it and try again." },
  WD014: { status: 422, code: "invalid_action", message: "That action is not possible on this follow-up." },
  WD015: { status: 422, code: "note_required", message: "This needs a note." },
};

function toWarning(w: StoredWarning): FollowUpWarning {
  const hasVideo = w.source === "safety" && w.detail.hasVideo === true;
  return {
    id: w.id,
    source: w.source as FollowUpWarning["source"],
    label: w.label,
    happenedAt: w.happenedAt,
    endedAt: w.endedAt,
    stillActive: w.stillActive,
    unitName: w.unitName,
    driverName: w.driverName,
    samsaraUrl: w.samsaraUrl,
    videoEventId: hasVideo ? w.sourceKey : null,
    coachingState: w.source === "safety" && typeof w.detail.eventState === "string" ? w.detail.eventState : null,
  };
}

/** The warnings that belong to one follow-up: its rule, its subject, from its first to its close. */
async function warningsOf(req: Request, orgId: string, f: FollowUpRow): Promise<StoredWarning[]> {
  const admin = getSupabaseAdmin(getAppLocals(req).env);
  const from = Date.parse(f.first_at);
  const until = f.closed_at ? Date.parse(f.closed_at) : Infinity;
  const ws = await listSubjectWarnings(admin, orgId, {
    kind: f.rule_key,
    subjectKind: f.subject_kind,
    subjectIds: [f.subject_samsara_id],
    sinceIso: new Date(from).toISOString(),
  });
  return ws
    .filter((w) => Date.parse(w.happenedAt) >= from && Date.parse(w.happenedAt) <= until)
    .sort((a, b) => Date.parse(a.happenedAt) - Date.parse(b.happenedAt));
}

export function followUpsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireAnySection(["maintenance", "view"], ["dispatch", "view"]));
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

  router.use("/rules", followUpRulesRouter());

  /** Loads one follow-up the caller may SEE, or answers 404/403 and returns null. */
  async function visibleFollowUp(req: Request, res: Response): Promise<{ row: FollowUpRow; actsOn: FollowUpCategory[] } | null> {
    const id = recordId().safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json(apiError("not_found", "That follow-up does not exist."));
      return null;
    }
    const access = await deskAccess(req);
    if (access.categories.length === 0) {
      res.status(403).json(apiError("surface_denied", "Your organisation has not given your role access to Follow-ups."));
      return null;
    }
    const row = await readFollowUpRow(adminOf(req), req.auth!.orgId!, id.data);
    // A category the caller cannot see answers as missing, so a dispatcher cannot probe for safety lines.
    if (!row || !access.categories.includes(row.category)) {
      res.status(404).json(apiError("not_found", "That follow-up does not exist."));
      return null;
    }
    return { row, actsOn: access.actsOn };
  }

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const q = listQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json(apiError("bad_request", "Unknown category or status."));
        return;
      }
      const access = await deskAccess(req);
      const wanted = q.data.category === "all" ? access.categories : access.categories.filter((c) => c === q.data.category);
      if (access.categories.length === 0 || wanted.length === 0) {
        res.status(403).json(apiError("surface_denied", "Your organisation has not given your role access to these follow-ups."));
        return;
      }
      const orgId = req.auth!.orgId!;
      const admin = adminOf(req);
      const nowMs = Date.now();
      const rows = await readFollowUpRows(admin, orgId, { categories: wanted, closed: q.data.status === "closed", mineOf: q.data.mine ? req.auth!.userId : null });
      const [{ rules }, subjects, counts] = await Promise.all([
        resolvedRules(admin, getAppLocals(req).env, orgId, nowMs),
        readSamsaraSubjects(admin, orgId, subjectIdsOf(rows)),
        countOpenByCategory(admin, orgId, access.categories),
      ]);
      const byKey = new Map(rules.map((r) => [r.key, r]));
      const body: FollowUpList = {
        lines: sortLines(rows.map((r) => toLine(r, byKey, subjects, req.auth!.userId, nowMs))),
        categories: access.categories,
        counts,
        closedLimit: CLOSED_LIMIT,
      };
      res.json(body);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const found = await visibleFollowUp(req, res);
      if (!found) return;
      const orgId = req.auth!.orgId!;
      const admin = adminOf(req);
      const nowMs = Date.now();
      const [{ rules }, subjects, warnings, actions, members] = await Promise.all([
        resolvedRules(admin, getAppLocals(req).env, orgId, nowMs),
        readSamsaraSubjects(admin, orgId, subjectIdsOf([found.row])),
        warningsOf(req, orgId, found.row),
        admin
          .from("follow_up_actions")
          .select("id, action, note, actor_id, created_at")
          .eq("org_id", orgId)
          .eq("follow_up_id", found.row.id)
          .order("created_at", { ascending: false }),
        listOfficeMembers(admin, orgId),
      ]);
      if (actions.error) throw new Error(`follow_up_actions: ${actions.error.message}`);
      const names = new Map(members.map((m) => [m.userId, m.fullName || m.email || "A colleague"]));
      const body: FollowUpDetail = {
        line: toLine(found.row, new Map(rules.map((r) => [r.key, r])), subjects, req.auth!.userId, nowMs),
        canAct: found.actsOn.includes(found.row.category),
        warnings: warnings.map(toWarning),
        actions: ((actions.data ?? []) as { id: string; action: FollowUpActionRow["action"]; note: string | null; actor_id: string; created_at: string }[]).map((a) => ({
          id: a.id,
          action: a.action,
          note: a.note,
          actorName: names.get(a.actor_id) ?? "A former member",
          at: new Date(Date.parse(a.created_at)).toISOString(),
        })),
      };
      res.json(body);
    }),
  );

  router.post(
    "/:id/actions",
    validateBody(followUpActionRequestSchema),
    asyncHandler(async (req, res) => {
      const found = await visibleFollowUp(req, res);
      if (!found) return;
      if (!found.actsOn.includes(found.row.category)) {
        res.status(403).json(apiError("forbidden", "You can read this follow-up but not change it."));
        return;
      }
      const body = res.locals.body as FollowUpActionRequest;
      const { data, error } = await adminOf(req).rpc("transition_follow_up", {
        p_org_id: req.auth!.orgId!,
        p_follow_up_id: found.row.id,
        p_actor_id: req.auth!.userId,
        p_action: body.action,
        p_note: body.note?.trim() || null,
        p_expected_version: body.version,
      });
      if (error) {
        const mapped = RPC_ERRORS[(error as { code?: string }).code ?? ""];
        if (mapped) {
          res.status(mapped.status).json(apiError(mapped.code, mapped.message));
          return;
        }
        throw new Error(`transition_follow_up: ${error.message}`);
      }
      res.json(data);
    }),
  );

  router.get(
    "/:id/video/:eventId",
    asyncHandler(async (req, res) => {
      const found = await visibleFollowUp(req, res);
      if (!found) return;
      const orgId = req.auth!.orgId!;
      const eventId = String(req.params.eventId ?? "");
      // The event must be one of THIS follow-up's warnings — so an id from another org or another
      // follow-up is refused before Samsara is asked anything.
      const warning = (await warningsOf(req, orgId, found.row)).find((w) => w.source === "safety" && w.sourceKey === eventId);
      if (!warning) {
        res.status(404).json(apiError("not_found", "That video is not part of this follow-up."));
        return;
      }
      // Samsara's Sensitive Assets setting serves a blurred placeholder for crash video to API tokens
      // (measured 2026-09-23): open it in Samsara, where a person signed in can see it.
      if (warning.label.split(", ").includes("Crash")) {
        const body: FollowUpVideo = { restricted: true, samsaraUrl: warning.samsaraUrl };
        res.json(body);
        return;
      }
      try {
        const media = await fetchSafetyEventVideo(adminOf(req), getAppLocals(req).env, orgId, eventId);
        const body: FollowUpVideo = { restricted: false, urls: media.map((m) => ({ url: m.url, input: m.input })) };
        res.set("Cache-Control", "no-store").json(body);
      } catch (e) {
        if (e instanceof NoSamsaraTokenError) {
          res.status(503).json(apiError("samsara_unavailable", "Samsara is not connected for this company, so the video cannot be fetched."));
          return;
        }
        console.error("[follow-ups] video fetch failed:", e instanceof Error ? e.message : e);
        res.status(502).json(apiError("samsara_unavailable", "Samsara did not answer. Open the video in Samsara, or try again in a minute."));
      }
    }),
  );

  return router;
}
