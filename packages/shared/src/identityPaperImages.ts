import { canReadAllRestricted } from "./auth.js";
import type { UserRole } from "./constants.js";

// ── Identity papers whose IMAGE is the number (Q-WF4, HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P9) ──
//
// A photograph of a Social Security card is the nine digits D-HIRE6 seals, as pixels; a passport's
// photo page is an identity number and a face. The owner's ruling Q-WF4 (a): "the roles that see the
// full SSN today". ⚠ **Measured 2026-11-01, no role does** — `driver_applications.ssn_sealed` is
// written by `sealSsn` and opened by nothing; every projection carries `ssn_last4` at most. So the
// ruling's premise has no rule to derive from, and the question is recorded as Q-WF4b in the audit's
// §6 with the candidates. Until the owner answers it, the image belongs to the narrowest read this
// matrix already grants — BOTH restricted halves (`canReadAllRestricted`: admin + safety_manager),
// the entitlement a whole-file export of the most sensitive records needs. Derived, not listed, so
// the answer moves with the matrix; and narrow, so the provisional answer can only widen.
//
// ⚠ It withholds the IMAGE, never the row. A recruiter must know the card is on file — the hire asks
// for it — and must not hold a five-minute URL to it. Every service-role path that signs a URL for a
// paper asks `canSeePaperImage` before it signs.

/** The `documents.kind`s whose image is gated — each a kind of its own since 0534. */
export const IDENTITY_NUMBER_IMAGE_KINDS = ["ssn_card", "passport"] as const;
const IDENTITY_IMAGE_KIND_SET: ReadonlySet<string> = new Set(IDENTITY_NUMBER_IMAGE_KINDS);

/** Q-WF4 (provisional, Q-WF4b): who may open an SSN card's or a passport's picture. */
export const canSeeIdentityNumberImages = (role: UserRole | null | undefined): boolean =>
  canReadAllRestricted(role);

/** May this role be handed a URL to this paper's image? Every kind but the two above: yes. */
export const canSeePaperImage = (kind: string, role: UserRole | null | undefined): boolean =>
  !IDENTITY_IMAGE_KIND_SET.has(kind) || canSeeIdentityNumberImages(role);
