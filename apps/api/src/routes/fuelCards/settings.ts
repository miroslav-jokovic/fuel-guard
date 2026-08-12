import { Router } from "express";
import { z } from "zod";
import {
  CARD_CONTROL_AUDIT_ACTIONS,
  CARD_CONTROL_SCOPES,
  cardApproverGrantSchema,
  cardControlSettingsPatchSchema,
  rolesThatManage,
  type CardControlScope,
  type UserRole,
} from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { requireFreshAuth } from "../../middleware/requireFreshAuth.js";

/**
 * Who, in this company, may change a fuel card — and the record of every time that answer moved.
 *
 * ── Why this exists as its own router ────────────────────────────────────────────────────────────
 * Phase B shipped the write path with no way to switch it on: enabling a pilot org and naming its
 * approvers meant hand-writing SQL in the Supabase editor, which is both a bad experience and — more
 * to the point — an UNAUDITED one. A permission change made with a SQL client leaves no trace of who
 * made it. Every route here writes an audit row naming the actor, the target and the values on both
 * sides of the change.
 *
 * ── The permission model, stated once ────────────────────────────────────────────────────────────
 * Two gates, ANDed, and neither can substitute for the other:
 *
 *   1. **The role floor.** Writing a card requires `rolesThatManage("fuel")` — admin or fleet
 *      manager. This is not configurable and is re-checked on every mutation, so it cannot be widened
 *      by a row in a table. A dispatcher granting fuel exceptions is precisely the pattern this
 *      product exists to DETECT; if a customer wants that person to have it, the answer is to change
 *      their ROLE, which is a visible act with consequences elsewhere, not to quietly name them here.
 *      Naming an ineligible user as an approver is REFUSED, with the reason.
 *
 *   2. **The named-approver list**, on by default (`require_approver`). A forty-truck fleet has three
 *      or four fleet managers, and switching card control on must not silently hand write access to
 *      all of them. Scopes are per-person: the most-requested arrangement is a yard manager who can
 *      lock a stolen card at 2am but cannot grant fuel exceptions.
 *
 * Everything here is `requireRole("admin")` plus step-up re-authentication. These rows decide who may
 * spend money at a pump; changing them is exactly the act that should cost a password.
 *
 * ⚠ MOUNT ORDER. This router MUST be mounted before `fuelCardsRouter()` in app.ts. That router
 * declares `GET /:id`, which would otherwise match the literal path "settings" and answer 404 for a
 * card id that was never a card id. There is a test for it.
 */

const userIdSchema = z.string().uuid();

interface MembershipRow {
  user_id: string;
  role: string;
}

interface ApproverRow {
  user_id: string;
  scopes: string[] | null;
  granted_by: string | null;
  granted_at: string | null;
}

interface SettingsRow {
  enabled: boolean;
  require_approver: boolean;
  write_entitlement: "unknown" | "confirmed" | "denied";
  probed_at: string | null;
  probed_by: string | null;
  probe_result: { verdict?: string; recommendation?: string; readOnly?: boolean } | null;
}

/** Defaults that match the migration, for an org that has never opened this page. */
const DEFAULT_SETTINGS: SettingsRow = {
  enabled: false,
  require_approver: true,
  write_entitlement: "unknown",
  probed_at: null,
  probed_by: null,
  probe_result: null,
};

