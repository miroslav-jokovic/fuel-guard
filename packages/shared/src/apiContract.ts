import { z } from "zod";
import { USER_ROLES } from "./constants.js";
import { SURFACES, isEditableSurface } from "./surfaces.js";
import { isEditableRole, isEditableSection } from "./auth.js";

/**
 * API contract (audit C1) — request/response Zod schemas shared by api + web.
 * One source of truth; never redefine these per app.
 */

export const roleSchema = z.enum(USER_ROLES);

/** Structured API error envelope (docs/01 §8). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ── Section access overrides (D-PERM1, EDITABLE-PERMISSIONS-PLAN.md P1) ───────

/**
 * One cell of the permission matrix, as an org wants it.
 *
 * `role` and `section` are validated against the EDITABLE sets rather than the full vocabularies —
 * `admin`/`driver` roles and the `admin` section are rulings (D-PERM7/D-PERM8), and a request
 * naming one of them is a validation failure here rather than a CHECK-constraint 500 further down.
 * The database refuses them too; this is the layer that can say which field was wrong and why.
 */
export const sectionAccessSetSchema = z.object({
  role: z.string().refine(isEditableRole, "That role's access cannot be changed"),
  section: z.string().refine(isEditableSection, "That section's access cannot be changed"),
  access: z.enum(["none", "view", "manage"]),
});
export type SectionAccessSetRequest = z.infer<typeof sectionAccessSetSchema>;

/**
 * `PUT /api/section-access/user` — one answer about one section for one MEMBER (S5, D-SURF7).
 *
 * The sibling of `sectionAccessSetSchema`, and the same shape as `userSurfaceAccessSetSchema` below,
 * for the same reason: a per-person layer needs THREE answers where a per-role layer needs two.
 *
 * ⚠ **`access: null` is the reset.** At the role layer, setting a cell back to its shipped default
 * deletes the row, because the shipped matrix is a value the endpoint can compare against. A person
 * has no shipped default — their fallback is whatever their ROLE resolves to, which can change
 * underneath them — so "inherit" cannot be expressed as one of the three access values without
 * freezing today's answer into a row. It is the absence of a row, and `null` is how a caller asks
 * for it.
 *
 * ⚠ There is no `role` field, so D-PERM7/D-PERM8's role lock cannot live here — the endpoint looks
 * the member's `memberships.role` up in the caller's org, and `custom_access_token_hook` refuses to
 * mint a claim for a locked role whatever rows exist. Migration 0299's header records why a CHECK
 * constraint cannot do it. The `admin` SECTION is refused here, in the table's CHECK and in the hook,
 * because that one IS a security boundary rather than a matter of manners.
 */
export const userSectionAccessSetSchema = z.object({
  userId: z.uuid(),
  section: z.string().refine(isEditableSection, "That section's access cannot be changed"),
  access: z.enum(["none", "view", "manage"]).nullable(),
});
export type UserSectionAccessSetRequest = z.infer<typeof userSectionAccessSetSchema>;

/**
 * `PUT /api/surface-access` — one org-level answer about one screen for one role (S3, D-SURF1).
 *
 * `role` is validated against the EDITABLE set for D-PERM7/D-PERM8's reason. `surfaceKey` is
 * validated against the CATALOGUE rather than against a vocabulary listed here: the catalogue is the
 * single home for what a surface is (D-SURF3), and 0296 deliberately left the column unconstrained
 * because a bad key is inert in SQL. This is the layer that can say which field was wrong and why,
 * so it is the layer that checks.
 *
 * ⚠ Only a surface whose gate is a SECTION gate may be answered. `staff` and `admin` gated screens —
 * Dashboard, Ask AI, Users — are product constants an org may not deny (Q-SURF3, owner's ruling
 * 2026-09-02), and `isEditableSurface` derives that from the gate rather than from a stored flag.
 */
const answerableSurfaceKey = () =>
  z
    .string()
    .refine((k) => SURFACES.some((s) => s.key === k), "No such screen")
    .refine(
      (k) => SURFACES.some((s) => s.key === k && isEditableSurface(s) && s.parent === undefined),
      "That screen is not an organisation's to change",
    );

export const surfaceAccessSetSchema = z.object({
  role: z.string().refine(isEditableRole, "That role's access cannot be changed"),
  surfaceKey: answerableSurfaceKey(),
  allowed: z.boolean(),
});
export type SurfaceAccessSetRequest = z.infer<typeof surfaceAccessSetSchema>;

