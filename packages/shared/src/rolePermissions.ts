import { z } from "zod";
import { EDITABLE_ROLES, isEditableRole, rolesThatManage } from "./auth.js";
import type { UserRole } from "./constants.js";

// ── Named permissions a carrier switches per role (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, D-IDP1..4) ──
//
// Settings → Permissions edits two things per role: a SECTION's level (0291) and a SCREEN's switch (0296).
// Neither fits a question like "may this role see a photograph of a Social Security card": it is not a
// page, and a recruiter who manages recruitment may still be refused it. So the unit is a NAMED
// permission, one switch per role, stored sparse in `org_role_permissions` (0564) — no row means the
// shipped default below.
//
// ⚠ Only a permission no regulation assigns belongs here. The restricted readers (drug and alcohol
// results, Clearinghouse, PSP, employer inquiries) stay bare role tests in auth.ts for ever (D-PERM9):
// §40.321, §382.401 and §391.53 say who reads them, so no carrier may widen them. A picture of an
// identity number is the carrier's own privacy choice, which is why the owner made it a setting
// (Q-WF4b, 2026-11-04).
//
// The admin holds every permission permanently and the driver none: neither role is an org's to edit
// (D-PERM7/D-PERM8, the same two CHECKs as 0291's), so the resolver answers them before any row.

export interface EditablePermission {
  /** `area.name` — the shape 0564's CHECK accepts. */
  key: string;
  /** What the switch says on Settings → Permissions. */
  label: string;
  /** One sentence under it: what the switch hands over. */
  description: string;
  /** The editable roles it starts ON for; every other editable role starts off. */
  shippedRoles: readonly UserRole[];
}

export const IDENTITY_NUMBER_IMAGES_PERMISSION = "recruitment.identity_number_images";

/**
 * Who may close an application — the act that ends the hiring checklist and puts the applicant on the
 * roster (`POST /api/recruitment/hire`, §14 D-OF5's "Close application").
 *
 * ⚠ It was `roster: manage` until 2026-11-09, and that was the wrong unit: the owner ruled "safety and
 * admin can close the application — and this needs to be in Settings so we can select", while
 * `roster: manage` also hands over every write on the driver roster and is shipped to the fleet
 * manager. Narrowing the fleet manager's roster to stop them closing would have taken their roster
 * away; granting a recruiter roster to let them close would have handed them the roster (the leak
 * RECRUITER-ROLE-SCOPE.md Option B closed). A named switch asks exactly the one question.
 *
 * No regulation names who closes an application (the six federal checks are what the hire refuses
 * on, whoever presses it), so this is the carrier's own choice and belongs here, not in auth.ts.
 */
export const CLOSE_APPLICATION_PERMISSION = "recruitment.close_application";

/**
 * Who may read an applicant's whole Social Security number (Q-AM17, owner 2026-11-11): "admin and
 * safety". Everyone else who works the application — the recruiter included — sees the last four and
 * may only REPLACE it (Q-AM13's replace-only rule, kept for the nine digits). Not Q-WF4b's picture
 * switch: that one ships to the recruiter, and a number on a screen is not a photograph of a card.
 * No regulation names the reader, so it is the carrier's to switch, here.
 */
export const FULL_SSN_PERMISSION = "recruitment.full_ssn";

/**
 * Who may edit and remove ANYBODY'S unit note (UNIT-NOTES-PLAN D-UN19, owner 2026-11-12: "an admin with
 * permission to edit notes will be able to edit and delete notes for all users and authors"). The author
 * edits and removes their own note without it (D-UN15, D-UN16). A note is the office's own working
 * sentence — no regulation names who corrects it — so it is the carrier's switch, here. Ships to nobody
 * but the admin, who holds every permission; an admin hands it to a role on Settings → Permissions.
 */
export const NOTES_MANAGE_ALL_PERMISSION = "notes.manage_all";

