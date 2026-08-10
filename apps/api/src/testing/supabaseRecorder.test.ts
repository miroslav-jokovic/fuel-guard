import { describe, it, expect } from "vitest";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  RECORDER_AUTH_USER_ID,
} from "./supabaseRecorder.js";

/**
 * The recorder is now the only thing standing between a service that drops `.eq("org_id", …)` and a
 * green test run (audit 2026-08-09, Stage 2.5), so it gets its own tests. The case that matters most
 * is the NEGATIVE one: `expectOrgScoped` must actually throw. A guard that silently passes everything
 * is exactly the failure the hand-rolled fakes had, one level up.
 */
const ORG = "org1";

describe("createSupabaseRecorder — what it remembers", () => {
  it("records the filters a query applied, in order, including .match()", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: [{ id: "d1" }] } });
    await rec.client.from("drivers").select("id").eq("org_id", ORG).in("id", ["d1", "d2"]);
    await rec.client.from("drivers").select("id").match({ org_id: ORG, status: "active" });

    expect(rec.forTable("drivers")).toHaveLength(2);
    expect(rec.queries[0]!.filters()).toEqual([
      { col: "org_id", val: ORG },
      { col: "id", val: ["d1", "d2"] },
    ]);
    expect(rec.queries[1]!.filters()).toEqual([
      { col: "org_id", val: ORG },
      { col: "status", val: "active" },
    ]);
  });

  it("captures writes with their payload, and flattens chunked rows per table", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.from("idle_events").upsert([{ org_id: ORG, id: "a" }, { org_id: ORG, id: "b" }]);
    await rec.client.from("idle_events").upsert({ org_id: ORG, id: "c" });
    await rec.client.from("drivers").update({ full_name: "Ann" }).eq("id", "d1").eq("org_id", ORG);
    await rec.client.from("drivers").delete().eq("org_id", ORG);

    const writes = rec.writes();
    expect(writes.map((w) => w.write!.method)).toEqual(["upsert", "upsert", "update", "delete"]);
    expect(writes[0]!.write!.payload).toEqual([{ org_id: ORG, id: "a" }, { org_id: ORG, id: "b" }]);
    expect(rec.writtenRows("idle_events").map((r) => r.id)).toEqual(["a", "b", "c"]);
    // A delete's argument is options, not a row — it never shows up as written data.
    expect(rec.writtenRows("drivers")).toEqual([{ full_name: "Ann" }]);
  });

  it("serves fixtures: arrays, single rows, per-query functions, and paged reads", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        // A function fixture answers on the filters the query actually applied.
        driver_scores: (q) => (q.filters().some((f) => f.val === "2026-07-13") ? [{ driver_id: "d1" }] : []),
        settings: { data: { week_starts_on: 1 } },
        pageful: { pages: [[{ id: 1 }], [{ id: 2 }]] },
      },
    });
    const hit = await rec.client.from("driver_scores").select("*").eq("week_start", "2026-07-13");
    const miss = await rec.client.from("driver_scores").select("*").eq("week_start", "2026-07-06");
    expect((hit as { data: unknown[] }).data).toEqual([{ driver_id: "d1" }]);
    expect((miss as { data: unknown[] }).data).toEqual([]);

    expect((await rec.client.from("settings").select("*").maybeSingle()).data).toEqual({ week_starts_on: 1 });

    // Successive READS drain the page queue and then come back empty, so a paging loop terminates.
    const page = async () => (await rec.client.from("pageful").select("*")) as unknown as { data: unknown[] };
    expect((await page()).data).toEqual([{ id: 1 }]);
    expect((await page()).data).toEqual([{ id: 2 }]);
    expect((await page()).data).toEqual([]);
  });

  it("reports errors, including a table that reads fine but fails to write", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        broken: { error: { message: "nope" } },
        drivers: { data: [{ id: "d1" }], writeError: { message: "link failed" } },
      },
    });
    expect((await rec.client.from("broken").select("id")).error).toEqual({ message: "nope" });
    expect((await rec.client.from("drivers").select("id")).error).toBeNull();
    expect((await rec.client.from("drivers").update({ user_id: "u1" }).eq("id", "d1")).error).toEqual({
      message: "link failed",
    });
  });

  it("records rpc calls and auth admin calls, with scripted responses", async () => {
    const rec = createSupabaseRecorder({
      rpc: { merge_driver: 1 },
      auth: { createUser: () => ({ data: { user: null }, error: { message: "already registered" } }) },
    });
    await rec.client.rpc("merge_driver", { p_org: ORG, p_source: "a" });
    const created = await rec.client.auth.admin.createUser({ email: "x@y.z" });
    const other = await rec.client.auth.admin.deleteUser("auth-9");

    expect(rec.rpcs()).toEqual([{ fn: "merge_driver", args: { p_org: ORG, p_source: "a" } }]);
    expect(created.error).toEqual({ message: "already registered" });
    expect(other.error).toBeNull();
    expect(rec.authCalls.map((c) => c.fn)).toEqual(["createUser", "deleteUser"]);
    expect(rec.authCalls[1]!.args).toEqual(["auth-9"]);
    // Unscripted createUser invents this id, so a rollback assertion has something stable to name.
    const plain = createSupabaseRecorder();
    expect((await plain.client.auth.admin.createUser({})).data.user!.id).toBe(RECORDER_AUTH_USER_ID);
  });
});

