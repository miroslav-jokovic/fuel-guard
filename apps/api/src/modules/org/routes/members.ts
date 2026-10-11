import { Router } from "express";
import { memberUpdateSchema, isRosterIssuedRole, type MemberUpdateRequest } from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { forgetMembership } from "../../../middleware/membershipCurrent.js";
import { endSessions, errorCode, LAST_ADMIN_REFUSED, lastAdminError } from "../accessWrites.js";
import { revokePushTokens } from "../../messaging/index.js";
import { lookupMemberRole } from "../memberLookup.js";

/**
 * Migration 0392's deferred trigger (SP6) refuses, at commit, any write that would leave the org with
 * no active admin — SQLSTATE `AM010` (0393 made "active" mean unsuspended). The count in PATCH below
 * words the ordinary case before it is tried; this answers the case the count cannot see: two admins
 * demoting, removing or suspending each other at the same moment, each counting two. Since SP8 the
 * refusal arrives as the error of the 0395 function the handler called, in the same transaction as
 * the audit row that therefore never lands. Without the mapping it reads as a generic 500.
 */
const refusedLastAdmin = (error: unknown) => errorCode(error) === LAST_ADMIN_REFUSED;

/** DC10's refusal, one sentence for every act on this page that a driver-app login cannot take. */
const rosterManaged = () =>
  apiError(
    "roster_managed",
    "This is a driver-app login, issued from the Drivers page. Remove it there with Revoke login.",
  );

/** One row of `org_member_directory()` (0301). */
interface DirectoryRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  joined_at: string;
  /** 0393. Absent from a directory still on 0301's shape (the deploy window) — read as "not suspended". */
  suspended_at?: string | null;
}

