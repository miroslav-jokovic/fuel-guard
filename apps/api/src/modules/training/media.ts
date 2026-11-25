import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a training film's files live and how a page is let at them (0646, D-TR1).
 *
 * Every object is under `<org>/<lesson>/<version>/`, in the private `training-media` bucket — the same
 * Supabase Storage as the driver documents, its own bucket. Nobody reads it directly: the office's page
 * and the driver's link page get URLs signed here, after the caller's right to the film is checked.
 */

export const TRAINING_BUCKET = "training-media";

/**
 * How long a signed film URL works. A phone on weak signal fetches the file in ranges for as long as it
 * plays, and a range asked with an expired URL is refused mid-film, so the URL outlives a slow play of
 * the longest film many times over; the link page asks for fresh ones each time it opens a film.
 */
export const FILM_URL_SECONDS = 3 * 3600;

const base = (orgId: string, lessonId: string, versionId: string) => `${orgId}/${lessonId}/${versionId}`;
export const sourcePath = (orgId: string, lessonId: string, versionId: string) => `${base(orgId, lessonId, versionId)}/source.mp4`;
export const renditionPath = (orgId: string, lessonId: string, versionId: string, height: number) => `${base(orgId, lessonId, versionId)}/${height}.mp4`;
export const posterPath = (orgId: string, lessonId: string, versionId: string) => `${base(orgId, lessonId, versionId)}/poster.jpg`;

/** Signed URLs for many paths at once, in the order asked; a path Storage refused maps to null. */
export async function signPaths(admin: SupabaseClient, paths: readonly string[], seconds = FILM_URL_SECONDS): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await admin.storage.from(TRAINING_BUCKET).createSignedUrls([...paths], seconds);
  if (error) throw new Error(`[training] media not signed: ${error.message}`);
  for (const r of data ?? []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  return out;
}

/**
 * A link's token: 18 random bytes, base64url — 24 characters, so a text message stays short, and 144
 * bits, so it cannot be guessed. Only its sha256 is stored (`training_assignments.token_hash`); the
 * token itself exists in what was sent and nowhere else (the applicant links' rule).
 */
export function mintLinkToken(): { token: string; hash: string } {
  const token = randomBytes(18).toString("base64url");
  return { token, hash: hashLinkToken(token) };
}

export const hashLinkToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** A token as it can appear in a URL: exactly the alphabet and length `mintLinkToken` produces. */
export const isLinkToken = (s: string): boolean => /^[A-Za-z0-9_-]{24}$/.test(s);