describe("expectOrgScoped", () => {
  it("passes when every query names the org", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.from("drivers").select("id").eq("org_id", ORG);
    await rec.client.from("idle_events").delete().in("id", ["a"]).eq("org_id", ORG);
    expect(() => expectOrgScoped(rec, ORG)).not.toThrow();
  });

  it("throws when ONE query is unscoped, naming the table and the chain it ran", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.from("drivers").select("id").eq("org_id", ORG);
    await rec.client.from("idle_events").select("id").gte("started_at", "2026-01-01"); // forgot the org

    expect(() => expectOrgScoped(rec, ORG)).toThrow(/1 query\/queries were not scoped to org org1/);
    expect(() => expectOrgScoped(rec, ORG)).toThrow(/idle_events/);
    expect(() => expectOrgScoped(rec, ORG)).toThrow(/gte\("started_at", "2026-01-01"\)/);
  });

  it("throws when the filter names the wrong org, or the right column with a wrong value", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.from("drivers").select("id").eq("org_id", "someone-else");
    expect(() => expectOrgScoped(rec, ORG)).toThrow(/not scoped to org org1/);
  });

  it("counts .in(\"org_id\", [...]) as scoped when the org is in the list", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.from("drivers").select("id").in("org_id", ["orgA", ORG]);
    expect(() => expectOrgScoped(rec, ORG)).not.toThrow();

    const wrong = createSupabaseRecorder();
    await wrong.client.from("drivers").select("id").in("org_id", ["orgA", "orgB"]);
    expect(() => expectOrgScoped(wrong, ORG)).toThrow(/not scoped/);
  });

  it("counts an insert/upsert as scoped when every row names the org — and not otherwise", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.from("idle_events").upsert([{ org_id: ORG, id: "a" }, { org_id: ORG, id: "b" }]);
    expect(() => expectOrgScoped(rec, ORG)).not.toThrow();

    const mixed = createSupabaseRecorder();
    await mixed.client.from("idle_events").upsert([{ org_id: ORG, id: "a" }, { id: "b" }]); // one row has no org
    expect(() => expectOrgScoped(mixed, ORG)).toThrow(/idle_events/);
  });

  it("suppresses a named table via exempt, and only that table", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.from("weather_cache").select("hour_utc"); // global cache, no org_id column
    await rec.client.from("idle_events").select("id"); // genuinely unscoped

    expect(() => expectOrgScoped(rec, ORG, { exempt: ["weather_cache"] })).toThrow(/idle_events/);
    expect(() => expectOrgScoped(rec, ORG, { exempt: ["weather_cache"] })).not.toThrow(/weather_cache/);
    expect(() => expectOrgScoped(rec, ORG, { exempt: ["weather_cache", "idle_events"] })).not.toThrow();
  });

  it("ignores rpc calls (the SQL function owns its own scoping)", async () => {
    const rec = createSupabaseRecorder();
    await rec.client.rpc("merge_driver", { p_org: ORG });
    expect(() => expectOrgScoped(rec, ORG)).not.toThrow();
  });

  it("reset() clears queries, auth calls and page cursors", async () => {
    const rec = createSupabaseRecorder({ tables: { pageful: { pages: [[{ id: 1 }]] } } });
    await rec.client.from("pageful").select("*");
    await rec.client.auth.admin.deleteUser("u1");
    rec.reset();
    expect(rec.queries).toHaveLength(0);
    expect(rec.authCalls).toHaveLength(0);
    expect(((await rec.client.from("pageful").select("*")) as unknown as { data: unknown[] }).data).toEqual([
      { id: 1 },
    ]);
  });
});
