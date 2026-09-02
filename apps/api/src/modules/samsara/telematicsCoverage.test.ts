import { describe, it, expect } from "vitest";
import { readTelematicsCoverage } from "./telematicsCoverage.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

const ORG = "org-1";
const row = (fueled_at: string, state: "reconciled" | "no_data" | "pending") => ({
  fueled_at,
  samsara_recon_at: state === "pending" ? null : "2026-09-02T01:15:00Z",
  samsara_recon_status: state === "reconciled" ? "success" : state === "no_data" ? "no_data" : null,
});

describe("readTelematicsCoverage — the figure the 90-day window was hiding", () => {
  it("reports the three states separately, over the whole history", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_transactions: {
          data: [
            row("2026-08-05T12:00:00Z", "reconciled"),
            row("2026-01-05T12:00:00Z", "no_data"),
            row("2026-03-05T12:00:00Z", "pending"),
          ],
        },
      },
    });
    const r = await readTelematicsCoverage(rec.client, ORG);
    expect(r).toMatchObject({ fills: 3, reconciled: 1, noData: 1, pending: 1, truncated: false });
    expect(r.byMonth.map((m) => m.month)).toEqual(["2026-08", "2026-03", "2026-01"]);
  });

  // The whole reason this route exists. Given a window it would report the healthy recent slice, which
  // is the answer that let 76.8% of history sit uncollected for months without anything looking wrong.
  it("takes no window — nothing in the query bounds `fueled_at`", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: { data: [] } } });
    await readTelematicsCoverage(rec.client, ORG);
    const q = rec.queries.find((x) => x.table === "fuel_transactions")!;
    const ops = q.ops.map((o) => o.method);
    expect(ops).not.toContain("gte");
    expect(ops).not.toContain("lte");
    expect(ops).not.toContain("lt");
    expect(ops).not.toContain("gt");
  });

  it("excludes fills with no truck — an unmapped fill is a roster problem, not a collection one", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: { data: [] } } });
    await readTelematicsCoverage(rec.client, ORG);
    const q = rec.queries.find((x) => x.table === "fuel_transactions")!;
    expect(q.ops.some((o) => o.method === "not" && o.args[0] === "vehicle_id")).toBe(true);
  });

  it("pages until a short batch, and says so when it stopped early instead", async () => {
    // Two full pages then a short one. `pages` drains per READ, which is how the fake models paging.
    const full = Array.from({ length: 1000 }, () => row("2026-08-05T12:00:00Z", "reconciled"));
    const rec = createSupabaseRecorder({
      tables: { fuel_transactions: { pages: [full, full, [row("2026-08-06T12:00:00Z", "pending")]] } },
    });
    const r = await readTelematicsCoverage(rec.client, ORG);
    expect(r.fills).toBe(2001);
    expect(r.truncated).toBe(false);
    expect(rec.queries.filter((q) => q.table === "fuel_transactions")).toHaveLength(3);
  });

  it("is org-scoped — the service role bypasses RLS, so the filter is this function's own job", async () => {
    const rec = createSupabaseRecorder({
      tables: { fuel_transactions: { data: [row("2026-08-05T12:00:00Z", "reconciled")] } },
    });
    await readTelematicsCoverage(rec.client, ORG);
    expectOrgScoped(rec, ORG);
  });

  it("surfaces a read failure rather than reporting 0% coverage", async () => {
    const rec = createSupabaseRecorder({
      tables: { fuel_transactions: { data: null, error: { message: "connection reset" } } },
    });
    // A swallowed error here would render as "0% corroborated" — an alarming number with no cause,
    // which is the same class of lie as the windowed 95%.
    await expect(readTelematicsCoverage(rec.client, ORG)).rejects.toThrow("connection reset");
  });
});
