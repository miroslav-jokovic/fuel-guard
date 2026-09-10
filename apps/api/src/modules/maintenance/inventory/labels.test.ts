import { describe, expect, it, beforeEach, vi } from "vitest";
import { CROCKFORD_ALPHABET, TAG_ID_LENGTH } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * Issuing tags and resolving a label run (INVENTORY-PLAN.md I10).
 *
 * ── WHAT IS ONLY TRUE HERE ────────────────────────────────────────────────────────────────────
 * `labelSheet()` and `toSvgPath()` are pinned in `@silvicom/qr` and `tagContract.ts` owns the
 * grammar. What this layer decides, and nothing else would catch:
 *
 *   · **a row that already has a tag is never re-stamped.** A tag is printed onto polyester and
 *     stuck to a tablet; re-issuing one is how two physical objects come to answer to a single code,
 *     and the second is found by a technician in a bay months later. `part_stock` has NO trigger
 *     enforcing this — only the unique index — so for a shelf the guarantee is the
 *     `.is("tag_code", null)` predicate and this assertion is the only thing watching it;
 *   · **an asset's printed code is its DISPLAY number, not its tag code** (D-INV18). Both exist,
 *     both are strings, and printing the wrong one is invisible until somebody reads a label aloud;
 *   · **a collision draws again** rather than failing the run;
 *   · **order survives**, because the caller picked it and a sheet in database order is a sheet
 *     somebody sorts by hand while peeling;
 *   · **the org filter**, because the service role bypasses RLS.
 *
 * ⚠ Fixtures are FUNCTIONS. `supabaseRecorder` records `.eq()` and does not apply it, so a flat
 * array would answer the tag-code read and the batch read with the same row regardless of what was
 * asked — and "already has a tag" would pass against a service that stamped it anyway.
 */

const ORG = "org-1";
const PART = "11111111-1111-4111-8111-111111111111";
const BAY = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";
const OTHER_ASSET = "44444444-4444-4444-8444-444444444444";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { resolveLabelFaces } = await import("./labels.js");
const { mintTagId } = await import("./tagIssuance.js");

const shelf = (tagCode: string | null) => ({
  part_id: PART,
  location_id: BAY,
  tag_code: tagCode,
  parts: { part_number: "P-100" },
  stock_locations: { name: "Bay A" },
});

const asset = (id: string, tagCode: string | null, seq: number, name = "Cab tablet") => ({
  id,
  tag_code: tagCode,
  display_seq: seq,
  name,
});

/**
 * Answers a table the way the database would: the batch read hands back the row, and the UPDATE
 * hands back what it was asked to write. `failFirstUpdate` scripts the collision.
 */
function recorder(opts: {
  shelfTag?: string | null;
  assets?: Array<ReturnType<typeof asset>>;
  failUpdates?: number;
} = {}) {
  let remainingFailures = opts.failUpdates ?? 0;
  const answer = (q: { ops: Array<{ method: string; args: unknown[] }> }, fallback: unknown[]) => {
    const update = q.ops.find((o) => o.method === "update");
    if (!update) return fallback;
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      // A duplicate, exactly as the partial unique index reports one.
      return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    return [update.args[0] as Record<string, unknown>];
  };
  return createSupabaseRecorder({
    tables: {
      part_stock: (q) => answer(q, [shelf(opts.shelfTag ?? null)]) as never,
      inventory_assets: (q) => answer(q, opts.assets ?? []) as never,
    },
  });
}

beforeEach(() => {
  rec = recorder();
});

describe("minting a tag id", () => {
  it("draws six Crockford characters and nothing else", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = mintTagId();
      expect(id).toHaveLength(TAG_ID_LENGTH);
      for (const ch of id) expect(CROCKFORD_ALPHABET).toContain(ch);
    }
  });

  /**
   * Crockford excludes I, L, O and U — the first three because a technician reading a greasy label
   * aloud confuses them with 1, 1 and 0, and the fourth so no generated id spells a word. An id
   * containing one would parse (`normalizeTagId` folds I/L/O back) but would be printed as a
   * character the alphabet says does not exist, which is the sort of thing nobody notices until a
   * label is on a truck.
   */
  it("never draws a letter the alphabet excludes", () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 500; i += 1) for (const ch of mintTagId()) drawn.add(ch);
    for (const banned of ["I", "L", "O", "U"]) expect(drawn.has(banned)).toBe(false);
  });
});

