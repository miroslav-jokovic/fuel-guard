import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanResult } from "@silvicom/shared";
import { chunks } from "../../../lib/paging.js";
import { TagLookupError, type TagResolverContext } from "../../../tags/registry.js";
import { traced } from "../inspections/serviceError.js";
import { mintTagId } from "./tagIssuance.js";
import type { ServiceError } from "./types.js";

/**
 * A truck's and a trailer's own QR code: issuing it, reading it back, and the label's facts
 * (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md DE4, D-DE5; the table is 0531's `unit_tags`).
 *
 * ── THE ONE FILE THAT WRITES `unit_tags` ──────────────────────────────────────────────────────
 * The table is the shop's fact about a unit, kept off `vehicles`/`trailers` because the Samsara and
 * McLeod syncs write those (0531's header). So its writer is here and only here, and
 * `lint:table-writers` pins that.
 *
 * ── ISSUED ON FIRST PRINT, THEN THE SAME CODE FOREVER ─────────────────────────────────────────
 * Like an asset's code (`tagIssuance.ts`, I10), a unit's is issued when its label is first asked for,
 * preview included, so the preview shows the code the label will carry. The difference is the shape
 * of the write: an asset's code fills a NULL column of a row that exists, a unit's is a ROW that does
 * not. So the insert is the uniqueness check twice over — `idx_unit_tags_code` (the code is taken:
 * draw again) and `idx_unit_tags_vehicle`/`_trailer` (somebody printed this unit first: read theirs).
 * Both arrive as 23505, and re-reading the unit tells them apart without parsing an index name out of
 * an error message. A faded label is reprinted with the code the row already holds; 0531 refuses any
 * change to it (IV022).
 */

export type UnitKind = "vehicle" | "trailer";

/** The column a unit's tag row names it by — the two tables, never one id space. */
const COLUMN: Record<UnitKind, "vehicle_id" | "trailer_id"> = { vehicle: "vehicle_id", trailer: "trailer_id" };

/** Six draws, `tagIssuance.ts`'s bound and its reasoning. */
const MAX_ATTEMPTS = 6;

/** The code a unit already has, null when none, undefined when the read failed. */
async function readCode(admin: SupabaseClient, orgId: string, kind: UnitKind, unitId: string): Promise<string | null | undefined> {
  const { data, error } = await admin
    .from("unit_tags")
    .select("tag_code")
    .eq("org_id", orgId)
    .eq(COLUMN[kind], unitId)
    .maybeSingle();
  if (error) return undefined;
  return (data as { tag_code: string } | null)?.tag_code ?? null;
}

/**
 * Give a truck or trailer its code, or hand back the one it has. Idempotent: a preview then a print,
 * or a print retried, gets the same code. The caller has already checked the unit is this org's (the
 * label read below); 0531's trigger checks it again (IV012), which a forged id would meet.
 */
export async function issueUnitTagCode(
  admin: SupabaseClient,
  orgId: string,
  kind: UnitKind,
  unitId: string,
  issuedBy: string | null,
): Promise<string | ServiceError> {
  const existing = await readCode(admin, orgId, kind, unitId);
  if (existing === undefined) return { code: "tag_lookup_failed", error: "Could not read that unit's label." };
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await admin
      .from("unit_tags")
      .insert({ org_id: orgId, [COLUMN[kind]]: unitId, tag_code: mintTagId(), issued_by: issuedBy })
      .select("tag_code")
      .single();
    if (!error) return (data as { tag_code: string }).tag_code;
    if (error.code !== "23505") return traced("issueUnitTagCode", "tag_issue_failed", "Could not assign a label code", error);
    // Either the code is taken (draw again) or this unit was labelled a moment ago (theirs is the answer).
    const raced = await readCode(admin, orgId, kind, unitId);
    if (raced) return raced;
  }
  return { code: "tag_issue_exhausted", error: "Could not assign a label code. Try again, and tell somebody if it happens twice." };
}

/** What a unit's label needs: the number said out loud and the code, when it has one yet. */
export interface UnitFaceFacts {
  unitNumber: string;
  tagCode: string | null;
}

/**
 * Every unit of a run in four reads, not one per label — `labels.ts`'s batching reason. Ids go in
 * chunks (`IN_LIST_CHUNK`): a run is up to 240 targets, and Node 22's fetch fails on PostgREST's echoed
 * URL near 400 ids (memory `in-list-overflows-node22-headers`). A unit not in this org is absent from
 * the map, which the caller reports as dropped.
 */
export async function readUnitFaceFacts(
  admin: SupabaseClient,
  orgId: string,
  units: Array<{ kind: UnitKind; id: string }>,
): Promise<Map<string, UnitFaceFacts> | ServiceError> {
  const facts = new Map<string, UnitFaceFacts>();
  for (const kind of ["vehicle", "trailer"] as const) {
    const ids = [...new Set(units.filter((u) => u.kind === kind).map((u) => u.id))];
    for (const part of chunks(ids)) {
      const rows =
        kind === "vehicle"
          ? await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("id", part)
          : await admin.from("trailers").select("id, unit_number").eq("org_id", orgId).in("id", part);
      if (rows.error) return traced("readUnitFaceFacts", "db_error", "Could not load the units to label", rows.error);
      for (const r of (rows.data ?? []) as Array<{ id: string; unit_number: string }>) {
        facts.set(unitKey(kind, r.id), { unitNumber: r.unit_number, tagCode: null });
      }
      const tags = await admin.from("unit_tags").select(`${COLUMN[kind]}, tag_code`).eq("org_id", orgId).in(COLUMN[kind], part);
      if (tags.error) return traced("readUnitFaceFacts", "db_error", "Could not load the units' labels", tags.error);
      for (const t of (tags.data ?? []) as unknown as Array<Record<string, string>>) {
        const f = facts.get(unitKey(kind, t[COLUMN[kind]]!));
        if (f) f.tagCode = t.tag_code!;
      }
    }
  }
  return facts;
}

export const unitKey = (kind: UnitKind, id: string) => `${kind}:${id}`;

/**
 * A scanned `VEH` or `TRL` code → the unit. A `VEH` code answers only a truck's row and a `TRL` only a
 * trailer's, so a code read under the wrong kind is "not on file" rather than the other table's unit.
 */
async function resolveUnitTag(ctx: TagResolverContext, kind: UnitKind): Promise<ScanResult | null> {
  const { data, error } = await ctx.admin
    .from("unit_tags")
    .select(COLUMN[kind])
    .eq("org_id", ctx.orgId)
    .eq("tag_code", ctx.id)
    .not(COLUMN[kind], "is", null)
    .maybeSingle();
  if (error) throw new TagLookupError("resolveUnitTag", error);
  const unitId = (data as Record<string, string> | null)?.[COLUMN[kind]];
  if (!unitId) return null;
  const unit =
    kind === "vehicle"
      ? await ctx.admin.from("vehicles").select("unit_number").eq("org_id", ctx.orgId).eq("id", unitId).maybeSingle()
      : await ctx.admin.from("trailers").select("unit_number").eq("org_id", ctx.orgId).eq("id", unitId).maybeSingle();
  if (unit.error) throw new TagLookupError("resolveUnitTag", unit.error);
  if (!unit.data) return null;
  return { kind: "unit", code: ctx.code, unit: { kind, id: unitId, unitNumber: (unit.data as { unit_number: string }).unit_number } };
}

export const resolveVehicleTag = (ctx: TagResolverContext) => resolveUnitTag(ctx, "vehicle");
export const resolveTrailerTag = (ctx: TagResolverContext) => resolveUnitTag(ctx, "trailer");
