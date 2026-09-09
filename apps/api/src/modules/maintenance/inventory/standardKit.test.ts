import { describe, expect, it, beforeEach, vi } from "vitest";
import { STANDARD_KIT_LINES, STANDARD_KIT_TYPES } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * Adopting the standard kit (A4, answered by the owner 2026-09-09).
 *
 * ── WHY THIS IS WORTH ITS OWN FILE ────────────────────────────────────────────────────────────
 * It is the one call in the module that writes twenty-eight rows, and the two ways it can be wrong
 * are both silent. **It must be idempotent about TYPES** — a shop that already has a "Load bar"
 * keeps the one it has, rather than gaining a second that splits every kit rule down the middle;
 * `idx_asset_types_name` is on `lower(name)` and the match here has to be the same rule.
 * **And every type it creates must default to ZERO** — there is no unit kind on `asset_types`, so a
 * non-zero default applies to tractors and trailers alike, and a truck would start expecting four
 * ratchet straps.
 */

const ORG = "org-1";
let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { adoptStandardKit } = await import("./assetTypes.js");

const typeRow = (name: string, id = `t-${name}`) => ({
  id,
  name,
  category: null,
  serialized: false,
  default_kit_quantity: 0,
});

const expectationRow = {
  id: "k-1",
  asset_type_id: "t-x",
  unit_kind: "tractor",
  vehicle_id: null,
  trailer_id: null,
  quantity: 1,
  asset_types: { name: "x" },
};

/** Reads answer with `existing`; every write echoes a row back so the service can carry on. */
const recorder = (existing: Array<ReturnType<typeof typeRow>>) =>
  createSupabaseRecorder({
    tables: {
      asset_types: (q) => (q.write ? [typeRow("written", `t-${Math.random()}`)] : existing),
      // The lookup finds nothing, so `setKitExpectation` takes its INSERT branch every time.
      kit_expectations: (q) => (q.write ? [expectationRow] : []),
    },
  });

beforeEach(() => {
  rec = recorder([]);
});

describe("a shop starting from nothing", () => {
  it("creates every kind of thing the catalogue names, and every kit rule", async () => {
    const result = await adoptStandardKit(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.typesCreated).toBe(STANDARD_KIT_TYPES.length);
    expect(result.rulesSet).toBe(STANDARD_KIT_LINES.length);
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
  });

  /**
   * ⚠ Zero, and not the kit line's quantity. There is no unit kind on `asset_types`, so a non-zero
   * default here would apply to every kind of unit at once — `resolveExpected`'s weakest layer —
   * and a tractor would start expecting the trailer's four ratchet straps.
   */
  it("gives every created type a default of zero, because a type has no unit kind", async () => {
    await adoptStandardKit(rec.client, ORG);
    const written = rec.writtenRows("asset_types");
    expect(written).toHaveLength(STANDARD_KIT_TYPES.length);
    expect(written.every((r) => r.default_kit_quantity === 0)).toBe(true);
  });

  it("carries `serialized` from the catalogue, because IV020 reads it", async () => {
    await adoptStandardKit(rec.client, ORG);
    const written = rec.writtenRows("asset_types");
    const byName = new Map(written.map((r) => [String(r.name), r.serialized]));
    // A tablet is serialized — which tablet matters. Straps are not: four straps are four straps.
    expect(byName.get("Tablet")).toBe(true);
    expect(byName.get("Ratchet strap")).toBe(false);
  });
});

describe("a shop that already has some of them", () => {
  it("keeps the type it already had and does not make a second", async () => {
    rec = recorder([typeRow("Load bar", "existing-load-bar")]);
    const result = await adoptStandardKit(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.typesCreated).toBe(STANDARD_KIT_TYPES.length - 1);
    expect(rec.writtenRows("asset_types").map((r) => r.name)).not.toContain("Load bar");
  });

  /**
   * `idx_asset_types_name` is on `lower(name)`, so "load bar" and "Load bar" are one type as far as
   * the database is concerned — and a match here that was case-sensitive would try to create the
   * second and take a 23505 the shop cannot act on.
   */
  it("matches the name case-insensitively, which is the index's own rule", async () => {
    rec = recorder([typeRow("load bar", "existing-lower")]);
    const result = await adoptStandardKit(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.typesCreated).toBe(STANDARD_KIT_TYPES.length - 1);
  });

  it("still writes the kit rule for a type it did not create", async () => {
    rec = recorder([typeRow("Load bar", "existing-load-bar")]);
    const result = await adoptStandardKit(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    // The rules are the point; a shop with the type but no rule is the case this repairs.
    expect(result.rulesSet).toBe(STANDARD_KIT_LINES.length);
  });
});

describe("what the catalogue itself must say", () => {
  /**
   * `trailer` and `reefer_trailer` are two kinds and a fleet rule matches its kind EXACTLY — in
   * `resolveExpected` and again in `move_asset`'s SQL. So a reefer does not inherit the dry van's
   * rules, and a catalogue listing only the reefer's three extras would ship a reefer whose kit was
   * three items long.
   */
  it("gives the reefer the dry van's securement as well as its own three", () => {
    const dryVan = STANDARD_KIT_LINES.filter((l) => l.unitKind === "trailer").map((l) => l.typeName);
    const reefer = STANDARD_KIT_LINES.filter((l) => l.unitKind === "reefer_trailer").map((l) => l.typeName);
    for (const name of dryVan) expect(reefer).toContain(name);
    expect(reefer).toContain("Reefer download cable");
    expect(dryVan).not.toContain("Reefer download cable");
  });

  it("names a type for every line it asks for", () => {
    const names = new Set(STANDARD_KIT_TYPES.map((t) => t.name));
    for (const line of STANDARD_KIT_LINES) expect(names).toContain(line.typeName);
  });

  it("puts §393.95's five on the tractor", () => {
    const tractor = STANDARD_KIT_LINES.filter((l) => l.unitKind === "tractor");
    const byName = new Map(tractor.map((l) => [l.typeName, l.quantity]));
    expect(byName.get("Fire extinguisher")).toBe(1);
    // Three bidirectional triangles is the regulation's own number, not a preference.
    expect(byName.get("Warning triangles")).toBe(3);
    expect(byName.get("Spare fuse kit")).toBe(1);
  });
});
