import type { UserRole } from "./constants.js";
import { IDENTITY_NUMBER_IMAGES_PERMISSION, effectivePermission, type PermissionGrants } from "./rolePermissions.js";

// ── Identity papers whose IMAGE is the number (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P9, §15.1) ──
//
// A photograph of a Social Security card is the nine digits D-HIRE6 seals, as pixels; a passport's
// photo page is an identity number and a face. Who may open one was provisional from P9 (2026-11-01)
// until the owner ruled Q-WF4b on 2026-11-04: "basically safety and recruiting, but in Settings →
// Permissions we should add a permission setting for this". So it is now a NAMED permission
// (`rolePermissions.ts`): admin always, the safety manager and the recruiter by default, every other
// role only if the carrier switches it on. The provisional derivation from the restricted readers
// (`canReadAllRestricted`) is gone — no regulation names who sees these pictures (§15.1).
//
// ⚠ It withholds the IMAGE, never the row. A role refused it must still know the card is on file — the
// hire asks for it — and must not hold a five-minute URL to it. Every service-role path that signs a URL
// for a paper asks `canSeePaperImage` before it signs, with the org's grants read for that request.

/** The `documents.kind`s whose image is gated — each a kind of its own since 0534. */
export const IDENTITY_NUMBER_IMAGE_KINDS = ["ssn_card", "passport"] as const;
const IDENTITY_IMAGE_KIND_SET: ReadonlySet<string> = new Set(IDENTITY_NUMBER_IMAGE_KINDS);

/** Q-WF4b: may this role, at this carrier, open an SSN card's or a passport's picture? */
export const canSeeIdentityNumberImages = (role: UserRole | null | undefined, grants: PermissionGrants): boolean =>
  effectivePermission(role, IDENTITY_NUMBER_IMAGES_PERMISSION, grants);

/** May this role be handed a URL to this paper's image? Every kind but the two above: yes. */
export const canSeePaperImage = (kind: string, role: UserRole | null | undefined, grants: PermissionGrants): boolean =>
  !IDENTITY_IMAGE_KIND_SET.has(kind) || canSeeIdentityNumberImages(role, grants);
