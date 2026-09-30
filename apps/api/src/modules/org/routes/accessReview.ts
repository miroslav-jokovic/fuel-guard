import { Router, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APP_SECTIONS,
  REVIEW_SCREENS,
  accessReviewCsv,
  formatDisplayDate,
  isRosterIssuedRole,
  organizationTimezone,
  todayInZone,
  toModuleSet,
  type AccessReviewState,
  type OrgModule,
  type UserRole,
} from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { fetchAllPaged } from "../../../lib/paging.js";
import { toOverrides, toUserSectionClaim } from "./sectionAccess.js";
import { toSurfaceOverrides, toUserSurfaceClaim } from "./surfaceAccess.js";

/**
 * Who has access — the reverse view and the access-review export (SETTINGS-PERMISSIONS-PLAN.md
 * §4b.2 gap 7, SP10; Q-SET10, owner ruling 2026-09-30 "build it now").
 *
 * The sibling of `sectionAccess.ts` and `surfaceAccess.ts`, and gated exactly as their reads are:
 * `requireRole("admin")`. It reads the same four tables through the same row filters (`toOverrides`,
 * `toUserSectionClaim`, `toSurfaceOverrides`, `toUserSurfaceClaim`), so a row those endpoints would
 * refuse to honour is refused here too, and it WRITES nothing but the export's audit row.
 *
 * ⚠ The API reads with the SERVICE ROLE, which bypasses RLS, so every query below carries its own
 * org filter (`org_member_directory` takes the org as its argument); `accessReview.test.ts` asserts
 * it with `expectOrgScoped`.
 *
 * ── PAGED, BECAUSE POSTGREST CAPS EVERY RESPONSE AT 1,000 ROWS ────────────────────────────────
 * The per-person tables grow with the org: eleven section rows and ~70 screen rows per member at
 * most, so `user_surface_access` passes 1,000 at around fifteen members with custom setups. A read
 * that stopped at the cap would drop people's answers silently and the review would report their
 * role's answer as theirs. Every read here pages to completion with a unique order (`fetchAllPaged`),
 * the role tables included — they are bounded by the catalogue today, but a bound nobody asserts is
 * the `.limit(10_000)` fiction.
 */

interface DirectoryRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  /** 0393. Absent on a directory older than that migration — read as "not suspended". */
  suspended_at?: string | null;
}

/** Rows keyed by `user_id` → one sparse claim per person, through the endpoint's own filter. */
function perUser<R extends { user_id: string }, C>(rows: R[], toClaim: (rows: R[]) => C): Record<string, C> {
  const grouped = new Map<string, R[]>();
  for (const r of rows) grouped.set(r.user_id, [...(grouped.get(r.user_id) ?? []), r]);
  return Object.fromEntries([...grouped].map(([id, rs]) => [id, toClaim(rs)]));
}

/** The whole org's access state, in one read of each table. Throws on any database error. */
export async function loadAccessReviewState(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ state: AccessReviewState; timezone: string }> {
  const [org, directory, roleSections, userSections, roleSurfaces, userSurfaces, modules] = await Promise.all([
    admin.from("organizations").select("name, operating_hours").eq("id", orgId).maybeSingle(),
    fetchAllPaged<DirectoryRow>((from, to) =>
      admin.rpc("org_member_directory", { p_org_id: orgId }).order("user_id").range(from, to),
    ),
    fetchAllPaged<{ role: string; section: string; access: string }>((from, to) =>
      admin.from("org_section_access").select("role, section, access").eq("org_id", orgId)
        .order("role").order("section").range(from, to),
    ),
    fetchAllPaged<{ user_id: string; section: string; access: string }>((from, to) =>
      admin.from("user_section_access").select("user_id, section, access").eq("org_id", orgId)
        .order("user_id").order("section").range(from, to),
    ),
    fetchAllPaged<{ role: string; surface_key: string; allowed: boolean }>((from, to) =>
      admin.from("org_role_surface_access").select("role, surface_key, allowed").eq("org_id", orgId)
        .order("role").order("surface_key").range(from, to),
    ),
    fetchAllPaged<{ user_id: string; surface_key: string; allowed: boolean }>((from, to) =>
      admin.from("user_surface_access").select("user_id, surface_key, allowed").eq("org_id", orgId)
        .order("user_id").order("surface_key").range(from, to),
    ),
    // One row per module key (the primary key is `(org_id, module_key)`), so this cannot reach the cap.
    admin.from("org_modules").select("module_key, enabled, config").eq("org_id", orgId),
  ]);
  if (org.error || !org.data) throw new Error(org.error?.message ?? "organization not found");
  if (modules.error) throw new Error(modules.error.message);
  const orgRow = org.data as { name: string | null; operating_hours: object | null };

  return {
    timezone: organizationTimezone(orgRow.operating_hours),
    state: {
      orgName: orgRow.name ?? "",
      // Driver-app logins are left out here as `GET /api/members` leaves them out (DC10) — the
      // shared resolver drops them too, but their names and emails need not leave the server at all.
      members: directory
        .filter((d) => !isRosterIssuedRole(d.role))
        .map((d) => ({
          userId: d.user_id,
          email: d.email,
          fullName: d.full_name,
          role: d.role as UserRole,
          suspendedAt: d.suspended_at ?? null,
        })),
      roleSections: toOverrides(roleSections),
      userSections: perUser(userSections, toUserSectionClaim),
      roleSurfaces: toSurfaceOverrides(roleSurfaces),
      userSurfaces: perUser(userSurfaces, toUserSurfaceClaim),
      modules: [...toModuleSet((modules.data ?? []) as OrgModule[])],
    },
  };
}

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // The BOM, so Excel reads it as UTF-8 — names carry accents. The fuel exports send the same one.
  res.send(`\uFEFF${csv}`);
}

