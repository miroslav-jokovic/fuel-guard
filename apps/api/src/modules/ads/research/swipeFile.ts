import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  SWIPE_EVIDENCE_DAYS, adAssetRefSchema, pageEvidence, pageReadingSchema, pictureEvidence, pictureReadingSchema,
  type AdsSwipeEntryView, type AdsSwipePageSave, type AdsSwipePictureSave, type EvidenceItem, type PageItem, type PageItemDrop, type PictureReading,
} from "@silvicom/shared";
import { acceptAsset, readAdAsset } from "../creative/brandAssets.js";
import type { ClaudeGenerationDeps } from "../generations/claudeGeneration.js";
import type { Actor } from "../settings/settingsVersions.js";
import { readPage } from "../workers/researcher/researcher.js";
import { readPicture } from "../workers/swipeReader/swipeReader.js";
import { PAGE_FETCH_WORDS, fetchPage, type PageFetchDeps } from "./pageFetch.js";

/**
 * The swipe file (ADS-PLATFORM-V2-PLAN V2r, D-AD36; 0632): what a recruiter saves, the read step that turns an
 * entry into a reading, and the evidence items a campaign's pack takes from it. Every query names the org: the
 * service role bypasses RLS.
 *
 * ── THE READ STEP ──────────────────────────────────────────────────────────────────────────────────────
 * An entry is saved `waiting` and the `ads_swipe_read` job reads it: a page is fetched by code and read by the
 * Researcher, a picture is read by the Swipe reader. The result is written onto the row only if it is still the
 * same attempt (`read_attempt`), so a "Read again" pressed while a read was running is not overwritten by the
 * older read. Each way it can end is a sentence the office reads on the entry (`last_error`): switched off, out of
 * budget, the site refused, nothing could be kept.
 *
 * ── WHAT A PACK TAKES ──────────────────────────────────────────────────────────────────────────────────
 * Entries read within `SWIPE_EVIDENCE_DAYS` and not removed, newest first; the pack's own limit decides how many
 * items fit (`buildEvidencePack`), so the newest readings win when there are more than room.
 */

export const SWIPE_LIST_LIMIT = 200;
const COLUMNS = "id, kind, url, asset, note, state, read_attempt, reading, dropped, last_error, read_at, created_at, created_by_name, archived_at";

const rowSchema = z.object({
  id: z.string(), kind: z.enum(["page", "picture"]), url: z.string().nullable(), asset: z.unknown(), note: z.string().nullable(),
  state: z.enum(["waiting", "read", "unreadable"]), read_attempt: z.number().int(), reading: z.unknown(), dropped: z.unknown(),
  last_error: z.string().nullable(), read_at: z.string().nullable(), created_at: z.string(), created_by_name: z.string().nullable(), archived_at: z.string().nullable(),
});
type Row = z.infer<typeof rowSchema>;
const dropSchema = z.array(z.object({ index: z.number(), reason: z.enum(["quote_not_on_page", "figure_not_in_quote"]), figure: z.string().optional() }));

function readingOf(r: Row): PageItem[] | PictureReading | null {
  if (r.reading === null || r.reading === undefined) return null;
  const parsed = r.kind === "page" ? pageReadingSchema.shape.items.safeParse(r.reading) : pictureReadingSchema.safeParse(r.reading);
  return parsed.success ? parsed.data : null;
}

export function toView(r: Row): AdsSwipeEntryView {
  const dropped = dropSchema.safeParse(r.dropped);
  return {
    id: r.id, kind: r.kind, url: r.url, note: r.note, state: r.state, reading: readingOf(r), dropped: dropped.success ? dropped.data : [],
    last_error: r.last_error, read_at: r.read_at, created_at: r.created_at, created_by_name: r.created_by_name,
  };
}

export async function listSwipe(admin: SupabaseClient, orgId: string): Promise<AdsSwipeEntryView[]> {
  const { data, error } = await admin.from("ads_swipe_entries").select(COLUMNS).eq("org_id", orgId).is("archived_at", null)
    .order("created_at", { ascending: false }).limit(SWIPE_LIST_LIMIT);
  if (error) throw new Error(`ads_swipe_entries: ${error.message}`);
  return z.array(rowSchema).parse(data ?? []).map(toView);
}

