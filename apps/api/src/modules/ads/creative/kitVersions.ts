import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  STARTER_PRESETS, adBrandKitSchema, adPresetRecipeSchema, conceptPair, kitAssets,
  type AdBrandKitSave, type AdBrandKitView, type AdPresetSave, type AdPresetView, type AdVersionView,
} from "@silvicom/shared";
import type { Actor } from "../settings/settingsVersions.js";
import { mismatchedAssets } from "./brandAssets.js";

/**
 * The brand kits and concept presets, versioned (0537 §2; D-AD10, D-AD11; workflow C1). The ONLY reader
 * and writer of `ad_brand_kits(_versions)` and `ad_concept_presets(_versions)`.
 *
 * A save is a new version row and nothing else: 0537's triggers refuse an UPDATE or DELETE of a version,
 * so a creative that names version 3 can always be explained by version 3. The newest version is in force.
 * The same rules as Settings › Ads control (`settingsVersions.ts`), for the same reasons:
 *   · two saves at once both read n and write n + 1; `unique (…, version)` refuses the second (23505),
 *     returned as `"conflict"`, never retried — a retry would apply a change on top of one its author
 *     never saw;
 *   · a stored body that no longer parses THROWS instead of being skipped — the save validated it, so an
 *     unreadable row is a bug or a hand edit, and hiding it would make a kit silently vanish.
 *
 * A first save makes the parent and then version 1. If version 1 is refused the parent is removed again
 * (no version references it, so 0537's `on delete restrict` allows it) — a kit with no version would be
 * a row that says nothing.
 */

export type SaveOutcome =
  | { kind: "saved"; id: string; parent_id: string; version: number }
  | { kind: "conflict" }
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "assets_mismatch"; sha256: string[] }
  /** Q-AD77: another live preset holds this hook × scene pair. `key` is that preset's. */
  | { kind: "concept_taken"; key: string };

/**
 * What differs between the two families. Every `.from("…")` below is a literal on its own chain — the
 * table gates (`check-table-access`, `check-table-writers`) read the call site, so a table name passed
 * in as a value would hide these four tables, and their writers, from both.
 */
interface Family<T> { label: string; fk: string; body: string; schema: z.ZodType<T> }
const KITS: Family<z.infer<typeof adBrandKitSchema>> = { label: "ad_brand_kit_versions", fk: "kit_id", body: "kit", schema: adBrandKitSchema };
const PRESETS: Family<z.infer<typeof adPresetRecipeSchema>> = { label: "ad_concept_preset_versions", fk: "preset_id", body: "recipe", schema: adPresetRecipeSchema };

type Row = Record<string, unknown>;
type Query = ReturnType<SupabaseClient["from"]>;
type Inserted = PromiseLike<{ data: unknown; error: unknown }>;
const isDuplicate = (e: unknown) => (e as { code?: string } | null)?.code === "23505";
const message = (e: unknown) => (e as { message?: string } | null)?.message ?? "failed";

/** The newest version of each parent, parsed. `versions` is the family's version table. */
async function newestVersions<T>(versions: Query, orgId: string, f: Family<T>, ids: string[]): Promise<Map<string, AdVersionView<T> & { row: Row }>> {
  const out = new Map<string, AdVersionView<T> & { row: Row }>();
  if (ids.length === 0) return out;
  const { data, error } = await versions.select("*").eq("org_id", orgId).in(f.fk, ids).order("version", { ascending: false });
  if (error) throw new Error(`${f.label}: ${error.message}`);
  for (const row of (data ?? []) as Row[]) {
    const parent = String(row[f.fk]);
    if (out.has(parent)) continue;
    const parsed = f.schema.safeParse(row[f.body]);
    if (!parsed.success) throw new Error(`${f.label} ${String(row.id)}: stored body does not parse (${parsed.error.issues[0]?.message ?? "invalid"})`);
    out.set(parent, {
      id: String(row.id), parent_id: parent, version: Number(row.version), body: parsed.data,
      saved_at: String(row.created_at), saved_by_name: String(row.created_by_name), row,
    });
  }
  return out;
}

async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(`${label}: ${error.message}`);
  return (data ?? []) as Row[];
}

