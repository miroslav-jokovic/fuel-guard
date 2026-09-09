import type { SupabaseClient } from "@supabase/supabase-js";
import { traced } from "../inspections/serviceError.js";
import type { ServiceError } from "./types.js";

/**
 * Part photos (INVENTORY-PLAN.md step I3, D-INV8).
 *
 * ── WHY A SIGNED UPLOAD URL AND NOT THE MULTIPART UPLOAD THE STEP DESCRIBES ────────────────────
 * Step I3 says "multipart upload into `inventory-photos/<org>/<part>/…`". This does the same thing
 * by the route `modules/evidence/compliance.ts:117` already established: the API authorises the
 * upload with the service role and hands back a one-shot signed URL, and the BYTES NEVER TOUCH THIS
 * PROCESS. Three reasons it is the better reading of the same requirement.
 *
 *   1. D-INV8's actual words are "uploads go through the API (service role); reads are signed URLs".
 *      A signed upload URL IS the service role authorising the write — the client never holds a key
 *      and the bucket still has no `storage.objects` policy.
 *   2. `apps/api` has no multipart middleware at all. Adding one would put a dependency and a body
 *      buffer in front of a photo taken on a phone in a bay, on a process that also runs the
 *      schedulers.
 *   3. The shop is offline half the time (§2.11). A signed URL can be retried by the client's queue
 *      against Storage directly; a multipart POST cannot be retried without re-sending the bytes
 *      through us.
 *
 * ── THE BUCKET HAS NO CLIENT POLICY, WHICH IS WHY THE PATH IS BUILT HERE ───────────────────────
 * There is no RLS on `storage.objects` for this bucket, so nothing in the database stops a caller
 * writing to another org's folder. The org prefix is not decoration: it is applied HERE, from
 * `req.auth.orgId`, and never taken from the request.
 */

export const INVENTORY_PHOTO_BUCKET = "inventory-photos";
/** Matches `compliance.ts`'s DOCUMENT_URL_TTL_SEC — long enough to render a page, short enough that a leaked URL is stale. */
export const PHOTO_URL_TTL_SEC = 300;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export const isPhotoContentType = (t: string): boolean => t in EXTENSIONS;

/** `<org>/<part>/<uuid>.<ext>` — the org first, so a signed URL's own path carries the boundary. */
export function partPhotoPath(orgId: string, partId: string, photoId: string, contentType: string): string {
  return `${orgId}/${partId}/${photoId}.${EXTENSIONS[contentType] ?? "bin"}`;
}

export async function signPartPhotoUpload(
  admin: SupabaseClient,
  orgId: string,
  partId: string,
  photoId: string,
  contentType: string,
): Promise<{ storagePath: string; uploadUrl: string; token: string } | ServiceError> {
  if (!isPhotoContentType(contentType)) {
    return { error: "A part photo must be a JPEG, PNG, WebP or HEIC image.", code: "unsupported_type" };
  }
  const storagePath = partPhotoPath(orgId, partId, photoId, contentType);
  const { data, error } = await admin.storage.from(INVENTORY_PHOTO_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return traced("signPartPhotoUpload", "sign_failed", "Could not start the photo upload", error);
  return { storagePath, uploadUrl: data.signedUrl, token: data.token };
}

/**
 * Reading one. Returns null rather than an error when the signature fails: a part list whose photo
 * would not sign is still the answer to "what is this part", and failing the page over a thumbnail
 * is the trade `compliance.ts` already refused to make.
 */
export async function signPartPhotoUrl(
  admin: SupabaseClient,
  storagePath: string | null,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data } = await admin.storage.from(INVENTORY_PHOTO_BUCKET).createSignedUrl(storagePath, PHOTO_URL_TTL_SEC);
  return data?.signedUrl ?? null;
}
