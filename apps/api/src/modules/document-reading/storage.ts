/**
 * Where the reader keeps bytes: the private `document-intake` bucket (0448, 25 MB cap =
 * `INTAKE_LIMITS.maxBytes`). It has no `storage.objects` policy, so nothing in the database stops a
 * caller writing into another org's folder — the org prefix is applied HERE, from the authenticated
 * org, and never taken from a request (the rule `inventory/photos.ts` states for its bucket).
 *
 *   <org>/<source>/source-<sha256>   the file as received
 *   <org>/<source>/pages/<n>.png     page n's lossless original (its sha256 is on `document_pages`)
 *   <org>/<source>/pages/<n>.webp    page n's working copy — what the reviewer's screen shows
 *
 * The received file's key carries its announced SHA-256. Registration writes no row (the source row
 * needs a page count, which only exists after rendering), so the key is where the announcement is
 * kept: the intake downloads exactly that key and compares the bytes with the hash in its name.
 */
export const DOCUMENT_BUCKET = "document-intake";

/** Matches `inventory/photos.ts`'s and `compliance.ts`'s TTL: long enough to render a page, short enough that a leaked URL is stale. */
export const PAGE_URL_TTL_SEC = 300;

export const sourceObjectPath = (orgId: string, sourceId: string, sha256: string): string =>
  `${orgId}/${sourceId}/source-${sha256}`;

export const pageObjectPaths = (orgId: string, sourceId: string, page: number): { original: string; working: string } => ({
  original: `${orgId}/${sourceId}/pages/${page}.png`,
  working: `${orgId}/${sourceId}/pages/${page}.webp`,
});