/**
 * `PUT /api/surface-access/user` — one answer about one screen for one MEMBER (S4, D-SURF7).
 *
 * The sibling of `surfaceAccessSetSchema`, sharing its key validation rather than restating it —
 * "which screens may be answered" is one fact and D-SURF3 says it has one home.
 *
 * Two deliberate differences from the role-level schema, both of which follow from the table being
 * keyed by a person rather than by a role:
 *
 * ⚠ **`allowed` is nullable, and `null` means "no answer — inherit the role's".** At the role layer
 * `allowed: true` IS the reset, because a `true` there is inert (the surface's own gate is checked
 * first, so an allow can never widen past the section — D-SURF2) and `surfaceAccess.ts` deletes the
 * row. Here BOTH booleans are real answers: `false` takes a screen from one member their role keeps,
 * and `true` gives one back to a member whose role has lost it — which is the row 0296's boolean
 * column exists for. So "unchanged" needs a third value, and it is the absence of a row.
 *
 * ⚠ **There is no `role` field, and the admin/driver lock therefore cannot live in this schema.** A
 * row does not know its member's role — that lives in `memberships` and can change after the row is
 * written — so D-PERM7/D-PERM8 are enforced by the endpoint, which looks the membership up in the
 * caller's org, and again by `surfaceClaimFor`, which answers `{}` for a locked role before reading
 * either table. Migration 0298's header records why a CHECK constraint cannot do it here.
 */
export const userSurfaceAccessSetSchema = z.object({
  userId: z.uuid(),
  surfaceKey: answerableSurfaceKey(),
  allowed: z.boolean().nullable(),
});
export type UserSurfaceAccessSetRequest = z.infer<typeof userSurfaceAccessSetSchema>;

// ── Invites ───────────────────────────────────────────────────────────────────
/**
 * A display name as the product accepts it (0301): trimmed, 1–120 characters, no format beyond that —
 * a name is whatever the person says it is. One schema, three writers: the invitation, the
 * acceptance and the Users page, so none of them can disagree about what a name is.
 */
export const fullNameSchema = z.string().trim().min(1).max(120);

export const inviteCreateSchema = z.object({
  email: z.email(),
  role: roleSchema,
  /** The admin usually knows who they are inviting; carried to the acceptance for confirmation. */
  fullName: fullNameSchema.optional(),
});
export type InviteCreateRequest = z.infer<typeof inviteCreateSchema>;

// Acceptance is authorized by the authenticated user's email matching a pending invite in an
// allowed domain (audit M2); an optional token may be supplied for stricter matching.
export const inviteAcceptSchema = z.object({
  token: z.string().min(10).optional(),
  /** The person's own answer; absent, the invitation's name stands (D-MEM3's order, one layer up). */
  fullName: fullNameSchema.optional(),
});
export type InviteAcceptRequest = z.infer<typeof inviteAcceptSchema>;

/**
 * The public redemption of an emailed invitation (2026-09-04). The token is the credential the
 * link carried — ours, stored hashed on the `invites` row — and it travels in the body so it never
 * sits in a request line. `lookup` reads; `redeem` is the one call that spends it.
 */
export const inviteLookupSchema = z.object({
  token: z.string().min(20).max(200),
});
export type InviteLookupRequest = z.infer<typeof inviteLookupSchema>;

export const inviteRedeemSchema = z.object({
  token: z.string().min(20).max(200),
  /** The floor is ours; the project's own password policy (GoTrue) may ask for more and says so. */
  password: z.string().min(8).max(200),
  fullName: fullNameSchema.optional(),
});
export type InviteRedeemRequest = z.infer<typeof inviteRedeemSchema>;

export const invitePreviewSchema = z.object({
  email: z.email(),
  orgName: z.string(),
  role: roleSchema,
  fullName: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const inviteSchema = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expires_at: z.string(),
  created_at: z.string(),
  full_name: z.string().nullable().optional(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const inviteListResponseSchema = z.object({
  invites: z.array(inviteSchema),
});
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;

// ── Members ───────────────────────────────────────────────────────────────────
export const orgMemberSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  /** From `org_member_directory()` (0301): the profile's name, else the roster's for a driver, else null. */
  fullName: z.string().nullable(),
  role: roleSchema,
  joinedAt: z.string(),
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

/** `PATCH /api/members/:id` — a role change, a rename, or both; an empty body changes nothing. */
export const memberUpdateSchema = z
  .object({ role: roleSchema.optional(), fullName: fullNameSchema.optional() })
  .refine((v) => v.role !== undefined || v.fullName !== undefined, { message: "Nothing to change" });
export type MemberUpdateRequest = z.infer<typeof memberUpdateSchema>;

export const memberListResponseSchema = z.object({
  members: z.array(orgMemberSchema),
});
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

// ── Session / me ────────────────────────────────────────────────────────────
export const meResponseSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  /** Read fail-open: a missing profile (or table, during a deploy window) is null, never an error. */
  fullName: z.string().nullable().optional(),
  orgId: z.uuid().nullable(),
  role: roleSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
