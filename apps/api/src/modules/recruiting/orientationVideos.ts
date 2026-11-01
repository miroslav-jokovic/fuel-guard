import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OrientationVideo,
  OrientationVideoCreate,
  OrientationVideoFacts,
  OrientationVideoUpdate,
} from "@silvicom/shared";
import { fetchAllPagedIn } from "../../lib/paging.js";

/**
 * The carrier's orientation videos (HW8a, 0539; HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8, §8.2) — the list
 * in Settings → Recruiting, and the facts the checklist folds.
 *
 * ── THE LIST ──────────────────────────────────────────────────────────────────────────────────
 * Links, never files (§8.2: "a link list and an attestation tick"). A video is retired, never deleted
 * (OV010), and its link never changes (OV011): the applicant's "I watched these" names videos, and a
 * row that vanished or moved its link would leave that statement pointing at nothing or at something
 * else. So the update is the office's words, length, required and place — or retire, once (OV012).
 *
 * ── THE FACTS (`HiringChecklistInputs.orientationVideos`) ─────────────────────────────────────
 * One batched read for the board as for the record: the carrier's required, live ids (once), every id
 * each driver attested (any tick, any invitation — watching is a fact about the person), and the
 * office's last send on the invitation the checklist folds. The fold decides; this only reads.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS.
 */

const COLS = "id, title, url, minutes, required, position, created_at, retired_at";

export type OrientationVideoError = { status: number; code: string; message: string };
export const isOrientationVideoError = (v: unknown): v is OrientationVideoError =>
  typeof v === "object" && v !== null && "status" in v && "code" in v;

/** The live list, in the office's order (position, then when added). Throws on a failed read. */
export async function listOrientationVideos(admin: SupabaseClient, orgId: string): Promise<OrientationVideo[]> {
  const { data, error } = await admin
    .from("orientation_videos")
    .select(COLS)
    .eq("org_id", orgId)
    .is("retired_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the orientation videos: ${error.message}`);
  return (data ?? []) as OrientationVideo[];
}

/** A new video, placed after the last one on the live list. */
export async function createOrientationVideo(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  input: OrientationVideoCreate,
): Promise<OrientationVideo> {
  const live = await listOrientationVideos(admin, orgId);
  const position = live.length === 0 ? 0 : Math.min(1000, Math.max(...live.map((v) => v.position)) + 1);
  const { data, error } = await admin
    .from("orientation_videos")
    .insert({
      org_id: orgId, title: input.title, url: input.url, minutes: input.minutes, required: input.required,
      position, created_by: userId,
    })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`Could not add the video: ${error?.message ?? "no row"}`);
  return data as OrientationVideo;
}

/** Change a live video's words, length, required or place — or retire it (one-way, OV012). */
export async function updateOrientationVideo(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  videoId: string,
  patch: OrientationVideoUpdate,
  now: Date = new Date(),
): Promise<OrientationVideo | OrientationVideoError> {
  const changes: Record<string, unknown> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.minutes !== undefined) changes.minutes = patch.minutes;
  if (patch.required !== undefined) changes.required = patch.required;
  if (patch.position !== undefined) changes.position = patch.position;
  if (patch.retire) Object.assign(changes, { retired_at: now.toISOString(), retired_by: userId });
  const { data, error } = await admin
    .from("orientation_videos")
    .update(changes)
    .eq("org_id", orgId)
    .eq("id", videoId)
    // A retired video is finished: neither edited nor retired twice (OV012 says so too).
    .is("retired_at", null)
    .select(COLS);
  if (error) throw new Error(`Could not change the video: ${error.message}`);
  const row = ((data ?? []) as OrientationVideo[])[0];
  if (!row) return { status: 404, code: "not_found", message: "That video is not on your list, or it was already removed." };
  return row;
}

export interface VideoSubject {
  driverId: string;
  invitationId: string | null;
}

/**
 * The fold's facts for every subject, in three reads however many applicants. `null` for nobody: a carrier
 * with no required video gets facts with an empty `required`, which the fold reads as "not measured".
 */
export async function readOrientationVideoFacts(
  admin: SupabaseClient,
  orgId: string,
  subjects: readonly VideoSubject[],
): Promise<Map<string, OrientationVideoFacts>> {
  const out = new Map<string, OrientationVideoFacts>();
  if (subjects.length === 0) return out;
  const driverIds = subjects.map((s) => s.driverId);
  const invitationIds = subjects.map((s) => s.invitationId).filter((id): id is string => Boolean(id));

  // Chunked and paged like every board read (`applicantBoardReads.ts`): a whole board's ids in one `.in()`
  // overflows the URL, and PostgREST caps a page at 1,000 rows.
  type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  const [live, attested, sent] = await Promise.all([
    listOrientationVideos(admin, orgId),
    fetchAllPagedIn<{ driver_id: string; video_ids: string[] }>(driverIds, (chunk) => (from, to) =>
      admin
        .from("orientation_video_attestations")
        .select("id, driver_id, video_ids")
        .eq("org_id", orgId)
        .in("driver_id", chunk)
        .order("id")
        .range(from, to) as unknown as Page<{ driver_id: string; video_ids: string[] }>),
    fetchAllPagedIn<{ id: string; orientation_videos_sent_at: string | null }>(invitationIds, (chunk) => (from, to) =>
      admin
        .from("application_invitations")
        .select("id, orientation_videos_sent_at")
        .eq("org_id", orgId)
        .in("id", chunk)
        .order("id")
        .range(from, to) as unknown as Page<{ id: string; orientation_videos_sent_at: string | null }>),
  ]);

  const required = live.filter((v) => v.required).map((v) => v.id);
  const byDriver = new Map<string, Set<string>>();
  for (const r of attested) {
    const set = byDriver.get(r.driver_id) ?? new Set<string>();
    for (const id of r.video_ids ?? []) set.add(id);
    byDriver.set(r.driver_id, set);
  }
  const sentAt = new Map(
    sent.map((r) => [r.id, r.orientation_videos_sent_at] as const),
  );
  for (const s of subjects) {
    out.set(s.driverId, {
      required,
      attested: [...(byDriver.get(s.driverId) ?? [])],
      sentAt: s.invitationId ? (sentAt.get(s.invitationId) ?? null) : null,
    });
  }
  return out;
}
