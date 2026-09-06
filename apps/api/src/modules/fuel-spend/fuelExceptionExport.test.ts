import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { exportExceptions } from "./fuelExceptionExport.js";

/**
 * The ledger as a file (FUEL-P2/P3, D-FUI15).
 *
 * ── WHAT THIS REPLACED ──────────────────────────────────────────────────────────────────────────
 * An "Export CSV" button that serialised the 25 rows on the current PAGE. A controller assembling a
 * claim got page one of a filtered ledger with nothing saying so, while the four tiles above the
 * button reported the whole window's money. So the assertions below are mostly about SET: every filter
 * the screen applies reaching the query, the whole set being paged rather than the first page of it,
 * and the org filter that is this code's only tenant boundary.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "99999999-8888-4777-8666-555555555555";
const SCOPE = { title: "Fuel findings", from: "2026-08-01", to: "2026-08-31", trucks: 0, generatedAt: "2026-09-04T12:00:00.000Z" };

const finding = (over: Record<string, unknown> = {}) => ({
  id: "e1", kind: "recon_missing_on_report", occurred_on: "2026-08-26", amount: 261.55,
  amount_kind: "unbilled", unit_number: "568", site_number: "436", city: "Amarillo", state: "TX",
  brand: "PILOT", status: "dismissed", assigned_to: null, resolved_at: null, resolution_note: null,
  credited_amount: null, credited_on: null, first_seen_at: "2026-09-02T13:40:50Z",
  last_seen_at: "2026-09-02T13:40:50Z", ...over,
});

const seed = (rows: unknown[] | { pages: unknown[][]; count: number }) =>
  createSupabaseRecorder({ tables: { fuel_exceptions: rows } });

const filtersOf = (rec: ReturnType<typeof createSupabaseRecorder>) =>
  rec.forTable("fuel_exceptions")[0]!.filters().map((f) => [f.col, f.val] as const);

describe("the ledger export covers what the screen covers", () => {
  it("scopes to the caller's org, because the service role bypasses RLS", async () => {
    const rec = seed([finding()]);
    await exportExceptions(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expectOrgScoped(rec, ORG);
  });

  it("applies every filter the list applies — status, kind, trucks, owner and the window", async () => {
    const rec = seed([finding()]);
    await exportExceptions(rec.client, {
      orgId: ORG,
      filters: {
        status: ["open", "disputed"], kind: ["recon_amount"], unitNumbers: ["568"],
        assignedTo: USER, from: "2026-08-01", to: "2026-08-31",
      },
      scope: SCOPE,
    });
    expect(filtersOf(rec)).toEqual(
      expect.arrayContaining([
        ["org_id", ORG],
        ["status", ["open", "disputed"]],
        ["kind", ["recon_amount"]],
        ["unit_number", ["568"]],
        ["assigned_to", USER],
      ]),
    );
  });

  /**
   * ⚠ Two findings on one day for one amount are a tie, and a tied sort is not a total order — a page
   * boundary between them repeats one and drops the other. `id` last is what makes the paging safe.
   */
  it("orders every page by a unique key, keeping the screen's own order in front of it", async () => {
    const rec = seed([finding()]);
    await exportExceptions(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(rec.forTable("fuel_exceptions")[0]!.ops.filter((o) => o.method === "order").map((o) => o.args[0])).toEqual([
      "occurred_on",
      "amount",
      "id",
    ]);
  });

  it("reads the whole filtered set rather than one page of it", async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => finding({ id: `e${i}` }));
    const rec = seed({ pages: [page(1000), page(3)], count: 1003 });
    const out = await exportExceptions(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.rows).toBe(1003);
  });

  it("names the finding and the status in the words the page uses, never as their tokens", async () => {
    const rec = seed([finding()]);
    const out = await exportExceptions(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.csv).not.toContain("recon_missing_on_report");
    expect(out.csv).toContain("Dismissed");
    expect(out.csv).toContain("Recorded, never billed");
  });

  /**
   * The four kinds of money stay apart (D-FX5): overbilled is recoverable, unbilled may still be owed,
   * and unrecorded is unexplained. The file carries the kind beside every amount so a spreadsheet
   * cannot sum them into a figure this product refuses to print.
   */
  it("keeps the kind of money beside the amount", async () => {
    const rec = seed([finding()]);
    const out = await exportExceptions(rec.client, { orgId: ORG, filters: {}, scope: SCOPE });
    expect(out.csv).toContain("261.55,unbilled");
  });

  it("prints what the file covers on the file", async () => {
    const rec = seed([finding()]);
    const out = await exportExceptions(rec.client, {
      orgId: ORG, filters: {}, scope: { ...SCOPE, trucks: 1 },
    });
    expect(out.csv.split("\r\n")[0]).toBe(
      "# Fuel findings · 2026-08-01 → 2026-08-31 · 1 truck · 1 rows · generated 2026-09-04T12:00:00.000Z",
    );
  });
});
