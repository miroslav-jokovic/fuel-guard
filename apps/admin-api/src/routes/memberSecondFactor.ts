import type { Request, Response } from "express";
import { z } from "zod";
import { isRecordId } from "@silvicom/shared";
import { adminClient } from "../lib/supabaseAdmin.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import { writeTenantAudit } from "../lib/impersonation.js";

/**
 * `POST /admin/orgs/:id/members/:userId/second-factor/remove` — Silvicom staff remove a customer member's
 * authenticator (INSTALLED-APP-PLAN IA-S1; Q-IA11 (b), the owner's ruling of 2026-11-15).
 *
 * The office app lets another admin of the SAME company do this (Q-IA11 (a)). This is for the company that
 * has no other admin to ask: its only admin lost their phone, and without this door they are locked out for
 * good — Supabase has no recovery codes. Mounted in `orgsRouter`, so it sits behind the full platform gate
 * (sign-in, second factor, allowlist), and then:
 *
 *  · owner and admin only — support and read-only staff cannot take a protection off a customer's account;
 *  · the operator's own second factor again, minutes old (`requireStepUp`), as every write on this plane;
 *  · a REASON, required and recorded: who asked and how they were identified is the whole control here,
 *    because the person asking is by definition somebody who cannot prove who they are the usual way;
 *  · the member must belong to THAT customer;
 *  · every factor removed through Supabase's own admin API, and the person signed out everywhere
 *    (`revoke_user_sessions`, 0363) — a lost phone may also be a signed-in phone;
 *  · written to the platform's audit trail AND the customer's own, so their admins can see that Silvicom did it.
 *
 * The office API drops its 15-second cache of that person by itself; nothing here can reach another process.
 */
const bodySchema = z.object({ reason: z.string().trim().min(10).max(500) });

export async function removeMemberSecondFactor(req: Request, res: Response): Promise<void> {
  const orgId = req.params.id;
  const userId = req.params.userId;
  if (typeof orgId !== "string" || !isRecordId(orgId) || typeof userId !== "string" || !isRecordId(userId)) {
    res.status(404).json(apiError("not_found", "Member not found"));
    return;
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(apiError("invalid_request", "Say who asked for this and how you confirmed it was them (at least 10 characters)."));
    return;
  }
  try {
    const admin = adminClient(req);
    const actor = req.platform!;
    const { data: membership, error: memberError } = await admin
      .from("memberships").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!membership) {
      res.status(404).json(apiError("not_found", "Member not found"));
      return;
    }
    const listed = await admin.auth.admin.mfa.listFactors({ userId });
    if (listed.error) throw new Error(listed.error.message);
    const factors = listed.data?.factors ?? [];
    if (factors.length === 0) {
      res.status(404).json(apiError("no_second_factor", "This member has no two-step sign-in set up."));
      return;
    }
    for (const factor of factors) {
      const removed = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      if (removed.error) throw new Error(removed.error.message);
    }
    const ua = req.headers["user-agent"];
    await writePlatformAudit(admin, actor, {
      action: "member.second_factor_removed",
      targetOrgId: orgId,
      targetEntity: "member",
      targetId: userId,
      reason: parsed.data.reason,
      after: { factors: factors.length },
      ip: req.ip ?? null,
      userAgent: typeof ua === "string" ? ua : null,
    });
    await writeTenantAudit(admin, orgId, null, "member.second_factor_removed", { userId, factors: factors.length, by: "Silvicom support", via: "platform console" });
    // After the audit rows: if ending the sessions fails, what was done is still on record.
    const { error: endError } = await admin.rpc("revoke_user_sessions", { p_user_id: userId });
    if (endError) console.error(`[second-factor] sessions of ${userId} were not ended after their factor was removed: ${endError.message}`);
    res.json({ removed: true, sessionsEnded: !endError });
  } catch {
    res.status(500).json(apiError("internal_error", "Could not remove two-step sign-in"));
  }
}
