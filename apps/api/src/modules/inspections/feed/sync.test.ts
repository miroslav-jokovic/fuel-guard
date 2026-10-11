import { describe, it, expect } from "vitest";
import { FMCSA_DATASETS, type FmcsaDataset } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import type { SocrataClient } from "./socrata.js";
import { syncFmcsaFeed } from "./sync.js";

/**
 * One carrier's FMCSA feed run (INSPECTION-CHALLENGE-PLAN IC1, 0457): six datasets, the inspection
 * file first, children asked for by its ids, each dataset all-or-nothing.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DOT = "1864495";
const CLOCK = () => new Date("2026-10-11T12:00:00.000Z");

type RowsFn = (dataset: FmcsaDataset, where: string) => Record<string, unknown>[];
function fakeSocrata(rows: RowsFn) {
  const calls: Array<{ dataset: FmcsaDataset; where: string }> = [];
  const client = {
    requestCount: 0,
    async rowsUpdatedAt() {
      this.requestCount++;
      return new Date("2026-10-11T06:00:00.000Z");
    },
    async rows(dataset: FmcsaDataset, where: string) {
      this.requestCount++;
      calls.push({ dataset, where });
      return rows(dataset, where);
    },
  };
  return { client: client as unknown as SocrataClient, calls };
}

const inspections = (n: number) => Array.from({ length: n }, (_, i) => ({ inspection_id: String(80000000 + i), change_date: "20261001 1200" }));
const childRow = (dataset: FmcsaDataset, id: string) =>
  dataset === "876r-jsdb" ? { inspection_id: id, insp_violation_id: `v${id}` }
  : dataset === "wt8s-2hbx" ? { inspection_id: id, insp_unit_id: `u${id}` }
  : { inspection_id: id, vioseqnum: "1", adjseq: "1" };
const idsIn = (where: string) => [...where.matchAll(/\d{8}/g)].map((m) => m[0]);

// The recorder hands a scripted value back as the call's `data`; `{ error }` as a failed call.
const okRpc = (_fn: string, args: unknown) => [
  { run_id: `run-${(args as { p_dataset: string }).p_dataset}`, rows_seen: (args as { p_rows: unknown[] }).p_rows.length, rows_new: 0, rows_changed: 0, rows_reappeared: 0, rows_vanished: 0 },
];

describe("syncFmcsaFeed", () => {
  it("fetches the inspection file first, then asks its children for our ids in chunks of 200", async () => {
    const insp = inspections(250);
    const { client, calls } = fakeSocrata((d, where) =>
      d === "fx4q-ay7w" ? insp
      : d === "rbkj-cgst" ? [{ unique_id: "1" }]
      : d === "8mt8-2mdr" ? [{ unique_id: "1", viol_code: "392.2", viol_unit: "1" }]
      : idsIn(where).map((id) => childRow(d, id)));
    const rec = createSupabaseRecorder({ rpc: okRpc });

    const out = await syncFmcsaFeed(rec.client, ORG, DOT, client, CLOCK);

    expect(out.map((r) => `${r.dataset}:${r.outcome}`)).toEqual(FMCSA_DATASETS.map((d) => `${d}:succeeded`));
    expect(calls[0]).toEqual({ dataset: "fx4q-ay7w", where: "dot_number = 1864495" });
    const units = calls.filter((c) => c.dataset === "wt8s-2hbx");
    expect(units.map((c) => idsIn(c.where).length)).toEqual([200, 50]);
    expect(units[0]!.where.startsWith("inspection_id in ('80000000'")).toBe(true);
    expect(calls.find((c) => c.dataset === "876r-jsdb")!.where.startsWith("inspection_id in (80000000,")).toBe(true);
    expect(calls.find((c) => c.dataset === "rbkj-cgst")!.where).toBe("dot_number = '1864495'");

    const rpcs = rec.rpcs();
    expect(rpcs.map((r) => r.fn)).toEqual(Array(6).fill("fmcsa_snapshot_record"));
    const unitRpc = rpcs.find((r) => (r.args as { p_dataset: string }).p_dataset === "wt8s-2hbx")!.args as {
      p_org: string;
      p_dot_number: string;
      p_rows: Array<{ k: string; p: unknown }>;
      p_run: Record<string, unknown>;
    };
    expect(unitRpc.p_org).toBe(ORG);
    expect(unitRpc.p_dot_number).toBe(DOT);
    expect(unitRpc.p_rows).toHaveLength(250);
    expect(unitRpc.p_rows[0]).toEqual({ k: "u80000000", p: childRow("wt8s-2hbx", "80000000") });
    expect(unitRpc.p_run).toMatchObject({ complete: true, request_count: 3, source_rows_updated_at: "2026-10-11T06:00:00.000Z" });
  });

  it("records the three children as failed, saying why, when the inspection file fails — and still runs SMS", async () => {
    const { client, calls } = fakeSocrata((d) => {
      if (d === "fx4q-ay7w") throw new Error("HTTP 503 (after 3 attempts)");
      return d === "rbkj-cgst" ? [{ unique_id: "1" }] : [{ unique_id: "1", viol_code: "392.2", viol_unit: "1" }];
    });
    const rec = createSupabaseRecorder({ rpc: okRpc });

    const out = await syncFmcsaFeed(rec.client, ORG, DOT, client, CLOCK);

    expect(out.map((r) => r.outcome)).toEqual(["failed", "failed", "failed", "failed", "succeeded", "succeeded"]);
    expect(calls.map((c) => c.dataset)).toEqual(["fx4q-ay7w", "rbkj-cgst", "8mt8-2mdr"]);
    const failed = rec.writtenRows("fmcsa_fetch_runs");
    expect(failed.map((r) => r.dataset)).toEqual(["fx4q-ay7w", "876r-jsdb", "wt8s-2hbx", "qbt8-7vic"]);
    expect(failed[0]).toMatchObject({ org_id: ORG, outcome: "failed", complete: false, dot_number: DOT, error: "HTTP 503 (after 3 attempts)" });
    expect(String(failed[1]!.error)).toMatch(/asked for by inspection id, and the fx4q-ay7w run failed/);
    expectOrgScoped(rec, ORG);
  });

  it("records nothing for a child dataset when one of its chunks fails — half a complete snapshot would vanish the rest", async () => {
    const insp = inspections(250);
    let unitCalls = 0;
    const { client } = fakeSocrata((d, where) => {
      if (d === "fx4q-ay7w") return insp;
      if (d === "wt8s-2hbx" && ++unitCalls === 2) throw new Error("HTTP 500 (after 3 attempts)");
      if (d === "rbkj-cgst") return [{ unique_id: "1" }];
      if (d === "8mt8-2mdr") return [{ unique_id: "1", viol_code: "392.2", viol_unit: "1" }];
      return idsIn(where).map((id) => childRow(d, id));
    });
    const rec = createSupabaseRecorder({ rpc: okRpc });

    const out = await syncFmcsaFeed(rec.client, ORG, DOT, client, CLOCK);

    expect(out.find((r) => r.dataset === "wt8s-2hbx")!.outcome).toBe("failed");
    expect(rec.rpcs().map((r) => (r.args as { p_dataset: string }).p_dataset)).not.toContain("wt8s-2hbx");
    expect(out.filter((r) => r.outcome === "succeeded")).toHaveLength(5);
    expect(rec.writtenRows("fmcsa_fetch_runs")).toEqual([expect.objectContaining({ dataset: "wt8s-2hbx", outcome: "failed", org_id: ORG })]);
  });

  it("records the database's refusal of an empty snapshot (FM001) as that dataset's failure", async () => {
    const { client } = fakeSocrata((d) => (d === "fx4q-ay7w" ? [] : []));
    const rec = createSupabaseRecorder({
      rpc: (fn, args) =>
        (args as { p_dataset: string }).p_dataset === "fx4q-ay7w"
          ? { error: { code: "FM001", message: "an empty complete snapshot of fx4q-ay7w would vanish 1390 present rows; refused" } }
          : okRpc(fn, args),
    });

    const out = await syncFmcsaFeed(rec.client, ORG, DOT, client, CLOCK);

    expect(out[0]).toMatchObject({ dataset: "fx4q-ay7w", outcome: "failed" });
    expect((out[0] as { error: string }).error).toMatch(/would vanish 1390 present rows/);
    expect(rec.writtenRows("fmcsa_fetch_runs")[0]).toMatchObject({ dataset: "fx4q-ay7w", outcome: "failed" });
  });
});
