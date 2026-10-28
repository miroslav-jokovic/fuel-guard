import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetpalPart } from "@silvicom/shared";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The catalogue sweep (F12): what is a part and what is a quote line, how the position moves, and
 * that a refused write stops the sweep where it stood rather than skipping past it.
 */
const sync = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));
vi.mock("../../maintenance/index.js", () => ({
  syncFleetpalPart: async (_a: unknown, _o: string, c: unknown) => {
    sync.calls.push(c);
    return sync.fail ? { error: "Could not create the part from FleetPal", code: "db_error" } : { outcome: "created", partId: "p" };
  },
}));
const { ingestParts, toCandidate } = await import("./parts.js");

const part = (over: Partial<FleetpalPart> = {}): FleetpalPart => ({
  url: "https://openapi.fleetpal.io/v1/parts/x/",
  id: "fp-1",
  number: "LF9009",
  description: "Oil filter",
  type: "INTERNAL",
  universal_product_code: "",
  component: "mLhsfwe5",
  manufacturer: null,
  manufacturer_part_number: "",
  unit_of_measure: "ea",
  position_applicable: false,
  serialized_part: false,
  created: "2026-10-01T00:00:00Z",
  updated: "2026-10-01T00:00:00Z",
  ...over,
});
let rec: SupabaseRecorder;
let state: { watermark: string | null } | null;
const ctx = (rows: FleetpalPart[]) => ({
  admin: rec.client,
  orgId: "org-1",
  client: { walk: vi.fn(async () => rows) } as never,
});

beforeEach(() => {
  sync.calls.length = 0;
  sync.fail = false;
  state = null;
  rec = createSupabaseRecorder({
    tables: {
      fleetpal_sync_state: () => (state ? [{ resource: "parts", watermark: state.watermark, window_end: null, rows_seen: 0, last_error: null, last_synced_at: null }] : []),
    },
    rpc: {},
  });
});

describe("toCandidate", () => {
  it("skips a vendor quote line with no number, and never invents one", () => {
    expect(toCandidate(part({ number: null, type: "VENDOR_HIDDEN" }))).toBeNull();
    expect(toCandidate(part({ number: "   " }))).toBeNull();
  });

  it("maps the unit, keeps FleetPal's word, cuts a long description to the column and fills a blank one with the number", () => {
    const long = "x".repeat(322);
    expect(toCandidate(part({ unit_of_measure: "disp", description: long }))).toMatchObject({
      fleetpalId: "fp-1",
      partNumber: "LF9009",
      unitOfMeasure: "unmapped",
      fleetpalUnit: "disp",
      description: "x".repeat(240),
      upc: null,
    });
    expect(toCandidate(part({ description: "  ", unit_of_measure: null }))).toMatchObject({ description: "LF9009", unitOfMeasure: "each", fleetpalUnit: null });
    expect(toCandidate(part({ universal_product_code: "012345678905" }))).toMatchObject({ upc: "012345678905" });
  });
});

describe("ingestParts", () => {
  it("writes every numbered part oldest first and moves the position to the last timestamp fully handled", async () => {
    const rows = [
      part({ id: "b", number: "B-2", updated: "2026-10-02T00:00:00Z" }),
      part({ id: "a", number: "A-1", updated: "2026-10-01T00:00:00Z" }),
      part({ id: "q", number: null, updated: "2026-10-03T00:00:00Z" }),
    ];
    const r = await ingestParts(ctx(rows));
    expect(r).toEqual({ resource: "parts", fetched: 3, staged: 2, advancedTo: "2026-10-03T00:00:00Z", error: null });
    expect((sync.calls as { partNumber: string }[]).map((c) => c.partNumber)).toEqual(["A-1", "B-2"]);
    expect(rec.writtenRows("fleetpal_sync_state").map((r) => r.watermark)).toContain("2026-10-03T00:00:00Z");
  });

  it("asks FleetPal only for what changed since the position, exclusive", async () => {
    state = { watermark: "2026-10-01T00:00:00Z" };
    const c = ctx([]);
    await ingestParts(c);
    expect((c.client as { walk: ReturnType<typeof vi.fn> }).walk).toHaveBeenCalledWith("/v1/parts/", expect.anything(), { updated_after: "2026-10-01T00:00:00Z" }, 20_000);
  });

  it("stops at a refused write, records the failure, and leaves the position where it stood", async () => {
    sync.fail = true;
    const r = await ingestParts(ctx([part()]));
    expect(r.error).toBe("Could not create the part from FleetPal");
    expect(r.staged).toBe(0);
    expect(r.advancedTo).toBeNull();
  });
});
