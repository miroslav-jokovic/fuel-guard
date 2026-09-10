import type { SupabaseClient } from "@supabase/supabase-js";
import { formatTag, nextDisplayNo, type LabelFaceDto, type LabelTarget } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { issueTagCode } from "./tagIssuance.js";
import { isServiceError, type ServiceError } from "./types.js";

/**
 * Turning "label these things" into what goes on the paper (INVENTORY-PLAN.md I10).
 *
 * ── RESOLVING A RUN IS A WRITE, AND THAT IS NOT A LEAK ────────────────────────────────────────
 * Asking for a label issues a tag code to anything that has none, so both the preview and the print
 * mutate. The alternative was considered and is worse: a preview showing placeholder codes, then a
 * sheet carrying different real ones, is a screen that lies about the only thing it exists to show.
 * The write is safe to repeat — `issueTagCode` only ever fills a NULL — so preview-then-print gives
 * one code, and a print retried after a dropped connection gives that same code again. A tag issued
 * and never printed costs nothing; a label printed for a code nobody stored is the failure this
 * ordering exists to make impossible.
 *
 * ── THE READS ARE BATCHED, BECAUSE 240 TARGETS IS 240 ROUND TRIPS OTHERWISE ───────────────────
 * `MAX_LABELS_PER_RUN` is 240, so a naive loop over `getAsset` would be 240 sequential PostgREST
 * calls before a single byte is drawn. Two `.in()` reads answer the whole run. The stock read
 * over-fetches slightly — PostgREST cannot express "these exact (part, location) pairs" without an
 * `.or()` whose grammar reserves the comma and the parenthesis (`orFilterValue` exists because of
 * that) — so it asks for the cross product of the ids mentioned and the pairs are matched here. The
 * over-read is bounded by the same 240 and the alternative is a filter string built from user
 * input, which this repo has already been bitten by twice.
 *
 * ── ISSUANCE IS SEQUENTIAL AND THE READS ARE NOT ──────────────────────────────────────────────
 * Each `issueTagCode` is its own read-then-conditional-update and they are awaited one at a time.
 * That is slower than firing 240 at once and it is the right call: they contend on two unique
 * indexes, and a burst of parallel inserts against a partial unique index is exactly the shape that
 * turns a 4.5 %-by-10,000 birthday collision into a retry storm. A run of 24 — one sheet, which is
 * what anybody actually asks for — is imperceptible either way.
 */

/**
 * Only what a label needs.
 *
 * ⚠ **The `: string` annotations are load-bearing.** supabase-js parses a select passed as a string
 * LITERAL and infers the row type from it, and its inference types an embedded join as an ARRAY —
 * so `parts!inner(part_number)` arrives as `{part_number}[]` and the cast below stops compiling
 * against a shape the row does not actually have. Widening the constant turns that inference off.
 * `STOCK_COLUMNS` in `stock.ts` gets there by being written as a concatenation; this says it out
 * loud. The `as unknown as` that follows is then the house pattern (`listStock` does the same) —
 * with inference off, supabase types the rows as `GenericStringError[]` and the interfaces below
 * are the only description of the shape that exists.
 */
const STOCK_FACE_COLUMNS: string =
  "part_id, location_id, tag_code, parts!inner(part_number), stock_locations!inner(name)";
const ASSET_FACE_COLUMNS: string = "id, tag_code, display_seq, name";

interface StockFaceRow {
  part_id: string;
  location_id: string;
  tag_code: string | null;
  parts: { part_number: string } | null;
  stock_locations: { name: string } | null;
}

interface AssetFaceRow {
  id: string;
  tag_code: string | null;
  display_seq: number;
  name: string;
}

const stockKey = (partId: string, locationId: string) => `${partId}:${locationId}`;

/**
 * Resolve a run to what will be printed, in the order the caller asked for.
 *
 * Order is preserved deliberately: the caller chose it — usually by picking rows down a screen —
 * and a sheet whose labels arrive in database order is a sheet somebody has to sort by hand while
 * peeling. A target that resolves to nothing is dropped rather than failing the run, because the
 * common cause is a row deleted between the picking and the printing and the honest answer is the
 * other 23 labels; the caller is told how many were dropped.
 */
export async function resolveLabelFaces(
  admin: SupabaseClient,
  orgId: string,
  targets: LabelTarget[],
): Promise<{ faces: LabelFaceDto[]; dropped: number } | ServiceError> {
  const partIds = [...new Set(targets.filter((t) => t.kind === "stock").map((t) => t.partId))];
  const locationIds = [...new Set(targets.filter((t) => t.kind === "stock").map((t) => t.locationId))];
  const assetIds = [...new Set(targets.filter((t) => t.kind === "asset").map((t) => t.assetId))];

  const stock = new Map<string, StockFaceRow>();
  if (partIds.length > 0) {
    const { data, error } = await admin
      .from("part_stock")
      .select(STOCK_FACE_COLUMNS)
      .eq("org_id", orgId)
      .in("part_id", partIds)
      .in("location_id", locationIds);
    if (error) return traced("resolveLabelFaces", "db_error", "Could not load the shelves to label", error);
    for (const r of (data ?? []) as unknown as StockFaceRow[]) stock.set(stockKey(r.part_id, r.location_id), r);
  }

  const assets = new Map<string, AssetFaceRow>();
  if (assetIds.length > 0) {
    const { data, error } = await admin
      .from("inventory_assets")
      .select(ASSET_FACE_COLUMNS)
      .eq("org_id", orgId)
      .in("id", assetIds);
    if (error) return traced("resolveLabelFaces", "db_error", "Could not load the assets to label", error);
    for (const r of (data ?? []) as unknown as AssetFaceRow[]) assets.set(r.id, r);
  }

  const faces: LabelFaceDto[] = [];
  let dropped = 0;

  for (const target of targets) {
    if (target.kind === "stock") {
      const row = stock.get(stockKey(target.partId, target.locationId));
      if (!row) {
        dropped += 1;
        continue;
      }
      const code =
        row.tag_code ??
        (await issueTagCode(admin, orgId, {
          table: "part_stock",
          match: { part_id: target.partId, location_id: target.locationId },
        }));
      if (isServiceError(code)) return code;
      faces.push({
        target,
        payload: formatTag("BIN", code),
        // A bin has one identifier and this is it — there is no `display_no` for a shelf. When the
        // laminate fogs these six characters are the only way back to the row (research §4.7).
        code,
        // Longest-lived fact first: a part number outlives the bay it currently sits in.
        lines: [row.parts?.part_number ?? "", row.stock_locations?.name ?? ""].filter(Boolean),
      });
      continue;
    }

    const row = assets.get(target.assetId);
    if (!row) {
      dropped += 1;
      continue;
    }
    const code =
      row.tag_code ??
      (await issueTagCode(admin, orgId, { table: "inventory_assets", match: { id: target.assetId } }));
    if (isServiceError(code)) return code;
    faces.push({
      target,
      payload: formatTag("AST", code),
      // D-INV18: an asset has two identifiers, and the SEQUENTIAL one is what gets printed and said
      // out loud. The opaque code is in the symbol; nobody reads it aloud over a radio.
      code: nextDisplayNo(row.display_seq),
      lines: [row.name].filter(Boolean),
    });
  }

  return { faces, dropped };
}