const strip = <T>(v: (AdVersionView<T> & { row: Row }) | undefined): AdVersionView<T> | null => {
  if (!v) return null;
  const { row: _row, ...view } = v;
  return view;
};

export async function listBrandKits(admin: SupabaseClient, orgId: string): Promise<AdBrandKitView[]> {
  const parents = await rows(admin.from("ad_brand_kits").select("*").eq("org_id", orgId).order("created_at", { ascending: true }), "ad_brand_kits");
  const current = await newestVersions(admin.from("ad_brand_kit_versions"), orgId, KITS, parents.map((p) => String(p.id)));
  return parents.map((p) => ({ id: String(p.id), name: String(p.name), archived_at: (p.archived_at as string | null) ?? null, current: strip(current.get(String(p.id))) }));
}

export async function listPresets(admin: SupabaseClient, orgId: string): Promise<AdPresetView[]> {
  const parents = await rows(admin.from("ad_concept_presets").select("*").eq("org_id", orgId).order("created_at", { ascending: true }), "ad_concept_presets");
  // No presets, no versions to read: return before a version query is even begun (an unfiltered `.from()` is
  // what the org-scope assertion would rightly flag, and every first save now lists the presets).
  if (parents.length === 0) return [];
  const current = await newestVersions(admin.from("ad_concept_preset_versions"), orgId, PRESETS, parents.map((p) => String(p.id)));
  return parents.map((p) => {
    const v = current.get(String(p.id));
    return { id: String(p.id), key: String(p.key), archived_at: (p.archived_at as string | null) ?? null, current: v ? { ...strip(v)!, enabled: v.row.enabled === true } : null };
  });
}

/** The version after the newest one stored for `parentId` (1 when there is none). */
async function nextVersion(versions: Query, orgId: string, f: Family<unknown>, parentId: string): Promise<number> {
  const { data, error } = await versions.select("version").eq("org_id", orgId).eq(f.fk, parentId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`${f.label}: ${error.message}`);
  return ((data as { version: number } | null)?.version ?? 0) + 1;
}

/** Settle a version insert; `undo` removes a parent this save made when its version 1 is refused. */
async function settle(inserted: Inserted, label: string, parentId: string, undo: (() => PromiseLike<unknown>) | null): Promise<SaveOutcome> {
  const { data, error } = await inserted;
  if (error) {
    if (undo) await undo();
    if (isDuplicate(error)) return { kind: "conflict" };
    throw new Error(`${label} insert: ${message(error)}`);
  }
  const row = data as { id: string; version: number };
  return { kind: "saved", id: row.id, parent_id: parentId, version: row.version };
}

const by = (actor: Actor) => ({ created_by: actor.id, created_by_name: actor.name });

export async function saveBrandKitVersion(admin: SupabaseClient, orgId: string, actor: Actor, save: AdBrandKitSave): Promise<SaveOutcome> {
  const kit = adBrandKitSchema.parse(save.kit);
  const bad = await mismatchedAssets(admin, orgId, kitAssets(kit));
  if (bad.length > 0) return { kind: "assets_mismatch", sha256: bad };
  let kitId = save.kit_id;
  let version = 1;
  if (kitId === null) {
    const { data, error } = await admin.from("ad_brand_kits").insert({ org_id: orgId, name: save.name! }).select("id").single();
    if (error) throw new Error(`ad_brand_kits insert: ${error.message}`);
    kitId = (data as { id: string }).id;
  } else {
    const [parent] = await rows(admin.from("ad_brand_kits").select("id, archived_at").eq("org_id", orgId).eq("id", kitId), "ad_brand_kits");
    if (!parent) return { kind: "not_found" };
    if (parent.archived_at) return { kind: "archived" };
    version = await nextVersion(admin.from("ad_brand_kit_versions"), orgId, KITS, kitId);
  }
  const made = save.kit_id === null ? kitId : null;
  return settle(
    admin.from("ad_brand_kit_versions").insert({ org_id: orgId, kit_id: kitId, version, kit, ...by(actor) }).select("id, version").single(),
    KITS.label, kitId,
    made ? () => admin.from("ad_brand_kits").delete().eq("org_id", orgId).eq("id", made) : null,
  );
}

