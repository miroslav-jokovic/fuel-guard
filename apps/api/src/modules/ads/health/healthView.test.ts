import { describe, expect, it } from "vitest";
import { ADS_JOB_KINDS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { adsHealthView } from "./healthView.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-18T15:00:00Z");

describe("adsHealthView", () => {
  it("reads this org's connections, last lead webhook, a week of ads jobs and the month's generations", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        ads_platform_connections: [{ id: "c1", provider: "meta", is_sandbox: false, status: "connected", last_test_at: null, last_error: null, last_test: null }],
        jobs: (q: RecordedQuery) => (q.ops.some((o) => o.method === "maybeSingle")
          ? [{ created_at: "2026-11-18T14:00:00Z" }]
          : [{ id: "j1", kind: "ads_insights", status: "failed", error: "insights:x", created_at: "2026-11-18T10:00:00Z", finished_at: "2026-11-18T10:01:00Z" }]),
        ad_generations: [{ id: "g1", agent: "strategist", status: "succeeded", error_code: null, cost_units: 900, cost_unit: "tokens" }],
        ads_settings_versions: [],
      },
    });
    const view = await adsHealthView(rec.client, ORG, NOW);
    expect(view.connections.map((c) => [c.id, c.token.tone])).toEqual([["c1", "unknown"]]);
    expect(view.lead_webhook).toEqual({ last_at: "2026-11-18T14:00:00Z" });
    expect(view.jobs.find((j) => j.kind === "ads_insights")).toMatchObject({ failed: 1, tone: "bad" });
    expect(view.agents.find((a) => a.agent === "strategist")).toMatchObject({ calls: 1, cost_units: 900 });
    const jobsRead = rec.forTable("jobs").find((q) => !q.ops.some((o) => o.method === "maybeSingle"))!;
    expect(jobsRead.ops).toEqual(expect.arrayContaining([{ method: "in", args: ["kind", [...ADS_JOB_KINDS]] }, { method: "gte", args: ["created_at", "2026-11-11T15:00:00.000Z"] }]));
    expect(rec.forTable("ad_generations")[0]!.ops).toEqual(expect.arrayContaining([{ method: "gte", args: ["started_at", expect.any(String)] }, { method: "lt", args: ["started_at", expect.any(String)] }]));
    expectOrgScoped(rec, ORG);
  });

  it("reads a fold past PostgREST's 1,000 rows page by page", async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${String(from + i).padStart(5, "0")}`, agent: "copywriter", status: "succeeded", error_code: null, cost_units: 1, cost_unit: "tokens" }));
    const rec = createSupabaseRecorder({ tables: { ads_platform_connections: [], jobs: [], ads_settings_versions: [], ad_generations: { pages: [page(0, 1000), page(1000, 3)] } } });
    const view = await adsHealthView(rec.client, ORG, NOW);
    expect(view.agents.find((a) => a.agent === "copywriter")!.calls).toBe(1003);
    expect(rec.forTable("ad_generations")[1]!.ops).toContainEqual({ method: "gt", args: ["id", "g00999"] });
  });
});