describe("resolving a label run", () => {
  it("issues a code to a shelf that has none, and encodes it as a BIN tag", async () => {
    const result = await resolveLabelFaces(rec.client, ORG, [{ kind: "stock", partId: PART, locationId: BAY }]);
    if ("error" in result) throw new Error(result.error);

    expect(result.faces).toHaveLength(1);
    const face = result.faces[0]!;
    expect(face.payload).toMatch(/^SIL1:BIN:[0-9A-Z]{6}$/);
    // A shelf has ONE identifier and this is it — the six characters are what a fogged laminate
    // leaves you with.
    expect(face.payload.endsWith(face.code)).toBe(true);
    expect(face.lines).toEqual(["P-100", "Bay A"]);
    expectOrgScoped(rec, ORG);
  });

  /**
   * ⚠ THE ASSERTION THIS FILE EXISTS FOR. Nothing in the database stops a stock line's tag being
   * overwritten — `inventory_assets` has 0333's trigger and `part_stock` has only a unique index —
   * so if the predicate ever comes off this UPDATE, two objects can end up answering to one code
   * and no other test in the repo would fail.
   */
  it("never re-stamps a shelf that already carries a tag", async () => {
    rec = recorder({ shelfTag: "X4Q2VW" });
    const result = await resolveLabelFaces(rec.client, ORG, [{ kind: "stock", partId: PART, locationId: BAY }]);
    if ("error" in result) throw new Error(result.error);

    expect(result.faces[0]!.payload).toBe("SIL1:BIN:X4Q2VW");
    expect(rec.queries.some((q) => q.write?.method === "update")).toBe(false);
  });

  /**
   * D-INV18: an asset has two identifiers and they are printed in two places. The opaque code goes
   * INSIDE the symbol; the sequential `A-0412` is printed beside it, because that is the one a
   * person says out loud over a radio. Printing the tag code as the caption would look entirely
   * plausible on screen and be useless in a yard.
   */
  it("prints an asset's display number, not the code inside its symbol", async () => {
    rec = recorder({ assets: [asset(ASSET, null, 412)] });
    const result = await resolveLabelFaces(rec.client, ORG, [{ kind: "asset", assetId: ASSET }]);
    if ("error" in result) throw new Error(result.error);

    const face = result.faces[0]!;
    expect(face.code).toBe("A-0412");
    expect(face.payload).toMatch(/^SIL1:AST:[0-9A-Z]{6}$/);
    expect(face.payload).not.toContain("A-0412");
    expect(face.lines).toEqual(["Cab tablet"]);
  });

  it("draws again when the index refuses a code, rather than failing the run", async () => {
    rec = recorder({ assets: [asset(ASSET, null, 1)], failUpdates: 2 });
    const result = await resolveLabelFaces(rec.client, ORG, [{ kind: "asset", assetId: ASSET }]);
    if ("error" in result) throw new Error(result.error);

    expect(result.faces).toHaveLength(1);
    expect(result.faces[0]!.payload).toMatch(/^SIL1:AST:[0-9A-Z]{6}$/);
    // Three attempts: two refused, one accepted.
    expect(rec.queries.filter((q) => q.write?.method === "update")).toHaveLength(3);
  });

  it("keeps the caller's order and drops a target that is not on file", async () => {
    rec = recorder({ assets: [asset(OTHER_ASSET, "AAAAAA", 2, "Second")] });
    const result = await resolveLabelFaces(rec.client, ORG, [
      { kind: "asset", assetId: ASSET },
      { kind: "asset", assetId: OTHER_ASSET },
    ]);
    if ("error" in result) throw new Error(result.error);

    // The missing one is dropped and counted; the other 23 labels on a sheet are still worth printing.
    expect(result.dropped).toBe(1);
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0]!.lines).toEqual(["Second"]);
  });
});
