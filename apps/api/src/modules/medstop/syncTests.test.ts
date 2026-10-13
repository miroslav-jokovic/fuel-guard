import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { MedstopClient } from "./client.js";
import { sweepMedstopTests } from "./syncTests.js";

/**
 * The MS2 half of a sweep (0464). Proved here: the window is asked for, not the history; the trail is
 * fetched only for a test that moved and stored oldest first; on the first sweep, old tests are
 * history and recent ones are not; and after it, nothing is history however old it is.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-10-13";

function medstop(routes: Record<string, unknown[]>, seen: string[]) {
  const fetchImpl = (async (url: string) => {
    const u = new URL(url);
    seen.push(`${u.pathname}${u.search}`);
    const rows = routes[u.pathname];
    if (!rows || rows.length === 0) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ data: { pagemax: 1 }, rows: [rows] }), { status: 200 });
  }) as unknown as typeof fetch;
  return new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, sleep: async () => {} });
}

const oldClosed = { id: "t-old", eeid: "e1", service: "TD", collectiondate: "2026-02-01T09:00:00", result: "POSITIVE", status: "CLOSED", dotstatus: "Y" };
const recentAtLab = { id: "t-new", eeid: "e2", service: "TD", collectiondate: "2026-10-12T13:04:34.18", result: null, status: "AT LAB", dotstatus: "Y" };
const trail = [{ status: "AT LAB", created: "2026-10-13T06:31:41" }, { status: "COMPLETED", created: "2026-10-12T13:04:34.18" }];

type Merge = { p_org: string; p_kind: string; p_rows: Record<string, unknown>[] };

describe("sweepMedstopTests", () => {
  it("first sweep: reads the window, keeps old results as history, and trails only what is still moving", async () => {
    const db = createSupabaseRecorder({ tables: { medstop_tests: [] }, rpc: () => ({ data: 1, error: null }) });
    const seen: string[] = [];
    const result = await sweepMedstopTests(db.client, medstop({
      "/Request/list": [{ id: "r1", eeid: "e2", service: "TD", observed: "N", dotstatus: "Y", requestdate: "2026-10-12T16:00:00", testid: "t-new", status: "COMPLETED" }],
      "/Test/list": [oldClosed, recentAtLab],
      "/Test/t-new/status": trail,
    }, seen), ORG, TODAY);

    expect(seen.some((s) => s.startsWith("/Request/list?requestedafter=2025-09-08"))).toBe(true);
    expect(seen.some((s) => s.startsWith("/Test/list?testafter=2025-09-08"))).toBe(true);
    expect(seen.filter((s) => s.includes("/status"))).toEqual([expect.stringMatching(/^\/Test\/t-new\/status/)]);
    expect(result).toEqual({ requests: 1, tests: 2, trails: 1, baseline: 1 });

    const [requests, tests] = db.rpcs().map((c) => c.args as Merge);
    expect(requests).toMatchObject({ p_org: ORG, p_kind: "requests" });
    expect(requests!.p_rows[0]).toMatchObject({ medstop_id: "r1", observed: false, dot_regulated: true, test_medstop_id: "t-new" });
    expect(tests).toMatchObject({ p_org: ORG, p_kind: "tests" });
    expect(tests!.p_rows.find((r) => r.medstop_id === "t-old")).toMatchObject({ baseline: true, stages: null, result: "POSITIVE" });
    expect(tests!.p_rows.find((r) => r.medstop_id === "t-new")).toMatchObject({
      baseline: false,
      collected_local: "2026-10-12T13:04:34",
      stages: [{ status: "COMPLETED", at: "2026-10-12T13:04:34" }, { status: "AT LAB", at: "2026-10-13T06:31:41" }],
    });
    expectOrgScoped(db, ORG);
  });

  it("later sweeps: a test whose status did not move costs no request, and nothing is history", async () => {
    const db = createSupabaseRecorder({
      tables: { medstop_tests: [{ org_id: ORG, medstop_id: "t-old", status: "CLOSED" }, { org_id: ORG, medstop_id: "t-new", status: "COMPLETED" }] },
      rpc: () => ({ data: 1, error: null }),
    });
    const seen: string[] = [];
    const lateFind = { ...oldClosed, id: "t-late" };
    await sweepMedstopTests(db.client, medstop({ "/Test/list": [oldClosed, recentAtLab, lateFind], "/Test/t-new/status": trail, "/Test/t-late/status": trail }, seen), ORG, TODAY);

    expect(seen.filter((s) => s.includes("/status")).map((s) => s.split("?")[0]).sort()).toEqual(["/Test/t-late/status", "/Test/t-new/status"]);
    const merges = db.rpcs().map((c) => c.args as Merge);
    expect(merges.map((m) => m.p_kind)).toEqual(["tests"]);
    for (const row of merges[0]!.p_rows) expect(row.baseline).toBe(false);
  });
});