/**
 * Who may mark, change, end, cancel and reopen a driver's home time (HOME-TIME-PLAN D-HT7, owner
 * 2026-11-13: "a button for dispatchers"). The period is a roster row (`driver_time_off`), and the
 * dispatcher holds `roster: view` only — on purpose, since `roster: manage` is every write on the driver
 * roster. Neither section says "may record that a driver went home", which is the question, so it is
 * asked by name (the recruiter's applicant row is the same case). No regulation names who records it.
 *
 * Ships to every role that manages Dispatch, DERIVED from the matrix: a role given Dispatch tomorrow
 * marks home time without this list being remembered.
 */
export const HOME_TIME_PERMISSION = "roster.home_time";

/**
 * Who may open the lumper cases, file the broker's revised rate confirmation on one, and close one with
 * a reason (LUMPER-REVISED-RC-PLAN D-LRC11; owner 2026-11-13: "dispatchers and billing and other users
 * we select"). Asked by name because no section says it: the dispatcher holds `dispatch` and no money
 * section, the accountant holds `billing` and `dispatch: none`, and both must see the same list. Gating
 * it on either section would have locked the other out, and adding a section for one page is the
 * heavier answer to the same question.
 *
 * Ships to every role that manages Dispatch or Billing, DERIVED from the matrix. "Other users we
 * select" is an admin switching it on for another role on Settings → Permissions.
 */
export const LUMPER_CASES_PERMISSION = "dispatch.lumper_cases";

export const EDITABLE_PERMISSIONS = [
  {
    key: IDENTITY_NUMBER_IMAGES_PERMISSION,
    label: "See SSN-card and passport pictures",
    description:
      "Open the picture of an applicant's or driver's Social Security card or passport. Without it the paper is listed as on file and its picture is withheld.",
    // Owner, Q-WF4b (2026-11-04): "basically safety and recruiting".
    shippedRoles: ["safety_manager", "recruiter"],
  },
  {
    key: CLOSE_APPLICATION_PERMISSION,
    label: "Close an application",
    description:
      "Close a finished application, which puts the applicant on the roster. The six federal checks must still be on file whoever closes it.",
    // Owner, 2026-11-09: "Safety and admin can close application" — the admin holds every permission.
    shippedRoles: ["safety_manager"],
  },
  {
    key: FULL_SSN_PERMISSION,
    label: "See the full SSN",
    description:
      "Read all nine digits of an applicant's Social Security number and open the signed application with it printed in full. Without it the number shows as its last four and can only be replaced.",
    // Owner, Q-AM17 (2026-11-11): "admin and safety" — the admin holds every permission.
    shippedRoles: ["safety_manager"],
  },
  {
    key: NOTES_MANAGE_ALL_PERMISSION,
    label: "Edit and remove anyone's note",
    description:
      "Change or remove any note on a driver, truck or trailer, whoever wrote it. Without it a person edits and removes only their own notes. Every edit and removal is on the Audit page, and the old words are kept.",
    // Owner, 2026-11-12: admin only to start — the admin holds every permission.
    shippedRoles: [],
  },
  {
    key: HOME_TIME_PERMISSION,
    label: "Mark a driver's home time",
    description:
      "Record that a driver is going home and when he is due back, change the return, and mark him back. Without it a person sees who is home on the Dispatch board and cannot change it.",
    // D-HT7: whoever manages Dispatch (the admin holds every permission and is not an editable role).
    shippedRoles: rolesThatManage("dispatch").filter(isEditableRole),
  },
  {
    key: LUMPER_CASES_PERMISSION,
    label: "Work the lumper cases",
    description:
      "See every load where we paid a lumper, what was paid and where, and whether the broker's revised rate confirmation is on file. File the revised RC on a case and close a case with a reason.",
    // D-LRC11: whoever manages Dispatch or Billing (the admin holds every permission).
    shippedRoles: [...new Set([...rolesThatManage("dispatch"), ...rolesThatManage("billing")])].filter(isEditableRole),
  },
] as const satisfies readonly EditablePermission[];

export type EditablePermissionKey = (typeof EDITABLE_PERMISSIONS)[number]["key"];
export const EDITABLE_PERMISSION_KEYS = EDITABLE_PERMISSIONS.map((p) => p.key) as EditablePermissionKey[];

