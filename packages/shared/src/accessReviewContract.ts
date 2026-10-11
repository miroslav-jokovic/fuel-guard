import { z } from "zod";
import { roleSchema } from "./apiContract.js";
import { MODULE_KEYS } from "./entitlements.js";

/**
 * `GET /api/access-review` — the whole organisation's access state in ONE response
 * (SETTINGS-PERMISSIONS-PLAN.md §4b.2 gap 7, SP10; Q-SET10, owner ruling 2026-09-30 "build it now").
 *
 * ── WHY ONE RESPONSE AND NOT THE PER-MEMBER ENDPOINTS ───────────────────────────────────────────
 * The Permissions page already reads one member at a time (`/api/section-access/user/:id`,
 * `/api/surface-access/user/:id`), which answers "what can this person do". The reverse question —
 * "who can open Card control" — needs every member at once, and asking it through those endpoints
 * would be 2 × N requests per screen picked. So the layers travel here UNMERGED and whole, and the
 * web and the export both resolve them with the same shared function (`accessReview.ts`), which asks
 * the same resolvers the router guard, the sidebar and the API ask.
 *
 * ── WHAT IS DELIBERATELY NOT IN IT ──────────────────────────────────────────────────────────────
 * No shipped matrix and no catalogue: both are compile-time constants in this package, and the
 * resolver reads them where they live rather than from a copy in the payload. The EXPORT is resolved
 * on the server, so the file an auditor keeps always reflects the build that enforces access; the
 * on-screen view is resolved in the browser by the same function.
 *
 * Every map is SPARSE (D-PERM4, D-SURF6): an absent key is "this layer said nothing", never a denial.
 * Rows the endpoints could not have written — an uneditable role or section, a surface key the
 * catalogue no longer has — are dropped by the API's existing row filters before they get here.
 */

const accessSchema = z.enum(["none", "view", "manage"]);

/** One person, as `org_member_directory()` (0301, 0393) names them. */
export const accessReviewMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  role: roleSchema,
  /**
   * Q-SET12 (0393): when set, the membership mints no org claim and the API refuses its tokens, so
   * the person reaches NOTHING today — whatever the layers below say. Kept, because reinstating them
   * restores those layers, and an access review has to be able to say so.
   */
  suspendedAt: z.string().nullable(),
});
export type AccessReviewMember = z.infer<typeof accessReviewMemberSchema>;

export const accessReviewStateSchema = z.object({
  /** Named on the export's first row — a file outlives the screen it was downloaded from. */
  orgName: z.string(),
  /** Office members only: driver-app logins are left out exactly as the Users page leaves them out. */
  members: z.array(accessReviewMemberSchema),
  /** `role → section → access`, the org's answers for whole roles (0291). */
  roleSections: z.record(z.string(), z.record(z.string(), accessSchema)),
  /** `userId → section → access`, one person's own answers (0299). */
  userSections: z.record(z.string(), z.record(z.string(), accessSchema)),
  /** `role → surface key → allowed` (0296). */
  roleSurfaces: z.record(z.string(), z.record(z.string(), z.boolean())),
  /** `userId → surface key → allowed` (0298). */
  userSurfaces: z.record(z.string(), z.record(z.string(), z.boolean())),
  /**
   * The modules the org has enabled. A screen behind a module the org has not bought opens for
   * nobody (`requireModule` in the API, `canReachSurface` in the sidebar), and a review that said
   * "open" for it would be a statement the product contradicts.
   */
  modules: z.array(z.enum(MODULE_KEYS)),
});
export type AccessReviewState = z.infer<typeof accessReviewStateSchema>;
