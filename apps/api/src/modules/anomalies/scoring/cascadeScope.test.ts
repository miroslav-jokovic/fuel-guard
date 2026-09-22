import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * Q6 fix (a), first half — the post-import cascade starts at a floor, not at the vehicle's first fill.
 * cascadeScope.ts carries the argument: an imported fill moves an earlier fill only through the
 * two-sided cumulative window and business-time drift, so the floor is `earliest − W − 2·drift`,
 * and the learned-gate drift that remains below it was accepted by Q6e (c).
 */
const mocks = vi.hoisted(() => ({ scoreTransaction: vi.fn() }));
vi.mock("./scoreTransaction.js", () => ({
  scoreTransaction: mocks.scoreTransaction,
  learnVehicleValues: vi.fn(),
}));
vi.mock("./cardMultiReconcile.js", () => ({ reconcileCardMultiForOrg: vi.fn(async () => undefined) }));

const { cascadeFloorIso, importVehicleEarliest, CASCADE_TIME_DRIFT_HOURS } = await import("./cascadeScope.js");
const { scoreImportWithCascade, scoreVehicle } = await import("./backfill.js");

const ORG = "org-1";
const IMPORT = "imp-1";
const H = 3_600_000;

const val = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const gteFueledAt = (q: RecordedQuery) =>
  q.ops.find((o) => o.method === "gte" && o.args[0] === "fueled_at")?.args[1];

beforeEach(() => mocks.scoreTransaction.mockReset());

describe("cascadeFloorIso", () => {
  it("floors at the earliest imported fill minus the window and twice the drift margin", () => {
    const floor = cascadeFloorIso("2026-09-20T12:00:00.000Z", 48);
    expect(Date.parse("2026-09-20T12:00:00.000Z") - Date.parse(floor)).toBe((48 + 2 * CASCADE_TIME_DRIFT_HOURS) * H);
  });

  it("keeps the drift margin above the 18.0 h maximum measured on 2026-09-22", () => {
    expect(CASCADE_TIME_DRIFT_HOURS).toBeGreaterThan(18);
  });
});

describe("importVehicleEarliest", () => {
  it("takes the earliest fill per vehicle across pages, org-scoped", async () => {
    // A full first page forces a second read; the earlier v1 fill and all of v2 sit on page 2 —
    // exactly what the unpaged read this replaced would have dropped at PostgREST's 1,000-row cap.
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `a${String(i).padStart(4, "0")}`,
      vehicle_id: "v1",
      fueled_at: "2026-09-10T00:00:00.000Z",
    }));
    const page2 = [
      { id: "b1", vehicle_id: "v1", fueled_at: "2026-09-01T00:00:00.000Z" },
      { id: "b2", vehicle_id: "v2", fueled_at: "2026-08-15T00:00:00.000Z" },
    ];
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: { pages: [page1, page2] } } });

    const got = await importVehicleEarliest(rec.client, ORG, IMPORT);

    expect(Object.fromEntries(got)).toEqual({ v1: "2026-09-01T00:00:00.000Z", v2: "2026-08-15T00:00:00.000Z" });
    expect(rec.forTable("fuel_transactions")).toHaveLength(2);
    for (const q of rec.forTable("fuel_transactions")) expect(val(q, "import_id")).toBe(IMPORT);
    expectOrgScoped(rec, ORG);
  });

  it("fails loudly on a read error rather than cascading nothing", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: { data: [], error: { message: "boom" } } } });
    await expect(importVehicleEarliest(rec.client, ORG, IMPORT)).rejects.toThrow(/boom/);
  });
});

describe("scoreImportWithCascade", () => {
  it("starts each vehicle's cascade at its own floor, using the org's window", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        anomaly_thresholds: [{ cumulative_window_hours: 24 }],
        fuel_transactions: (q) => {
          if (val(q, "import_id") === IMPORT) {
            const withVehicle = q.ops.some((o) => o.method === "not");
            return withVehicle
              ? [
                  { id: "n1", vehicle_id: "v1", fueled_at: "2026-09-20T00:00:00.000Z" },
                  { id: "n2", vehicle_id: "v2", fueled_at: "2026-09-18T00:00:00.000Z" },
                ]
              : [{ id: "n1" }, { id: "n2" }];
          }
          return [{ id: `h-${String(val(q, "vehicle_id"))}` }];
        },
      },
    });

    await scoreImportWithCascade(rec.client, testEnv(), ORG, IMPORT);

    const walks = rec.forTable("fuel_transactions").filter((q) => val(q, "vehicle_id") !== undefined);
    const floors = Object.fromEntries(walks.map((q) => [val(q, "vehicle_id"), gteFueledAt(q)]));
    expect(floors).toEqual({
      v1: cascadeFloorIso("2026-09-20T00:00:00.000Z", 24),
      v2: cascadeFloorIso("2026-09-18T00:00:00.000Z", 24),
    });
    // The cascade half reuses stored Samsara values; the floor never leaks into scoreTransaction.
    const cascadeCalls = mocks.scoreTransaction.mock.calls.filter((c) => String(c[3]).startsWith("h-"));
    expect(cascadeCalls.map((c) => c[4])).toEqual([{ skipRecon: true }, { skipRecon: true }]);
    expectOrgScoped(rec, ORG);
  });
});

describe("scoreVehicle", () => {
  it("walks the whole history when no floor is given", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [{ id: "t1" }] } });
    await scoreVehicle(rec.client, testEnv(), ORG, "v1", { skipRecon: true });
    expect(gteFueledAt(rec.forTable("fuel_transactions")[0]!)).toBeUndefined();
  });
});