export const isEditablePermissionKey = (key: string): key is EditablePermissionKey =>
  (EDITABLE_PERMISSION_KEYS as string[]).includes(key);

/** Sparse, like `SectionOverrides`: a missing entry is the shipped default, never "denied". */
export type PermissionGrants = Partial<Record<UserRole, Partial<Record<EditablePermissionKey, boolean>>>>;

/**
 * What a failed read of the org's rows answers: every editable role OFF, the admin still on.
 *
 * ⚠ Closed, not the shipped default (a departure from §15.1 D-IDP3 as first written, recorded there).
 * The shipped default includes the recruiter, so an org that switched the recruiter off would, on a
 * failed read, hand the recruiter the picture it had refused. A picture withheld for one request is a
 * retry; a picture shown against the carrier's setting cannot be taken back.
 */
export const CLOSED_PERMISSION_GRANTS: PermissionGrants = Object.fromEntries(
  EDITABLE_ROLES.map((r) => [r, Object.fromEntries(EDITABLE_PERMISSION_KEYS.map((k) => [k, false]))]),
);

/** The shipped answer, before any org row. */
export function shippedPermission(role: UserRole | null | undefined, key: EditablePermissionKey): boolean {
  if (role === "admin") return true;
  if (!role || !(EDITABLE_ROLES as string[]).includes(role)) return false;
  const entry = EDITABLE_PERMISSIONS.find((p) => p.key === key);
  return !!entry && (entry.shippedRoles as readonly string[]).includes(role);
}

/** The one resolver every reader asks: admin always, driver never, else the org's row, else shipped. */
export function effectivePermission(
  role: UserRole | null | undefined,
  key: EditablePermissionKey,
  grants: PermissionGrants,
): boolean {
  if (role === "admin") return true;
  if (!role || !(EDITABLE_ROLES as string[]).includes(role)) return false;
  return grants[role]?.[key] ?? shippedPermission(role, key);
}

/**
 * Every named permission for one caller, answered by `effectivePermission` — what `/api/me` serves so a
 * screen hides a button the API would refuse, from the same resolver the API's gate asks.
 */
export type CallerPermissions = Record<EditablePermissionKey, boolean>;

export function callerPermissions(role: UserRole | null | undefined, grants: PermissionGrants): CallerPermissions {
  return Object.fromEntries(
    EDITABLE_PERMISSION_KEYS.map((k) => [k, effectivePermission(role, k, grants)]),
  ) as CallerPermissions;
}

export interface RolePermissionRow {
  role: string;
  permission: string;
  allowed: boolean;
}

/**
 * Rows → the sparse grants. A row naming a role or a permission this build does not offer is skipped,
 * never trusted: 0564's CHECKs and the PUT's schema refuse it first, so reaching one means something
 * else wrote it — honouring it could widen a permission the page cannot even show.
 */
export function toPermissionGrants(rows: readonly RolePermissionRow[]): PermissionGrants {
  const out: PermissionGrants = {};
  for (const r of rows) {
    if (!(EDITABLE_ROLES as string[]).includes(r.role)) continue;
    if (!isEditablePermissionKey(r.permission)) continue;
    if (typeof r.allowed !== "boolean") continue;
    (out[r.role as UserRole] ??= {})[r.permission] = r.allowed;
  }
  return out;
}

/** `PUT /api/role-permissions` — one switch. `allowed: null` puts the role back on the shipped default. */
export const rolePermissionSetSchema = z.object({
  role: z.string().refine((r) => (EDITABLE_ROLES as string[]).includes(r), "That role cannot be changed"),
  permission: z.string().refine(isEditablePermissionKey, "Unknown permission"),
  allowed: z.boolean().nullable(),
});
export type RolePermissionSetRequest = z.infer<typeof rolePermissionSetSchema>;

/** `GET /api/role-permissions` — the org's switches and the catalogue they are read against (D-PERM4). */
export interface RolePermissionsResponse {
  permissions: { key: EditablePermissionKey; label: string; description: string; shippedRoles: UserRole[] }[];
  grants: PermissionGrants;
  editableRoles: UserRole[];
}
