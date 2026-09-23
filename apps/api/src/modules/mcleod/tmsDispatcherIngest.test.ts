import { describe, expect, it } from "vitest";
import type { TmsLoadInput } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestDispatchers, knownDispatcherIds } from "./tmsDispatcherIngest.js";
import { ingestLoads } from "./tmsLoadIngest.js";

/**
 * L4: who dispatches a load, carried from McLeod onto the board (LOADS-GO-LIVE-PLAN.md §L4).
 *
 * Two writers, and the recorder rather than a hand-rolled stub for both, because the API writes with
 * the service role and the org filter is the only tenant boundary these queries have.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** An office has already mapped `kane` to a Silvicom person — the link a re-sync must not undo. */
const linked = () =>
  createSupabaseRecorder({
    tables: {
      tms_dispatchers: [
        { org_id: ORG, provider: "mcleod", external_id: "kane", display_name: "kane", user_id: "u-kane", is_system: false, is_active: true },
      ],
    },
  });

describe("the dispatcher roster writer", () => {
  it("writes complete rows scoped to the org", async () => {
    const rec = linked();
    const res = await ingestDispatchers(rec.client, ORG, "mcleod", [
      { external_id: "kane", display_name: "kane", is_system: false, is_active: true },
      { external_id: "vladi", display_name: "Vladi Popov", is_system: false, is_active: true },
    ]);
    expect(res).toEqual({ received: 2, upserted: 2 });
    expectOrgScoped(rec, ORG);
    const rows = rec.writtenRows("tms_dispatchers");
    expect(rows.map((r) => r.external_id)).toEqual(["kane", "vladi"]);
    for (const r of rows) {
      // Every NOT NULL column, on every row: a partial upsert fails on the insert branch (lint:upserts).
      expect(r).toMatchObject({ org_id: ORG, provider: "mcleod" });
      expect(typeof r.is_system).toBe("boolean");
      expect(typeof r.is_active).toBe("boolean");
    }
    const upsert = rec.writes().find((q) => q.table === "tms_dispatchers");
    expect(upsert?.ops.find((o) => o.method === "upsert")?.args[1]).toEqual({
      onConflict: "org_id,provider,external_id",
    });
  });

  it("a re-sync never carries user_id, so an office's link survives it", async () => {
    const rec = linked();
    await ingestDispatchers(rec.client, ORG, "mcleod", [
      { external_id: "kane", display_name: "Kane R.", is_system: false, is_active: true },
    ]);
    const [row] = rec.writtenRows("tms_dispatchers");
    // Absent, not null: an upsert sets exactly the columns it carries, so `user_id: null` here would
    // unlink the person on every poll.
    expect(row).toBeDefined();
    expect(Object.keys(row!)).not.toContain("user_id");
    expect(row!.display_name).toBe("Kane R.");
  });

  it("sets is_system for loadmaster and lmeadm exactly as the agent sent it, never from the name", async () => {
    const rec = createSupabaseRecorder();
    await ingestDispatchers(rec.client, ORG, "mcleod", [
      { external_id: "loadmaster", display_name: "McLeod Administrator", is_system: true, is_active: true },
      { external_id: "lmeadm", display_name: "McLeod Administrator", is_system: true, is_active: true },
      // Same display name, but the agent's configuration does not list it: a person, by the only
      // authority this side has. Inferring from the name would file their loads under a robot.
      { external_id: "romann", display_name: "McLeod Administrator", is_system: false, is_active: true },
    ]);
    const bySystem = Object.fromEntries(rec.writtenRows("tms_dispatchers").map((r) => [r.external_id, r.is_system]));
    expect(bySystem).toEqual({ loadmaster: true, lmeadm: true, romann: false });
  });

  it("stores a blank name as null and keeps one row per account", async () => {
    const rec = createSupabaseRecorder();
    const res = await ingestDispatchers(rec.client, ORG, "mcleod", [
      { external_id: "koni", display_name: "", is_system: false, is_active: true },
      { external_id: "koni", display_name: "", is_system: false, is_active: false },
    ]);
    expect(res).toEqual({ received: 2, upserted: 1 });
    expect(rec.writtenRows("tms_dispatchers")).toEqual([
      expect.objectContaining({ external_id: "koni", display_name: null, is_active: false }),
    ]);
  });

  it("writes nothing for an empty roster", async () => {
    const rec = createSupabaseRecorder();
    expect(await ingestDispatchers(rec.client, ORG, "mcleod", [])).toEqual({ received: 0, upserted: 0 });
    expect(rec.writes()).toHaveLength(0);
  });

  it("fails loudly when the write fails, rather than reporting a roster it did not store", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_dispatchers: { writeError: { message: "boom" } } } });
    await expect(
      ingestDispatchers(rec.client, ORG, "mcleod", [{ external_id: "kane", is_system: false, is_active: true }]),
    ).rejects.toThrow(/boom/);
  });

  it("reads known ids for this org and provider only", async () => {
    const rec = linked();
    expect([...(await knownDispatcherIds(rec.client, ORG, "mcleod"))]).toEqual(["kane"]);
    expectOrgScoped(rec, ORG);
    expect(rec.forTable("tms_dispatchers")[0]?.filters()).toContainEqual({ col: "provider", val: "mcleod" });
  });
});

