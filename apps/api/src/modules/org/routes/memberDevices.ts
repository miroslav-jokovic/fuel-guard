import { Router, type Request, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEVICE_HISTORY_DAYS,
  DEVICE_LIMIT,
  SESSION_IDLE_HOURS,
  isRecordId,
  sessionDeviceLabel,
  type DeviceAddress,
  type MemberDevice,
  type MemberDevicesResponse,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { lookupMemberRole } from "../memberLookup.js";

/**
 * Signed-in devices, REMEMBERED (INSTALLED-APP-PLAN IA-S6; the owner's rulings of 2026-11-16; migration 0620).
 *
 * The sessions routes beside this file (`memberSessions.ts`) answer "where am I signed in now", from Supabase's
 * session rows, which are deleted at sign-out. These answer "every device this account was used on in the last
 * twelve months, and every address each one used" (Q-IA17, Q-IA18 (a)), from 0620's tables, which are not.
 * Reading only: a device is signed out through the sessions routes, by the session id this list carries.
 *
 *   myDevicesRouter      GET /api/me/devices             the caller's own — any signed-in member of a company
 *   memberDevicesRouter  GET /api/members/:userId/devices  an ADMIN, for anybody in their company (Q-IA3 (b))
 *
 * The person and the organisation come from the verified token (or, for the admin's, a member of the token's
 * organisation), never the body; 0620's function checks the membership again and returns nothing of a token.
 */
interface DeviceRow {
  id: string;
  user_agent: string | null;
  first_seen_at: string;
  last_seen_at: string;
  session_id: string | null;
  signed_in: boolean;
  addresses: DeviceAddress[] | null;
}

async function listDevices(admin: SupabaseClient, orgId: string, userId: string, currentSession: string | null): Promise<MemberDevicesResponse> {
  const { data, error } = await admin.rpc("member_devices_list", { p_org: orgId, p_user: userId, p_idle_hours: SESSION_IDLE_HOURS });
  if (error) throw new Error(error.message);
  const current = currentSession?.toLowerCase() ?? null;
  const devices: MemberDevice[] = ((data ?? []) as DeviceRow[]).map((r) => ({
    id: r.id,
    device: sessionDeviceLabel(r.user_agent),
    first_seen_at: r.first_seen_at,
    last_seen_at: r.last_seen_at,
    signed_in: r.signed_in === true,
    session_id: r.session_id,
    current: current !== null && r.session_id?.toLowerCase() === current,
    addresses: r.addresses ?? [],
  }));
  return { devices, limit: DEVICE_LIMIT, history_days: DEVICE_HISTORY_DAYS };
}

export function myDevicesRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    "/",
    requireOrg,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await listDevices(admin, req.auth!.orgId!, req.auth!.userId, req.auth!.sessionId ?? null));
    }),
  );
  return router;
}

export function memberDevicesRouter(): Router {
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
    "/:userId/devices",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const userId = await memberOr404(req, res);
      if (!userId) return;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await listDevices(admin, req.auth!.orgId!, userId, req.auth!.sessionId ?? null));
    }),
  );
  return router;
}
