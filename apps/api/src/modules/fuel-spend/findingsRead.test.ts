import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFindings, visibleSections } from "./findingsRead.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * One inbox over two case tables (C7b), and the assertions are mostly about the seam.
 *
 * The queue merges two tables that disagree about how to name a truck, what a date means, and what
 * closing is. Every one of those is a place a row can be silently dropped or silently included, and a
 * queue that is missing rows without saying so is worse than one that refuses to load.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";

const ANOMALIES = [
  { id: "a-1", status: "open", disposition: null, message: "Billed into a full tank", fueled_at: "2026-09-03T10:00:00Z", created_at: "2026-09-03T11:00:00Z", assigned_to: null, vehicle_id: V1 },
];
const EXCEPTIONS = [
  { id: "e-1", kind: "off_network_premium", status: "open", occurred_on: "2026-09-04", amount: "120.50", credited_amount: null, unit_number: "701", assigned_to: null, first_seen_at: "2026-09-04T00:00:00Z" },
];

const seed = (o: { anomalies?: unknown[]; exceptions?: unknown[]; vehicles?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      anomalies: o.anomalies ?? ANOMALIES,
      fuel_exceptions: o.exceptions ?? EXCEPTIONS,
      vehicles: o.vehicles ?? [{ id: V1, unit_number: "701" }],
    },
  });

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("which sections a caller sees findings in", () => {
  // Q-FUI1's ruling made concrete. Derived from the matrix — there is no list of roles anywhere.
  it("gives the bookkeeper fuel only, and the safety roles both", () => {
    // `accountant` is the money role and DELIBERATELY only the money role (D-SEP7) — `safety: none`,
    // so a theft case never reaches the person reading the ledger.
    expect(visibleSections("accountant")).toEqual(["fuel"]);
    expect(visibleSections("dispatcher")).toEqual(["fuel"]);
    expect(visibleSections("safety_manager")).toEqual(["fuel", "safety"]);
    expect(visibleSections("admin")).toEqual(["fuel", "safety"]);
    // ⚠ The auditor sees both, and that is the matrix speaking rather than an oversight: `auditor`
    // holds `safety: "view"` because a DOT audit is precisely the reader who asks for the §391.23
    // investigation file. Derived, so it moves if that ruling ever does.
    expect(visibleSections("auditor")).toEqual(["fuel", "safety"]);
  });

  it("gives a driver nothing", () => {
    expect(visibleSections("driver")).toEqual([]);
  });
});

describe("the merged queue", () => {
  it("returns both sources, newest first, and is org-scoped", async () => {
    const rec = seed();
    const page = await readFindings(rec.client, ORG, "admin");
    expect(page.rows.map((r) => r.id)).toEqual(["e-1", "a-1"]);
    expect(page.total).toBe(2);
    expect(page.truncated).toBe(false);
    expectOrgScoped(rec, ORG);
  });

  // The gate is per KIND, so the accountant's inbox simply has no theft cases in it — not a 403, and
  // not a redacted row. The anomaly table must not even be read.
  it("never reads the anomaly table for a caller without safety", async () => {
    const rec = seed();
    const page = await readFindings(rec.client, ORG, "accountant");
    expect(page.rows.map((r) => r.source)).toEqual(["exception"]);
    expect(rec.forTable("anomalies")).toHaveLength(0);
  });

  it("returns an empty page rather than an error for a caller who may see neither", async () => {
    const rec = seed();
    const page = await readFindings(rec.client, ORG, "driver");
    expect(page).toEqual({ rows: [], total: 0, truncated: false });
    expect(rec.forTable("anomalies")).toHaveLength(0);
    expect(rec.forTable("fuel_exceptions")).toHaveLength(0);
  });

  // C7a maps back as well as forth precisely so this translation is not restated here.
  it("asks each source only for the statuses the requested queue state covers", async () => {
    const rec = seed();
    await readFindings(rec.client, ORG, "admin", { states: ["closed"] });
    const anomalyStatuses = rec.forTable("anomalies")[0]!.filters().find((f) => f.col === "status")?.val;
    const exceptionStatuses = rec.forTable("fuel_exceptions")[0]!.filters().find((f) => f.col === "status")?.val;
    expect([...(anomalyStatuses as string[])].sort()).toEqual(["dismissed", "resolved", "superseded"]);
    expect([...(exceptionStatuses as string[])].sort()).toEqual(["credited", "dismissed", "resolved_by_reingest"]);
  });
});

describe("the truck filter, which the two tables spell differently", () => {
  // ⚠ `anomalies` has no `unit_number` — it has `vehicle_id`, while the ledger stores the unit
  // string. A filter applied to one and not the other is the defect P3 closed for the ledger: the
  // page writes it, the URL keeps it, and half the data ignores it.
  it("filters BOTH sources from one roster read", async () => {
    const rec = seed();
    await readFindings(rec.client, ORG, "admin", { vehicleIds: [V1] });
    const anomalyFilter = rec.forTable("anomalies")[0]!.filters().find((f) => f.col === "vehicle_id");
    const ledgerFilter = rec.forTable("fuel_exceptions")[0]!.filters().find((f) => f.col === "unit_number");
    expect(anomalyFilter?.val).toEqual([V1]);
    expect(ledgerFilter?.val).toEqual(["701"]);
    // One read, not one per source.
    expect(rec.forTable("vehicles")).toHaveLength(1);
  });

  // A hand-edited id naming another org's truck resolves to nothing, and nothing must mean NOTHING —
  // an unfiltered query here would show the whole queue to somebody who asked for one vehicle.
  it("returns no findings when the filter matches none of the caller's trucks", async () => {
    const rec = seed({ vehicles: [] });
    const page = await readFindings(rec.client, ORG, "admin", { vehicleIds: [V1] });
    expect(page.rows).toEqual([]);
  });
});

describe("paging a queue merged in memory", () => {
  const many = (n: number, src: "a" | "e") =>
    Array.from({ length: n }, (_, i) =>
      src === "a"
        ? { ...ANOMALIES[0]!, id: `a-${i}`, fueled_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z` }
        : { ...EXCEPTIONS[0]!, id: `e-${i}`, occurred_on: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` });

  it("slices after merging, so a page is the newest across both sources", async () => {
    const rec = seed({ anomalies: many(10, "a"), exceptions: many(10, "e") });
    const page = await readFindings(rec.client, ORG, "admin", { limit: 5 });
    expect(page.rows).toHaveLength(5);
    expect(page.total).toBe(20);
  });

  // A queue missing rows that does not say so is worse than one that refuses to load. PostgREST's
  // own 1,000-row ceiling truncates silently, which this repo has already paid for once.
  it("says so when a source hit the read cap rather than showing a short list", async () => {
    const rec = seed({ exceptions: many(500, "e") });
    const page = await readFindings(rec.client, ORG, "admin");
    expect(page.truncated).toBe(true);
  });
});
