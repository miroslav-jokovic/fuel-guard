import { Router, type Request, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecordId, sessionDeviceLabel, type MemberSession, type MemberSessionsResponse } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { writeAudit } from "../../../lib/audit.js";
import { lookupMemberRole } from "../memberLookup.js";
import { forgetMembership } from "../../../middleware/membershipCurrent.js";

/**
 * Signed-in devices (INSTALLED-APP-PLAN IA-S3; Q-IA3 (b), the owner's ruling of 2026-11-15; migration 0615).
 *
 * TWO ROUTERS, because there are two questions and each needs its own gate — a gate that depended on whether
 * `:userId` is the caller would be one the route ledger cannot see (members.ts says the same of its PATCH):
 *
 *   mySessionsRouter      /api/me/sessions            the caller's own, any signed-in member of a company
 *     GET    /            their sessions
 *     DELETE /:sessionId  end one of them
 *
 *   memberSessionsRouter  /api/members                an ADMIN, for anybody in their company
 *     GET    /:userId/sessions              that member's sessions
 *     DELETE /:userId/sessions/:sessionId   end one — behind the password again (step-up), and audited
 *
 * Everything is read and ended through 0615's functions, which check that the person is of the organisation
 * asked for and never return anything of a token. The organisation and the caller come from the verified
 * token, never the body or the path.
 *
 * THE SESSION THE REQUEST IS SIGNED IN WITH is marked `current` and is never ended here: ending it would leave
 * this browser holding a token it cannot renew and a notification subscription nobody told to stop. That is
 * what Sign out is for (`signOutThisDevice`), so the answer is 409 `current_session` and the dialog does not
 * offer the button.
 *
 * WHAT "ENDED" MEANS: the device cannot renew its sign-in from that moment, and since Q-IA10 (0616,
 * `membershipCurrent.ts`) the API stops answering the token it already holds — at once on this process, within
 * 15 seconds on the other. What is left of the hour is the browser's direct database reads (RLS), which honour a
 * token until it expires (SETTINGS-PERMISSIONS-PLAN §4b).
 */
interface SessionRow {
  id: string;
  created_at: string | null;
  last_used_at: string | null;
  user_agent: string | null;
  ip: string | null;
}

async function listSessions(admin: SupabaseClient, orgId: string, userId: string, currentId: string | null): Promise<MemberSession[]> {
  const { data, error } = await admin.rpc("member_sessions", { p_org: orgId, p_user: userId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SessionRow[]).map((r) => {
    const used = r.last_used_at ?? r.created_at ?? new Date(0).toISOString();
    return {
      id: r.id,
      device: sessionDeviceLabel(r.user_agent),
      created_at: r.created_at ?? used,
      last_used_at: used,
      ip: r.ip,
      current: currentId !== null && r.id.toLowerCase() === currentId.toLowerCase(),
    };
  });
}

/**
 * Ends one session of `userId` and writes the audit row. Answers the response itself for the three refusals
 * (not an id, the caller's own current session, not found) and returns whether it ended one.
 */
async function endSession(req: Request, res: Response, userId: string, action: "session.ended" | "member.session_ended"): Promise<boolean> {
  const admin = getSupabaseAdmin(getAppLocals(req).env);
  const orgId = req.auth!.orgId!;
  const sessionId = String(req.params.sessionId ?? "");
  if (!isRecordId(sessionId)) {
    res.status(400).json(apiError("invalid_request", "Not a session id"));
    return false;
  }
  const current = req.auth!.sessionId ?? null;
  if (current !== null && sessionId.toLowerCase() === current.toLowerCase()) {
    res.status(409).json(apiError("current_session", "This is the device you are using. Use Sign out to end it."));
    return false;
  }
  // Read first, for the audit row: after the delete there is nothing left to say which device it was.
  const before = (await listSessions(admin, orgId, userId, current)).find((s) => s.id.toLowerCase() === sessionId.toLowerCase());
  const { data, error } = await admin.rpc("member_session_end", { p_org: orgId, p_user: userId, p_session: sessionId });
  if (error) throw new Error(error.message);
  if (data !== 1) {
    res.status(404).json(apiError("not_found", "That device is no longer signed in"));
    return false;
  }
  // This process stops answering that device NOW (Q-IA10): its cached "current" would otherwise stand for
  // up to 15 s, which is still what the other API process takes.
  forgetMembership(userId);
  await writeAudit(admin, {
    orgId,
    actorId: req.auth!.userId,
    action,
    entity: "member",
    entityId: userId,
    meta: { sessionId, device: before?.device ?? null, lastUsedAt: before?.last_used_at ?? null },
  });
  return true;
}

export function mySessionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requireOrg,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const answer: MemberSessionsResponse = {
        sessions: await listSessions(admin, req.auth!.orgId!, req.auth!.userId, req.auth!.sessionId ?? null),
      };
      res.json(answer);
    }),
  );

  router.delete(
    "/:sessionId",
    requireOrg,
    asyncHandler(async (req, res) => {
      if (await endSession(req, res, req.auth!.userId, "session.ended")) res.json({ ended: true });
    }),
  );

  return router;
}

export function memberSessionsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** The person must be a member of the CALLER's company, whatever else they belong to. */
  async function memberOr404(req: Request, res: Response): Promise<string | null> {
    const userId = String(req.params.userId ?? "");
    const member = isRecordId(userId)
      ? await lookupMemberRole(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, userId)
      : ({ ok: false, reason: "not_found" } as const);
    if (member.ok) return userId;
    if (member.reason === "not_found") res.status(404).json(apiError("not_found", "Member not found"));
    else res.status(500).json(apiError("db_error", "Could not load member"));
    return null;
  }

  router.get(
    "/:userId/sessions",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const userId = await memberOr404(req, res);
      if (!userId) return;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const answer: MemberSessionsResponse = {
        sessions: await listSessions(admin, req.auth!.orgId!, userId, req.auth!.sessionId ?? null),
      };
      res.json(answer);
    }),
  );

  router.delete(
    "/:userId/sessions/:sessionId",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(), // as every write on the Users page (SP9, Q-SET8 (a)): ending a colleague's device needs the password again
    asyncHandler(async (req, res) => {
      const userId = await memberOr404(req, res);
      if (!userId) return;
      if (await endSession(req, res, userId, "member.session_ended")) res.json({ ended: true });
    }),
  );

  return router;
}
