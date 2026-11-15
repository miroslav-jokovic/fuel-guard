/**
 * The documents-only link (APPLICATION-FIX-PLAN.md, owner's Q-AM19 ruling; migration 0608): a link the
 * office sends that opens the applicant's documents list and nothing else.
 *
 * ── NARROW BY CONSTRUCTION ────────────────────────────────────────────────────────────────────
 * Its token is a fourth one on the invitation and is accepted by its OWN resolver
 * (`resolveDocumentsLink`), which only the photograph routes and this bundle call. The application's
 * resolver does not know it. So the link cannot read a draft, answer the date-of-birth question, sign a
 * permission or mark the packet — not because a page hides those, but because no route that does them
 * takes this token. That is what lets it outlive the application's own link, which is its purpose.
 */

/** How long a sent documents link works. Two weeks: long enough for a medical card appointment. */
export const DOCUMENTS_LINK_TTL_DAYS = 14;

/** What the documents link opens on (`GET /api/public/application/:token` answers this for that token). */
export interface DocumentsLinkBundle {
  documentsOnly: true;
  carrier: string;
  /** The LINK's end, not the application's. */
  expiresAt: string;
  /** The device-copy key (`localCopyKey`) — the same on every door, so a photo held on the phone is found. */
  localKey: string;
  captures: unknown[];
  offeredDocumentSlots: readonly string[];
}