export function fuelCardSettingsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const adminOnly = [requireOrg, requireRole("admin")] as const;
  const eligibleRoles = (): UserRole[] => rolesThatManage("fuel");

  /**
   * Everything the settings screen needs in one call: the two switches, the entitlement the probe
   * established, the current approvers, and who is even eligible to become one.
   *
   * `eligible` is returned rather than left to the client to derive. The browser can see a role, but
   * "which roles may hold card scopes" is a server rule, and a picker built from a client-side guess
   * is a picker that offers people the API will refuse.
   */
  router.get("/settings", ...adminOnly, asyncHandler(async (req, res) => {
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;

    const [settingsResult, approverResult, membershipResult] = await Promise.all([
      admin.from("efs_card_control_settings")
        .select("enabled, require_approver, write_entitlement, probed_at, probed_by, probe_result")
        .eq("org_id", orgId).maybeSingle(),
      admin.from("efs_card_control_approvers")
        .select("user_id, scopes, granted_by, granted_at")
        .eq("org_id", orgId),
      admin.from("memberships").select("user_id, role").eq("org_id", orgId),
    ]);

    // All THREE reads are checked, not just the team list (audit P2). A swallowed settings error used
    // to render DEFAULT_SETTINGS — control shown as OFF on a page where it is ON, and an admin
    // re-enabling something already enabled, or trusting an empty approver list that only failed to
    // load. A settings page that quietly fabricates its own contents is worse than one that errors.
    if (settingsResult.error) {
      dbErrorResponse(res, "card-control.settings", settingsResult.error, "Could not load the card-control settings");
      return;
    }
    if (approverResult.error) {
      dbErrorResponse(res, "card-control.settings", approverResult.error, "Could not load the approver list");
      return;
    }
    if (membershipResult.error) {
      dbErrorResponse(res, "card-control.settings", membershipResult.error, "Could not load the team list");
      return;
    }

    const memberships = (membershipResult.data ?? []) as MembershipRow[];
    const eligible = memberships.filter((m) => (eligibleRoles() as string[]).includes(m.role));
    const roleOf = new Map(memberships.map((m) => [m.user_id, m.role]));

    // Emails come from the auth admin API, exactly as routes/members.ts does it — `memberships` holds
    // no email, and a settings screen that lists raw uuids is not one anybody can use.
    const emails = new Map<string, string | null>();
    await Promise.all(
      [...new Set([...eligible.map((m) => m.user_id), ...(approverResult.data ?? []).map((a) => (a as ApproverRow).user_id)])]
        .map(async (userId) => {
          const { data } = await admin.auth.admin.getUserById(userId);
          emails.set(userId, data?.user?.email ?? null);
        }),
    );

    const settings = ((settingsResult.data as SettingsRow | null) ?? DEFAULT_SETTINGS);

    res.json({
      settings: {
        enabled: settings.enabled,
        requireApprover: settings.require_approver,
        writeEntitlement: settings.write_entitlement,
        probedAt: settings.probed_at,
        // The verdict only, never the whole probe payload: it carries per-step vendor error text that
        // belongs in the audit log and the settings row, not in a page render.
        probeVerdict: settings.probe_result?.verdict ?? null,
        probeRecommendation: settings.probe_result?.recommendation ?? null,
        probeWasReadOnly: settings.probe_result?.readOnly ?? null,
      },
      approvers: ((approverResult.data ?? []) as ApproverRow[])
        .map((row) => ({
          userId: row.user_id,
          email: emails.get(row.user_id) ?? null,
          role: roleOf.get(row.user_id) ?? null,
          scopes: (row.scopes ?? []).filter((s): s is CardControlScope =>
            (CARD_CONTROL_SCOPES as readonly string[]).includes(s)),
          grantedBy: row.granted_by,
          grantedAt: row.granted_at,
        }))
        // An approver whose role was changed after they were named still HAS a row, and the gate will
        // refuse them. Surfacing it is the point: a stale grant is a thing an admin should clean up,
        // not a secret.
        .map((a) => ({ ...a, eligible: (eligibleRoles() as string[]).includes(a.role ?? "") })),
      eligible: eligible.map((m) => ({
        userId: m.user_id,
        email: emails.get(m.user_id) ?? null,
        role: m.role,
      })),
      scopes: CARD_CONTROL_SCOPES,
      eligibleRoles: eligibleRoles(),
    });
  }));

  /**
   * The two switches.
   *
   * Step-up on both. Enabling card control is what makes every write route in the product reachable,
   * and turning `require_approver` off hands write access to every admin and fleet manager at once —
   * neither should be possible from an unattended laptop.
   */
  router.patch("/settings", ...adminOnly, requireFreshAuth(), asyncHandler(async (req, res) => {
    const parsed = cardControlSettingsPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings"));
      return;
    }
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;

    const { data: existing } = await admin.from("efs_card_control_settings")
      .select("enabled, require_approver, write_entitlement, probed_at, probed_by, probe_result")
      .eq("org_id", orgId).maybeSingle();
    const before = (existing as SettingsRow | null) ?? DEFAULT_SETTINGS;

    const next = {
      enabled: parsed.data.enabled ?? before.enabled,
      require_approver: parsed.data.requireApprover ?? before.require_approver,
    };

    // Refuse to enable card control on an org that has not proved EFS will accept its writes. The
    // capability gate would refuse every mutation anyway, so the only thing allowing it achieves is a
    // settings page that says "on" next to a product that does nothing.
    if (next.enabled && !before.enabled && before.write_entitlement !== "confirmed") {
      res.status(409).json(apiError(
        "card_control_not_entitled",
        "Run the EFS write check first. Card actions cannot be switched on until EFS has confirmed this account may change cards.",
      ));
      return;
    }

    const { error } = await admin.from("efs_card_control_settings")
      .upsert({ org_id: orgId, ...next }, { onConflict: "org_id" });
    if (error) {
      dbErrorResponse(res, "card-control.settings.patch", error, "Could not save those settings");
      return;
    }

    // One audit row per FACT that moved, not one per request. "Who turned card control on" and "who
    // removed the approver requirement" are two different questions, and an auditor searching for
    // either should not have to open a combined row and read its meta to find out.
    if (next.enabled !== before.enabled) {
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId,
        action: next.enabled ? CARD_CONTROL_AUDIT_ACTIONS.controlEnabled : CARD_CONTROL_AUDIT_ACTIONS.controlDisabled,
        entity: "efs_card_control_settings", entityId: orgId,
        meta: {
          enabledBefore: before.enabled, enabledAfter: next.enabled,
          writeEntitlement: before.write_entitlement,
          requireApprover: next.require_approver,
          stepUp: true,
        },
      });
    }
    if (next.require_approver !== before.require_approver) {
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId,
        action: CARD_CONTROL_AUDIT_ACTIONS.approverPolicyChanged,
        entity: "efs_card_control_settings", entityId: orgId,
        meta: {
          requireApproverBefore: before.require_approver,
          requireApproverAfter: next.require_approver,
          // The consequence, spelled out in the row itself so nobody has to reason about it later.
          effect: next.require_approver
            ? "Only named approvers may change cards."
            : "Every admin and fleet manager may change cards.",
          stepUp: true,
        },
      });
    }

    res.json({ ok: true, settings: { enabled: next.enabled, requireApprover: next.require_approver } });
  }));

  /**
   * Name someone, or change what they are trusted with.
   *
   * A PUT rather than a POST: granting is idempotent and the request states the FULL scope set, so
   * two admins editing the same person cannot merge into a union neither of them chose.
   */
  router.put("/approvers/:userId", ...adminOnly, requireFreshAuth(), asyncHandler(async (req, res) => {
    const target = userIdSchema.safeParse(req.params.userId);
    const body = cardApproverGrantSchema.safeParse(req.body ?? {});
    if (!target.success || !body.success) {
      const message = target.success
        ? (body.success ? "Invalid request" : body.error.issues[0]?.message ?? "Pick at least one permission.")
        : "That is not a user id.";
      res.status(400).json(apiError("invalid_request", message));
      return;
    }
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;

    // Membership is checked against THIS org. Without it, an admin could name a uuid from another
    // tenant and the capability gate would happily read the row back.
    const { data: membership } = await admin.from("memberships")
      .select("user_id, role").eq("org_id", orgId).eq("user_id", target.data).maybeSingle();
    if (!membership) {
      res.status(404).json(apiError("not_found", "That person is not in this company."));
      return;
    }
    const role = (membership as MembershipRow).role;
    if (!(eligibleRoles() as string[]).includes(role)) {
      // Refused, with the reason and the remedy. This is the one place the role floor is visible to a
      // human, so it says what would actually have to change.
      res.status(422).json(apiError(
        "role_not_eligible",
        `A ${role.replace(/_/g, " ")} cannot hold card permissions. Card changes are limited to ${eligibleRoles().join(" and ").replace(/_/g, " ")}. Change their role first if that is what you intend.`,
      ));
      return;
    }

    const { data: existing } = await admin.from("efs_card_control_approvers")
      .select("scopes").eq("org_id", orgId).eq("user_id", target.data).maybeSingle();
    const scopesBefore = ((existing as { scopes?: string[] } | null)?.scopes ?? []) as string[];

    const { error } = await admin.from("efs_card_control_approvers").upsert({
      org_id: orgId,
      user_id: target.data,
      scopes: body.data.scopes,
      granted_by: req.auth!.userId,
      granted_at: new Date().toISOString(),
    }, { onConflict: "org_id,user_id" });
    if (error) {
      dbErrorResponse(res, "card-control.approver.grant", error, "Could not save those permissions");
      return;
    }

    await writeAudit(admin, {
      orgId, actorId: req.auth!.userId,
      action: CARD_CONTROL_AUDIT_ACTIONS.approverGranted,
      entity: "efs_card_control_settings", entityId: target.data,
      meta: {
        targetUserId: target.data, targetRole: role,
        scopesBefore, scopesAfter: body.data.scopes,
        // The interesting half of a permission change is what was ADDED, and an auditor should not
        // have to diff two arrays by eye to see it.
        scopesAdded: body.data.scopes.filter((s) => !scopesBefore.includes(s)),
        scopesRemoved: scopesBefore.filter((s) => !(body.data.scopes as string[]).includes(s)),
        stepUp: true,
      },
    });

    res.json({ ok: true, userId: target.data, scopes: body.data.scopes });
  }));

  /** Take the permissions away entirely. The row goes, rather than being emptied. */
  router.delete("/approvers/:userId", ...adminOnly, requireFreshAuth(), asyncHandler(async (req, res) => {
    const target = userIdSchema.safeParse(req.params.userId);
    if (!target.success) {
      res.status(400).json(apiError("invalid_request", "That is not a user id."));
      return;
    }
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;

    const { data: existing } = await admin.from("efs_card_control_approvers")
      .select("scopes").eq("org_id", orgId).eq("user_id", target.data).maybeSingle();
    if (!existing) {
      res.status(404).json(apiError("not_found", "That person is not an approver."));
      return;
    }

    const { error } = await admin.from("efs_card_control_approvers")
      .delete().eq("org_id", orgId).eq("user_id", target.data);
    if (error) {
      dbErrorResponse(res, "card-control.approver.revoke", error, "Could not remove those permissions");
      return;
    }

    await writeAudit(admin, {
      orgId, actorId: req.auth!.userId,
      action: CARD_CONTROL_AUDIT_ACTIONS.approverRevoked,
      entity: "efs_card_control_settings", entityId: target.data,
      meta: {
        targetUserId: target.data,
        // What they COULD do, recorded at the moment it was taken away. The row is deleted, so this
        // audit entry is the only remaining evidence of what the grant had been.
        scopesRevoked: ((existing as { scopes?: string[] }).scopes ?? []),
        stepUp: true,
      },
    });

    res.json({ ok: true, userId: target.data });
  }));

  return router;
}
