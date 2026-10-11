import type { AppSection, SectionAccess, SectionClaim } from "./auth.js";
import type { SurfaceClaim } from "./surfaces.js";

/**
 * Which layer answered a permission, and the names a person reads for the sections
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S6, D-SURF6; moved here by SETTINGS-
 * PERMISSIONS-PLAN.md SP10, Q-SET10).
 *
 * ── WHY THIS MOVED OUT OF THE WEB ───────────────────────────────────────────────────────────────
 * Until SP10 the Permissions page was the only reader of "which layer won", and these lived in
 * `apps/web/src/features/permissions/layers.ts` and `labels.ts`, with a comment saying that one
 * home inside the one feature that needed it was right. SP10 added a second reader in a different
 * app: the access-review CSV is rendered by the API (so the audit row and the file describe one
 * read), and it has to say "Personal", "Role" or "Default" for exactly the cells the page tags the
 * same way. Two copies of the precedence would be the restatement this repo calls a workaround with
 * a delay fuse, so the precedence moved to the package both apps already read, and the web module
 * re-exports it unchanged — its callers and its tests did not move.
 */
export type AccessLayer = "default" | "role" | "user";

/**
 * The words on a cell's marker, and in the tests that pin them. One word each, because the marker
 * sits beside the control on every row and a two-word tag eleven times over is noise: "Default" is
 * the shipped matrix, "Role" is what this organisation answered for the whole role, "Personal" is
 * this one person's own row.
 */
export const LAYER_LABELS: Record<AccessLayer, string> = {
  default: "Default",
  role: "Role",
  user: "Personal",
};

/**
 * Reader-facing names for the twelve sections. The KEYS are the product's vocabulary
 * (`auth.ts`); these are the words a person reads — on the Permissions page and, since SP10, in the
 * access-review file an auditor is handed.
 */
export const SECTION_LABELS: Record<AppSection, string> = {
  fuel: "Fuel",
  dispatch: "Dispatch",
  safety: "Safety",
  hazmat: "HazmatGuard",
  roster: "Roster",
  equipment: "Equipment",
  recruitment: "Recruitment",
  admin: "Admin",
  settings: "Settings",
  accounting: "Accounting",
  billing: "Billing",
  maintenance: "Maintenance",
};

/**
 * The words for the three section answers — the Permissions page's segmented control and the
 * access-review file read the same three, so an auditor comparing one to the other meets one word.
 */
export const ACCESS_LABELS: Record<SectionAccess, string> = { none: "None", view: "View", manage: "Manage" };

export interface SectionCell {
  access: SectionAccess;
  layer: AccessLayer;
}

/**
 * One section cell for one MEMBER: shipped default → org role override → this person's override.
 *
 * `undefined` at a layer means that layer said nothing, which is D-PERM4's sparseness — never a
 * denial. Note the middle layer is where a role-level page and a person-level page differ: for a
 * ROLE there are only two layers, because the person's row does not apply to the role.
 */
export function sectionCell(
  shipped: SectionAccess,
  roleOverride: SectionAccess | undefined,
  userOverride: SectionAccess | undefined,
): SectionCell {
  if (userOverride !== undefined) return { access: userOverride, layer: "user" };
  if (roleOverride !== undefined) return { access: roleOverride, layer: "role" };
  return { access: shipped, layer: "default" };
}

export interface SurfaceCell {
  allowed: boolean;
  layer: AccessLayer;
}

/**
 * One screen cell.
 *
 * A screen's shipped answer is its section gate (D-SURF2), asked separately — and, since SP1, its
 * starting default (`startsOn`). For most screens that is `true`, the catalogue as it always
 * shipped. For a screen Q-SET2 starts OFF for this role it is `false`, and "no row anywhere" must
 * read as off, or the page would draw Organization as switched on for a fleet manager whom the
 * guard refuses.
 */
export function surfaceCell(
  roleOverride: boolean | undefined,
  userOverride: boolean | undefined,
  startsOn = true,
): SurfaceCell {
  if (userOverride !== undefined) return { allowed: userOverride, layer: "user" };
  if (roleOverride !== undefined) return { allowed: roleOverride, layer: "role" };
  return { allowed: startsOn, layer: "default" };
}

/**
 * The claims a MEMBER is answered from — their own answers over their role's (D-SURF6). The same
 * one-line precedence `custom_access_token_hook` (sections) and `surfaceClaimFor` (screens) apply
 * server-side; the page previews an answer that has not been minted yet, and the access review
 * reports the one that has.
 */
export const mergedSectionClaim = (role: SectionClaim, user: SectionClaim): SectionClaim => ({
  ...role,
  ...user,
});
export const mergedSurfaceClaim = (role: SurfaceClaim, user: SurfaceClaim): SurfaceClaim => ({
  ...role,
  ...user,
});