/**
 * Q-AD77: two LIVE presets may not hold one hook × scene pair — Meta folds them into one idea (R1). Live is what
 * the draw reads (`presetDraw`): not archived and the newest version enabled. So the rule binds only a save that
 * would make this preset live; a switched-off version (every adopted starter) is never refused, and switching it
 * on later is the save that is checked. A preset stored before the families has no pair and blocks nothing.
 *
 * It reads the other presets and then writes, so two saves at the same moment can each pass; the pair sits in a
 * jsonb body that no constraint can see. That window is two admins switching two presets on in one second — the
 * cost is two similar ads until the next save, never a wrong one.
 */
async function liveHolderOf(admin: SupabaseClient, orgId: string, save: AdPresetSave): Promise<string | null> {
  const pair = save.enabled ? conceptPair(save.recipe) : null;
  if (pair === null) return null;
  const holder = (await listPresets(admin, orgId)).find((p) => p.key !== save.key && p.archived_at === null && p.current?.enabled === true && conceptPair(p.current.body) === pair);
  return holder?.key ?? null;
}

export async function savePresetVersion(admin: SupabaseClient, orgId: string, actor: Actor, save: AdPresetSave): Promise<SaveOutcome> {
  const recipe = adPresetRecipeSchema.parse(save.recipe);
  const taken = await liveHolderOf(admin, orgId, save);
  if (taken) return { kind: "concept_taken", key: taken };
  const [parent] = await rows(admin.from("ad_concept_presets").select("id, archived_at").eq("org_id", orgId).eq("key", save.key), "ad_concept_presets");
  if (parent?.archived_at) return { kind: "archived" };
  let presetId = parent ? String(parent.id) : null;
  let version = 1;
  if (presetId === null) {
    const { data, error } = await admin.from("ad_concept_presets").insert({ org_id: orgId, key: save.key }).select("id").single();
    // Two first saves of one key at once: `unique (org_id, key)` refuses the second — the same race as two version saves.
    if (error) {
      if (isDuplicate(error)) return { kind: "conflict" };
      throw new Error(`ad_concept_presets insert: ${error.message}`);
    }
    presetId = (data as { id: string }).id;
  } else {
    version = await nextVersion(admin.from("ad_concept_preset_versions"), orgId, PRESETS, presetId);
  }
  const made = parent ? null : presetId;
  return settle(
    admin.from("ad_concept_preset_versions").insert({ org_id: orgId, preset_id: presetId, version, enabled: save.enabled, recipe, ...by(actor) }).select("id, version").single(),
    PRESETS.label, presetId,
    made ? () => admin.from("ad_concept_presets").delete().eq("org_id", orgId).eq("id", made) : null,
  );
}

export interface AdoptOutcome { adopted: string[]; skipped: string[] }

/**
 * `POST /api/ads/presets/adopt` (Q-AD77): version 1 of each starter (`STARTER_PRESETS`) whose key this carrier
 * does not hold — archived keys included, since an archived P2 is the carrier's decision about P2 — switched OFF.
 * Adopting twice writes the five once: the second finds every key and skips it. Two adopts at the same moment
 * meet `unique (org_id, key)`, and the loser's `conflict` is a skip, not an error: the preset it wanted exists.
 * Each is an ordinary save (`savePresetVersion`), so a starter goes through every rule a typed preset does.
 */
export async function adoptStarterPresets(admin: SupabaseClient, orgId: string, actor: Actor): Promise<AdoptOutcome> {
  const held = new Set((await listPresets(admin, orgId)).map((p) => p.key));
  const out: AdoptOutcome = { adopted: [], skipped: [] };
  for (const starter of STARTER_PRESETS) {
    if (held.has(starter.key)) { out.skipped.push(starter.key); continue; }
    const saved = await savePresetVersion(admin, orgId, actor, starter);
    if (saved.kind === "saved") out.adopted.push(starter.key);
    else if (saved.kind === "conflict" || saved.kind === "archived") out.skipped.push(starter.key);
    else throw new Error(`starter ${starter.key}: ${saved.kind}`);
  }
  return out;
}