export function membersRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * List active members for the caller's org (admin).
   *
   * One round trip since 0301: `org_member_directory()` joins memberships, auth.users, the profile
   * and the roster server-side. Before it, this handler read the memberships and then called
   * `auth.admin.getUserById` once PER MEMBER for the email — five round trips for five members and
   * three hundred for three hundred — and had no name to show at all.
   */
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      const { data, error } = await admin.rpc("org_member_directory", { p_org_id: orgId });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not list members"));
        return;
      }

      // Driver-app logins are NOT listed here (DC10). `org_member_directory()` deliberately returns
      // them — it is the whole product's naming directory, and a driver who uploads a document has
      // to be nameable in the ledger that prints it — but this page is the OFFICE's member list, and
      // a row it shows is a row it offers to re-role and remove. It showed one on 2026-08-31 and an
      // admin removed it, which deleted a driver's credential (see migration 0329). The filter is
      // the same fact the banner above the table already states and the same fact the invite picker
      // already applies; all three now read it from `ROSTER_ISSUED_ROLES`.
      const members = ((data ?? []) as DirectoryRow[])
        .filter((m) => !isRosterIssuedRole(m.role))
        .map((m) => ({
          userId: m.user_id,
          email: m.email,
          fullName: m.full_name,
          role: m.role,
          joinedAt: m.joined_at,
          // Q-SET12 (0393): the Users page shows the state and offers Reinstate from it. `?? null`
          // because absence must read as "not suspended", never as undefined-and-therefore-unknown.
          suspendedAt: m.suspended_at ?? null,
        }));
      res.json({ members });
    }),
  );

  // Remove a member from the org (admin). Deletes the membership only — does not delete the auth account.
  router.delete(
    "/:userId",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(), // SP9, Q-SET8 (a): an access change needs the password again — see requireFreshAuth.ts
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");

      if (userId === req.auth!.userId) {
        res.status(400).json(apiError("cannot_remove_self", "You cannot remove yourself from the organization"));
        return;
      }

      // ⚠ The membership is looked up BEFORE it is deleted, and the lookup is org-scoped, because for
      // a driver that row is not a permission — it is the credential itself. `custom_access_token_hook`
      // reads `memberships` and nothing else to mint `org_id`, so deleting it leaves a driver who can
      // still sign in, still has a valid password, and lands forever on "Account almost ready" while
      // the Drivers page goes on reporting app access. That happened on 2026-08-31 and cost a driver
      // eight days (DC10; migration 0329 makes the database refuse it too, and this is the half that
      // says so in words). Offboarding a driver is Revoke login on the Drivers page (App access), which
      // unlinks the roster row first and takes the auth user with it.
      const member = await lookupMemberRole(admin, orgId, userId);
      if (!member.ok) {
        if (member.reason === "not_found") res.status(404).json(apiError("not_found", "Member not found"));
        else res.status(500).json(apiError("db_error", "Could not load member"));
        return;
      }
      if (isRosterIssuedRole(member.role)) {
        res.status(400).json(rosterManaged());
        return;
      }

      // The membership and its `member.removed` row (carrying the role held) in one transaction —
      // SP8, Q-SET7 (a). null: nobody to remove in this org by the time the lock was taken.
      const { data: removed, error } = await admin.rpc("member_remove", {
        p_org_id: orgId,
        p_user_id: userId,
        p_actor: req.auth!.userId,
        p_action: "member.removed",
      });
      if (error) {
        if (refusedLastAdmin(error)) res.status(409).json(lastAdminError());
        else res.status(500).json(apiError("db_error", "Could not remove member"));
        return;
      }
      if (removed === null) {
        res.status(404).json(apiError("not_found", "Member not found"));
        return;
      }

      // Q-SET6 (a): removed means signed out now, not at the next token refresh.
      await endSessions(admin, userId, "member.removed");
      res.json({ ok: true });
    }),
  );

  // Revoke a driver's (or any member's) access (admin, offboarding — plan D14). Removes org access,
  // deactivates any linked driver record, and audits. Since SP7 (Q-SET6 (a)) the person is signed out
  // at once: their sessions are ended and the API refuses the access token they already hold
  // (membershipCurrent.ts), so nothing waits for jwt_expiry any more. The auth account itself is kept
  // (re-hire); use delete-account for full identity removal.
  router.post(
    "/:userId/revoke",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(), // SP9, Q-SET8 (a): an access change needs the password again — see requireFreshAuth.ts
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");

      if (userId === req.auth!.userId) {
        res.status(400).json(apiError("cannot_revoke_self", "You cannot revoke your own access"));
        return;
      }

      // Same refusal as the DELETE above, for the same reason and one step further: this handler
      // deactivates the roster row and drops the membership but never clears `drivers.user_id`, so
      // used on a driver it produced the identical wedge — a live auth user, a roster row still
      // claiming app access, and no membership to mint `org_id` from. The roster's own revoke is the
      // only path that unlinks first (DC10, migration 0329).
      const member = await lookupMemberRole(admin, orgId, userId);
      if (member.ok && isRosterIssuedRole(member.role)) {
        res.status(400).json(rosterManaged());
        return;
      }

      const { data: removed, error } = await admin.rpc("member_remove", {
        p_org_id: orgId,
        p_user_id: userId,
        p_actor: req.auth!.userId,
        p_action: "member.access_revoked",
      });
      if (error) {
        if (refusedLastAdmin(error)) res.status(409).json(lastAdminError());
        else res.status(500).json(apiError("db_error", "Could not revoke access"));
        return;
      }
      if (removed === null) {
        res.status(404).json(apiError("not_found", "Member not found"));
        return;
      }

      // The offboarding side effects run AFTER the removal committed (SP8), so a revoke the database
      // refused — the last admin — no longer leaves a deactivated roster row behind it.
      await admin.from("drivers").update({ status: "inactive" }).eq("org_id", orgId).eq("user_id", userId);
      // An offboarded driver's PERSONAL phone must stop receiving load and message content
      // immediately — no token expiry window closes that gap (D14/D53).
      await revokePushTokens(admin, userId);
      await endSessions(admin, userId, "member.access_revoked");

      res.json({ ok: true });
    }),
  );

  /**
   * Change a member's role and/or name (admin).
   *
   * The role half guards against demoting the org's LAST admin, which would lock everyone out of
   * member/settings management. Since SP7 (Q-SET6 (a)) a role change ends the person's sessions and
   * the API refuses their current token at once — the token names the old role, so it is no longer
   * the membership they hold (membershipCurrent.ts). They sign in again and get the new role.
   *
   * The name half (0301, D-MEM1/D-MEM2) writes the person's profile — keyed by user, not by
   * membership, so the one org-scoped question is asked FIRST: is this person a member of the
   * caller's org at all? `lookupMemberRole` is that question, and without it an admin of one tenant
   * could rename a user of another by guessing a uuid. A full-row upsert, because the profile is the
   * whole answer and a partial one is the 2026-08-10 incident. ⚠ Renaming a DRIVER member here writes
   * a profile that outranks the roster's name (D-MEM3) — the roster stays as the company's record and
   * is edited on the Drivers page.
   *
   * Step-up (SP9, Q-SET8 (a)): the password again for every write on this page, and that includes a
   * RENAME. The ruling says "every write on the Users page", and a rename is one of them — but it is
   * also the same PATCH as a re-role, and asking for the password on half this route's bodies would
   * mean reading the body before the gate, a conditional gate that the ledger cannot see and a future
   * body field could slip past. One route, one rule: a name-only PATCH asks too, and pays one prompt
   * per five minutes like every other edit here.
   */
  router.patch(
    "/:userId",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(), // SP9, Q-SET8 (a): an access change needs the password again — see requireFreshAuth.ts
    validateBody(memberUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");
      const { role: newRole, fullName } = res.locals.body as MemberUpdateRequest;

      const current = await lookupMemberRole(admin, orgId, userId);
      if (!current.ok) {
        if (current.reason === "not_found") res.status(404).json(apiError("not_found", "Member not found"));
        else res.status(500).json(apiError("db_error", "Could not load member"));
        return;
      }

      if (newRole !== undefined && newRole !== current.role) {
        // Neither INTO nor OUT OF a roster-issued role (DC10). Out of it re-roles a live driver
        // credential, and the driver app sends any non-driver role to its "wrong app" screen — the
        // same lockout as a delete, by a different column. Into it mints a `driver` membership with
        // no roster row and no password behind it: a login that exists in the token and nowhere else,
        // which nothing on the Drivers page can then see or repair. Migration 0329's trigger refuses
        // the first case in the database; the second cannot be a trigger's job, because a membership
        // that is not yet linked looks exactly like a legitimate one being provisioned.
        if (isRosterIssuedRole(current.role) || isRosterIssuedRole(newRole)) {
          res
            .status(400)
            .json(apiError("roster_managed", "Driver-app logins are issued and removed on the Drivers page, not here — their role is fixed."));
          return;
        }

        // Never leave the org without an ACTIVE admin — 0393 made a suspended admin not count, so the
        // wording's count asks the same question the trigger does.
        if (current.role === "admin" && newRole !== "admin") {
          const { count } = await admin
            .from("memberships")
            .select("user_id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .eq("role", "admin")
            .is("suspended_at", null);
          if ((count ?? 0) <= 1) {
            res.status(400).json(lastAdminError());
            return;
          }
        }

        // The role and its `member.role_changed` row (from/to) in one transaction — SP8, Q-SET7 (a).
        // The count above words the ordinary refusal; 0392's trigger makes it true under a race.
        const { data: before, error } = await admin.rpc("member_change_role", {
          p_org_id: orgId,
          p_user_id: userId,
          p_role: newRole,
          p_actor: req.auth!.userId,
        });
        if (error) {
          if (refusedLastAdmin(error)) res.status(409).json(lastAdminError());
          else res.status(500).json(apiError("db_error", "Could not update role"));
          return;
        }
        if (before === null) {
          res.status(404).json(apiError("not_found", "Member not found"));
          return;
        }
        // The function returns the role it found under its lock; equal to the new one means another
        // request already made this change and nothing was written here.
        if (before !== newRole) await endSessions(admin, userId, "member.role_changed");
      }

      if (fullName !== undefined) {
        const { error } = await admin.from("user_profiles").upsert(
          { user_id: userId, full_name: fullName, updated_at: new Date().toISOString(), updated_by: req.auth!.userId },
          { onConflict: "user_id" },
        );
        if (error) {
          res.status(500).json(apiError("db_error", "Could not update name"));
          return;
        }

        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "member.renamed",
          entity: "user_profiles",
          entityId: userId,
          meta: { fullName },
        });
      }

      res.json({ ok: true });
    }),
  );

  /**
   * Suspend or reinstate an office member (admin) — Q-SET12 (a), migration 0393.
   *
   * Removal deletes the membership and with it every per-person section and screen answer
   * (`user_section_access` / `user_surface_access` hang off it), so a dispatcher on leave came back as
   * a fresh invite with the role's defaults. A suspension keeps the row and everything on it and turns
   * the access off: the token hook mints no org claim for a suspended membership, and the API refuses
   * a token that names one (membershipCurrent.ts).
   *
   * Refused for yourself (you would be signed out mid-click, and an admin's own lockout is what 0392
   * exists to prevent) and for driver-app logins, whose membership is the credential (DC10) — the
   * Drivers page's App access is where a driver's login is switched off.
   *
   * Suspending ends the person's sessions now (Q-SET6 (a)). Reinstating only clears this process's
   * cached verdict: they have no session to keep, and simply sign in again.
   */
  const setSuspended = (suspend: boolean) =>
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");

      if (userId === req.auth!.userId) {
        res.status(400).json(apiError("cannot_suspend_self", "You cannot suspend or reinstate yourself"));
        return;
      }
      const member = await lookupMemberRole(admin, orgId, userId);
      if (!member.ok) {
        if (member.reason === "not_found") res.status(404).json(apiError("not_found", "Member not found"));
        else res.status(500).json(apiError("db_error", "Could not load member"));
        return;
      }
      if (isRosterIssuedRole(member.role)) {
        res
          .status(400)
          .json(apiError("roster_managed", "This is a driver-app login, issued from the Drivers page. Switch it off there with App access."));
        return;
      }

      // The state and its `member.suspended` / `member.reinstated` row in one transaction (0395, SP8).
      const { data: role, error } = await admin.rpc("member_set_suspended", {
        p_org_id: orgId,
        p_user_id: userId,
        p_suspended: suspend,
        p_actor: req.auth!.userId,
      });
      if (error) {
        if (refusedLastAdmin(error)) res.status(409).json(lastAdminError());
        else res.status(500).json(apiError("db_error", suspend ? "Could not suspend member" : "Could not reinstate member"));
        return;
      }
      if (role === null) {
        res.status(404).json(apiError("not_found", "Member not found"));
        return;
      }

      if (suspend) await endSessions(admin, userId, "member.suspended");
      else forgetMembership(userId);
      res.json({ ok: true, suspended: suspend });
    });

  // Step-up on both (SP9, Q-SET8 (a)). Reinstating is the milder act, but it hands a login back, and a
  // stolen session that could reinstate an accomplice's suspended account has escalated as surely as
  // one that re-roles it.
  router.post("/:userId/suspend", requireOrg, requireRole("admin"), requireFreshAuth(), setSuspended(true));
  router.post("/:userId/reinstate", requireOrg, requireRole("admin"), requireFreshAuth(), setSuspended(false));

  return router;
}