// ── the load half ──────────────────────────────────────────────────────────────────────────────

const load = (over: Partial<TmsLoadInput> = {}): TmsLoadInput => ({
  external_id: "TMS:291985",
  ref: "0135582",
  canceled: false,
  stops: [{ seq: 1, kind: "pickup", name: "Viking Packing" }],
  ...over,
});

/** `loads` answers reads with `existing` and inserts with the rows it was sent, given ids. */
const board = (existing: Record<string, unknown>[], dispatchers: string[] = ["romann"]) =>
  createSupabaseRecorder({
    tables: {
      loads: (q) => {
        if (q.write?.method !== "insert") return existing;
        const sent = q.write.payload as { external_id: string }[];
        return sent.map((r, i) => ({ id: `new-${i}`, external_id: r.external_id }));
      },
      tms_dispatchers: dispatchers.map((external_id) => ({ external_id })),
      org_integrations: [{ config: {} }],
    },
  });

const loadUpdates = (rec: ReturnType<typeof board>) =>
  rec.writes().filter((q) => q.table === "loads" && q.write?.method === "update").map((q) => q.write!.payload as Record<string, unknown>);

describe("the load ingest carries the dispatcher", () => {
  it("writes it on a new load, org-scoped end to end", async () => {
    const rec = board([]);
    await ingestLoads(rec.client, ORG, "mcleod", [load({ dispatcher_external_id: "romann" })]);
    expect(rec.writtenRows("loads")[0]).toMatchObject({ dispatcher_external_id: "romann" });
    expectOrgScoped(rec, ORG);
  });

  it("writes null on a new load the feed sent without one — an A load has no dispatcher yet", async () => {
    const rec = board([]);
    await ingestLoads(rec.client, ORG, "mcleod", [load()]);
    expect(rec.writtenRows("loads")[0]).toMatchObject({ dispatcher_external_id: null });
  });

  it("patches it onto a load the feed still owns, and leaves it alone when the feed was silent", async () => {
    const prior = { id: "L1", external_id: "TMS:291985", status: "pending_approval", ref: "0135582" };
    const sent = board([prior]);
    await ingestLoads(sent.client, ORG, "mcleod", [load({ dispatcher_external_id: "romann" })]);
    expect(loadUpdates(sent)[0]).toMatchObject({ dispatcher_external_id: "romann" });

    const silent = board([prior]);
    await ingestLoads(silent.client, ORG, "mcleod", [load()]);
    expect(Object.keys(loadUpdates(silent)[0]!)).not.toContain("dispatcher_external_id");
    expectOrgScoped(sent, ORG);
  });

  it("stamps a reassignment onto an APPROVED load without raising an amendment", async () => {
    // McLeod moved 291985 from romann to steve after dispatch approved it. It is on a dispatcher's
    // board precisely because it is approved; frozen, it would stay on romann's.
    const prior = { id: "L1", external_id: "TMS:291985", status: "approved", ref: "0135582", driver_id: null, vehicle_id: null, trailer_id: null };
    const rec = board([prior], ["romann", "steve"]);
    const res = await ingestLoads(rec.client, ORG, "mcleod", [load({ dispatcher_external_id: "steve", external_status: "P" })]);
    expect(res.amended).toBe(0);
    expect(loadUpdates(rec)).toEqual([
      expect.objectContaining({ external_status: "P", dispatcher_external_id: "steve" }),
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("reports a dispatcher the roster has not carried yet, and still ingests the load", async () => {
    const rec = board([], ["romann"]);
    const res = await ingestLoads(rec.client, ORG, "mcleod", [
      load({ external_id: "TMS:1", dispatcher_external_id: "romann" }),
      load({ external_id: "TMS:2", dispatcher_external_id: "newhire" }),
      load({ external_id: "TMS:3", dispatcher_external_id: "newhire" }),
    ]);
    expect(res.created).toBe(3);
    expect(res.unknownDispatchers).toEqual(["newhire"]);
  });
});