async function insertEntry(admin: SupabaseClient, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from("ads_swipe_entries").insert(row).select("id").single();
  if (error) throw new Error(`ads_swipe_entries: ${error.message}`);
  return (data as { id: string }).id;
}

export async function saveSwipePage(admin: SupabaseClient, orgId: string, actor: Actor, save: AdsSwipePageSave): Promise<{ id: string }> {
  return { id: await insertEntry(admin, { org_id: orgId, kind: "page", url: save.url, asset: null, note: save.note, created_by: actor.id, created_by_name: actor.name }) };
}

export type PictureSaveOutcome = { kind: "saved"; id: string } | { kind: "not_found" } | { kind: "refused"; code: string };

/** A picture is accepted the way a brand-kit photo is (`acceptAsset`: the bytes decide what it is) and kept by hash. */
export async function saveSwipePicture(admin: SupabaseClient, orgId: string, actor: Actor, save: AdsSwipePictureSave): Promise<PictureSaveOutcome> {
  const accepted = await acceptAsset(admin, orgId, save.upload_id);
  if (accepted.kind === "not_found") return { kind: "not_found" };
  if (accepted.kind === "refused") return { kind: "refused", code: accepted.code };
  return { kind: "saved", id: await insertEntry(admin, { org_id: orgId, kind: "picture", url: null, asset: accepted.asset, note: save.note, created_by: actor.id, created_by_name: actor.name }) };
}

/** Removed, never deleted (`ADS_AUTHORITY.delete_anything` is "never"): out of the list and of every new pack. */
export async function archiveSwipe(admin: SupabaseClient, orgId: string, id: string, now: Date): Promise<boolean> {
  const { data, error } = await admin.from("ads_swipe_entries").update({ archived_at: now.toISOString() })
    .eq("org_id", orgId).eq("id", id).is("archived_at", null).select("id");
  if (error) throw new Error(`ads_swipe_entries: ${error.message}`);
  return (data ?? []).length === 1;
}

export type ReadAgainOutcome = { kind: "queued"; attempt: number } | { kind: "not_found" } | { kind: "waiting" };

/** "Read again": the next attempt, so the model call has a new key and the ledger keeps the earlier one. */
export async function readAgain(admin: SupabaseClient, orgId: string, id: string): Promise<ReadAgainOutcome> {
  const row = await entry(admin, orgId, id);
  if (!row || row.archived_at) return { kind: "not_found" };
  if (row.state === "waiting") return { kind: "waiting" };
  const attempt = row.read_attempt + 1;
  const { data, error } = await admin.from("ads_swipe_entries")
    .update({ state: "waiting", read_attempt: attempt, reading: null, dropped: [], last_error: null, read_at: null, page_sha256: null, generation_id: null })
    .eq("org_id", orgId).eq("id", id).eq("read_attempt", row.read_attempt).select("id");
  if (error) throw new Error(`ads_swipe_entries: ${error.message}`);
  return (data ?? []).length === 1 ? { kind: "queued", attempt } : { kind: "waiting" };
}

async function entry(admin: SupabaseClient, orgId: string, id: string): Promise<Row | null> {
  const { data, error } = await admin.from("ads_swipe_entries").select(COLUMNS).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(`ads_swipe_entries: ${error.message}`);
  return data ? rowSchema.parse(data) : null;
}

// ── the read step (`ads_swipe_read`) ───────────────────────────────────────────────────────────────────
export interface SwipeReadDeps extends ClaudeGenerationDeps {
  page?: PageFetchDeps;
  readAsset?: typeof readAdAsset;
}

export type SwipeReadOutcome = { kind: "read" | "unreadable" | "skipped"; detail: string } | { kind: "pending"; why: string };

