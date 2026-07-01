import { z } from "zod";
import { USER_ROLES } from "./constants.js";

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

// ── Invites ───────────────────────────────────────────────────────────────────
export const inviteCreateSchema = z.object({
  email: z.email(),
  role: roleSchema,
});
export type InviteCreateRequest = z.infer<typeof inviteCreateSchema>;

// Acceptance is authorized by the authenticated user's email matching a pending invite in an
// allowed domain (audit M2); an optional token may be supplied for stricter matching.
export const inviteAcceptSchema = z.object({
  token: z.string().min(10).optional(),
});
export type InviteAcceptRequest = z.infer<typeof inviteAcceptSchema>;

export const inviteSchema = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expires_at: z.string(),
  created_at: z.string(),
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
  role: roleSchema,
  joinedAt: z.string(),
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

export const memberListResponseSchema = z.object({
  members: z.array(orgMemberSchema),
});
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

// ── Session / me ────────────────────────────────────────────────────────────
export const meResponseSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  orgId: z.uuid().nullable(),
  role: roleSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