export function accessReviewRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** The state the "Who has access" tab resolves in the browser (`whoHasAccess`, shared). */
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      try {
        const { state } = await loadAccessReviewState(admin, req.auth!.orgId!);
        res.json(state);
      } catch {
        res.status(500).json(apiError("db_error", "Could not load who has access"));
      }
    }),
  );

  /**
   * The access-review file, with its audit row.
   *
   * ── WHY THE SERVER RENDERS IT, AND WHY IT IS A GET ─────────────────────────────────────────────
   * An access-review export is itself an auditable act: it is a list of every person and what they
   * can reach, and it leaves the building. The alternative — the browser renders the CSV from the
   * state it already holds and POSTs "I exported" — would record a claim about a file the server
   * never saw, from a client that could skip the POST. Here the file is rendered by the shared
   * function (`accessReviewCsv`, the same resolver the tab uses) from a read this handler made, and
   * the audit row records that read's own counts, so the row and the file describe one thing.
   *
   * A GET, like the fuel exports (`fuel/routes/exports.ts`) that write their audit row the same way,
   * so the web downloads it through `apiDownload` rather than a second download helper.
   *
   * ⚠ The audit row is written BEFORE the file is sent, and a failed write refuses the export. §4b.2
   * gap 4 found that no caller checked `writeAudit`'s result; for this act an unrecorded export is
   * precisely the failure the audit row exists to prevent, so here it is checked.
   */
  router.get(
    "/export.csv",
    requireOrg,
    requireRole("admin"),
    // SP9 (Q-SET8 (a)): the export is the one READ that also requires the password. It hands over, in one
    // file, every person's access to every screen and section, which is the map an attacker holding a
    // stolen session would want first, and it is an audited act. The plain JSON read above is not
    // gated: the Permissions page shows the same answers one screen at a time already.
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      let loaded: Awaited<ReturnType<typeof loadAccessReviewState>>;
      try {
        loaded = await loadAccessReviewState(admin, orgId);
      } catch {
        res.status(500).json(apiError("db_error", "Could not load who has access"));
        return;
      }
      // The carrier's calendar day, not the server's UTC one (D-PREC5): an export at 8 p.m. in
      // Chicago is dated that day, not the next.
      const day = todayInZone(new Date(), loaded.timezone);
      const exportedOn = formatDisplayDate(day);
      const out = accessReviewCsv(loaded.state, exportedOn);

      const recorded = await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "permissions.exported",
        entity: "access_review",
        meta: {
          exportedOn,
          members: out.members,
          suspended: out.suspended,
          rows: out.rows,
          sections: APP_SECTIONS.length,
          screens: REVIEW_SCREENS.length,
        },
      });
      if (!recorded) {
        res.status(500).json(apiError("audit_failed", "Could not record the export, so it was not produced. Try again."));
        return;
      }
      sendCsv(res, `access-review-${day}.csv`, out.csv);
    }),
  );

  return router;
}