export async function readSwipeEntry(deps: SwipeReadDeps, orgId: string, id: string): Promise<SwipeReadOutcome> {
  const row = await entry(deps.admin, orgId, id);
  if (!row || row.archived_at || row.state !== "waiting") return { kind: "skipped", detail: row ? `the entry is ${row.archived_at ? "removed" : row.state}` : "no such entry" };
  const attempt = row.read_attempt;
  const finish = async (patch: Record<string, unknown>, kind: "read" | "unreadable", detail: string): Promise<SwipeReadOutcome> => {
    const { error } = await deps.admin.from("ads_swipe_entries").update({ ...patch, read_at: deps.now().toISOString() })
      .eq("org_id", orgId).eq("id", id).eq("read_attempt", attempt).eq("state", "waiting");
    if (error) throw new Error(`ads_swipe_entries: ${error.message}`);
    return { kind, detail };
  };
  const unreadable = (why: string, extra: Record<string, unknown> = {}) => finish({ state: "unreadable", last_error: why, ...extra }, "unreadable", why);
  const who = row.kind === "page" ? "Researcher" : "Swipe reader";

  if (row.kind === "page") {
    const page = await fetchPage(deps.page ?? {}, row.url!);
    if (!page.ok) {
      // The office reads the refusal's words; the detail (which may name an address) goes to the log only.
      console.warn(`[ads-swipe] page ${id} not read — ${page.refusal}: ${page.detail}`);
      return unreadable(PAGE_FETCH_WORDS[page.refusal]);
    }
    const out = await readPage(deps, { orgId, entryId: id, attempt, url: page.url, text: page.text });
    if (out.kind === "in_flight") return { kind: "pending", why: `the ${who} is still reading` };
    if (out.kind !== "read") return unreadable(stopWords(who, out));
    const extra = { page_sha256: page.sha256, generation_id: out.generationId, dropped: out.dropped satisfies PageItemDrop[] };
    if (out.kept.length > 0) return finish({ state: "read", reading: out.kept, last_error: null, ...extra }, "read", `${out.kept.length} kept, ${out.dropped.length} dropped`);
    return unreadable(out.dropped.length > 0
      ? `Nothing could be kept: each of the ${out.dropped.length} facts the ${who} wrote failed the check against the page.`
      : "The page states nothing about a job.", extra);
  }

  const ref = adAssetRefSchema.safeParse(row.asset);
  if (!ref.success) return unreadable("The saved picture could not be found.");
  const bytes = await (deps.readAsset ?? readAdAsset)(deps.admin, orgId, ref.data);
  const out = await readPicture(deps, { orgId, entryId: id, attempt, image: { format: ref.data.format, bytes: new Uint8Array(bytes) }, note: row.note });
  if (out.kind === "in_flight") return { kind: "pending", why: `the ${who} is still reading` };
  if (out.kind !== "read") return unreadable(stopWords(who, out));
  return finish({ state: "read", reading: out.reading, generation_id: out.generationId, last_error: null }, "read", "read");
}

function stopWords(who: string, out: { kind: "agent_off" } | { kind: "budget_exhausted"; refusal: string } | { kind: "failed"; errorCode: string }): string {
  switch (out.kind) {
    case "agent_off": return `The ${who} is switched off in the ads settings. Switch it on, then press Read again.`;
    case "budget_exhausted": return out.refusal === "budget_unset" ? "No monthly AI budget is set in the ads settings." : "This month's AI budget is spent.";
    case "failed": return `The ${who}'s answer could not be used (${out.errorCode}). Press Read again.`;
  }
}

// ── what a pack takes ──────────────────────────────────────────────────────────────────────────────────
/** The swipe file's evidence for a campaign's pack, newest entry first. */
export async function swipeEvidence(admin: SupabaseClient, orgId: string, now: Date): Promise<EvidenceItem[]> {
  const since = new Date(now.getTime() - SWIPE_EVIDENCE_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin.from("ads_swipe_entries").select(COLUMNS).eq("org_id", orgId).eq("state", "read").is("archived_at", null)
    .gte("read_at", since).order("read_at", { ascending: false }).limit(SWIPE_LIST_LIMIT);
  if (error) throw new Error(`ads_swipe_entries: ${error.message}`);
  return z.array(rowSchema).parse(data ?? []).flatMap((r) => {
    const reading = readingOf(r);
    if (!reading) return [];
    if (r.kind === "page" && Array.isArray(reading) && r.url) return pageEvidence({ id: r.id, kind: "page", url: r.url, note: r.note, reading });
    if (r.kind === "picture" && !Array.isArray(reading)) return [pictureEvidence({ id: r.id, kind: "picture", url: null, note: r.note, reading })];
    return [];
  });
}
