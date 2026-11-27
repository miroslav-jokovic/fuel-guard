import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { DRIVER_CLOSED_LOAD_DAYS, getDriverLoads } from "./driverLoadReads.js";
import { acceptLoad, acknowledgeLoad, addStopPhotos, completeStop, declineLoad, startLoad } from "./driverLoads.js";

/**
 * The driver's load list and actions (T1 N-9). The list reads with the service role, so which McLeod
 * loads are this driver's is ASKED of the database (`driver_visible_tms_load_ids`, 0661 — proven as a
 * real driver session in `loads-mirror-status-guard.test.mjs` and the 0661 matrix), and every read is
 * org-scoped here. The recorder does not evaluate PostgREST's grammar, so these pin what the queries send.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "11111111-2222-4333-8444-555555555555";
const USER = "44444444-2222-4333-8444-000000000001";
const L1 = "22222222-2222-4333-8444-000000000001";
const L2 = "22222222-2222-4333-8444-000000000002";
const STOP = "33333333-2222-4333-8444-000000000001";
const ACTION = "66666666-2222-4333-8444-000000000001";
const ARRIVE = "66666666-2222-4333-8444-000000000002";
const D_OLD = "77777777-2222-4333-8444-000000000001";
const D_NEW = "77777777-2222-4333-8444-000000000002";
const D_L2 = "77777777-2222-4333-8444-000000000003";
const NOW = new Date("2026-11-27T15:00:00Z");
const SHA = "a".repeat(64);
const PHOTO = { id: "55555555-2222-4333-8444-000000000001", slot: "bol", storage_path: `${ORG}/${DRIVER}/${L1}/p.jpg` };

/** An `.eq(col, val)` on the query — not `neq`, which `filters()` also lists. */
const has = (q: RecordedQuery, col: string, val: unknown) =>
  q.ops.some((o) => o.method === "eq" && o.args[0] === col && o.args[1] === val);
const op = (q: RecordedQuery, method: string) => q.ops.find((o) => o.method === method)?.args;
const load = (id: string, source: string, status = "approved") => ({
  id, source, status, ref: id.slice(-4), created_at: "2026-11-20T00:00:00Z", vehicles: null, trailers: null,
});

describe("getDriverLoads", () => {
  it("asks driver_visible_tms_load_ids with this org and driver, and reads only those McLeod ids, org-scoped", async () => {
    const rec = createSupabaseRecorder({
      rpc: { driver_visible_tms_load_ids: [L1] },
      tables: { loads: (q) => (has(q, "source", "tms") ? [load(L1, "tms")] : []) },
    });
    const loads = await getDriverLoads(rec.client, ORG, DRIVER, NOW);
    expect(rec.rpcs()).toEqual([{ fn: "driver_visible_tms_load_ids", args: { p_org: ORG, p_driver: DRIVER } }]);
    const tms = rec.forTable("loads").find((q) => has(q, "source", "tms"))!;
    expect(tms.ops.filter((o) => o.method === "in").map((o) => o.args)).toContainEqual(["id", [L1]]);
    expect(loads.map((l) => [l.id, l.source])).toEqual([[L1, "tms"]]);
    expectOrgScoped(rec, ORG);
  });

  it("with nothing sent, reads no McLeod load at all and still lists the manual ones", async () => {
    const rec = createSupabaseRecorder({
      rpc: { driver_visible_tms_load_ids: [] },
      tables: { loads: (q) => (has(q, "driver_id", DRIVER) ? [load(L2, "manual", "offered")] : []) },
    });
    const loads = await getDriverLoads(rec.client, ORG, DRIVER, NOW);
    expect(rec.forTable("loads").some((q) => has(q, "source", "tms"))).toBe(false);
    expect(loads.map((l) => l.id)).toEqual([L2]);
    expectOrgScoped(rec, ORG);
  });

  it("an RPC error throws instead of answering an empty list", async () => {
    const rec = createSupabaseRecorder({ rpc: { driver_visible_tms_load_ids: { error: { message: "boom" } } } });
    await expect(getDriverLoads(rec.client, ORG, DRIVER, NOW)).rejects.toThrow(/driver_visible_tms_load_ids/);
  });

  it("stops and photos are read in pages, org-scoped", async () => {
    const rec = createSupabaseRecorder({
      rpc: { driver_visible_tms_load_ids: [L1] },
      tables: {
        loads: (q) => (has(q, "source", "tms") ? [load(L1, "tms")] : []),
        load_stops: [{ id: STOP, load_id: L1, seq: 1, mcleod_removed_at: "2026-11-26T10:00:00Z" }],
        load_stop_photos: [{ ...PHOTO, stop_id: STOP, uploaded_at: "2026-11-26T11:00:00Z" }],
      },
    });
    const [only] = await getDriverLoads(rec.client, ORG, DRIVER, NOW);
    for (const table of ["load_stops", "load_stop_photos"]) {
      const q = rec.forTable(table)[0]!;
      expect(op(q, "range")).toEqual([0, 999]);
      expect(op(q, "in")).toEqual(["load_id", [L1]]);
    }
    expect(only!.stops[0]).toMatchObject({ id: STOP, mcleod_removed_at: "2026-11-26T10:00:00Z", photos: [{ id: PHOTO.id }] });
    expectOrgScoped(rec, ORG);
  });

  it("a load delivered 15 days ago is not listed but still accepts evidence", async () => {
    const rec = createSupabaseRecorder({
      rpc: { driver_visible_tms_load_ids: [L1], driver_complete_stop: { status: "late_evidence", late_reason: "not_current_driver" } },
      tables: { loads: [] },
    });
    await getDriverLoads(rec.client, ORG, DRIVER, NOW);
    const cutoff = new Date(NOW.getTime() - DRIVER_CLOSED_LOAD_DAYS * 86_400_000).toISOString();
    const window = `status.not.in.(delivered,canceled),external_closed_at.gte.${cutoff},and(external_closed_at.is.null,completed_at.gte.${cutoff})`;
    // Both sources carry the window; 15 days ago is before the cutoff, so the database drops it.
    expect(rec.forTable("loads").map((q) => op(q, "or")?.[0])).toEqual([window, window]);
    expect(Date.parse("2026-11-12T15:00:00Z")).toBeLessThan(Date.parse(cutoff));

    // The action door is not the list: the evidence goes to the function, which keeps it.
    const result = await completeStop(rec.client, ORG, DRIVER, L1, STOP, USER, { status: "completed", photos: [PHOTO], action_id: ACTION });
    expect(result).toMatchObject({ ok: true, status: "late_evidence" });
  });

  it("acknowledged_at is this driver's ack of the current dispatch only", async () => {
    const rec = createSupabaseRecorder({
      rpc: { driver_visible_tms_load_ids: [L1, L2] },
      tables: {
        loads: (q) => (has(q, "source", "tms") ? [load(L1, "tms"), load(L2, "tms")] : []),
        // Newest first, as the read orders them: L1 was re-sent (D_NEW) after the ack of D_OLD.
        load_dispatches: [
          { id: D_NEW, load_id: L1 },
          { id: D_OLD, load_id: L1 },
          { id: D_L2, load_id: L2 },
        ],
        load_events: [
          { load_id: L1, occurred_at: "2026-11-25T09:00:00Z", payload: { dispatch_id: D_OLD, driver_id: DRIVER } },
          { load_id: L2, occurred_at: "2026-11-26T09:14:00Z", payload: { dispatch_id: D_L2, driver_id: DRIVER } },
        ],
      },
    });
    const loads = await getDriverLoads(rec.client, ORG, DRIVER, NOW);
    expect(Object.fromEntries(loads.map((l) => [l.id, l.acknowledged_at]))).toEqual({ [L1]: null, [L2]: "2026-11-26T09:14:00Z" });
    const events = rec.forTable("load_events")[0]!;
    expect(has(events, "kind", "acknowledged") && has(events, "payload->>driver_id", DRIVER)).toBe(true);
    expect(rec.forTable("load_dispatches")[0]!.ops.filter((o) => o.method === "order").map((o) => o.args)).toEqual([
      ["sent_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expectOrgScoped(rec, ORG);
  });
});

describe("load actions (0661)", () => {
  const rpcOk = { driver_visible_tms_load_ids: [], driver_complete_stop: { status: "recorded" }, driver_acknowledge_load: { status: "recorded" } };
  const argsOf = (rec: ReturnType<typeof createSupabaseRecorder>, fn: string) =>
    rec.rpcs().find((c) => c.fn === fn)!.args as Record<string, unknown>;

  it("every load action passes the action id to its function", async () => {
    const rec = createSupabaseRecorder({ rpc: rpcOk, tables: { loads: [] } });
    await acceptLoad(rec.client, ORG, DRIVER, L1, USER, { action_id: ACTION });
    await declineLoad(rec.client, ORG, DRIVER, L1, USER, { reason: "personal", action_id: ACTION });
    await startLoad(rec.client, ORG, DRIVER, L1, USER, { action_id: ACTION });
    await acknowledgeLoad(rec.client, ORG, DRIVER, L1, USER, { action_id: ACTION });
    await completeStop(rec.client, ORG, DRIVER, L1, STOP, USER, { status: "arrived", photos: [], action_id: ACTION });
    for (const fn of ["driver_accept_load", "driver_decline_load", "driver_start_load", "driver_acknowledge_load", "driver_complete_stop"]) {
      expect(argsOf(rec, fn)).toMatchObject({ p_org: ORG, p_driver: DRIVER, p_load: L1, p_action_id: ACTION });
    }
    // Without one (an older build), the function still gets the parameter, as null.
    await startLoad(rec.client, ORG, DRIVER, L2, USER, {});
    expect(rec.rpcs().filter((c) => c.fn === "driver_start_load")[1]!.args).toMatchObject({ p_load: L2, p_action_id: null });
  });

  it("a Complete passes the arrival it carries and each photo's sha256", async () => {
    const rec = createSupabaseRecorder({ rpc: rpcOk, tables: { loads: [] } });
    await completeStop(rec.client, ORG, DRIVER, L1, STOP, USER, {
      status: "completed",
      photos: [{ ...PHOTO, sha256: SHA }],
      action_id: ACTION,
      arrived_at: "2026-11-27T14:02:00Z",
      arrive_action_id: ARRIVE,
    });
    const args = argsOf(rec, "driver_complete_stop");
    expect(args).toMatchObject({ p_arrived_at: "2026-11-27T14:02:00Z", p_arrive_action_id: ARRIVE, p_photos: [{ ...PHOTO, sha256: SHA }] });
    // The McLeod write switch is T-5's to send; N-9 must not.
    expect(args).not.toHaveProperty("p_mcleod_write");
  });

  it("late evidence answers 200 with status late_evidence", async () => {
    const rec = createSupabaseRecorder({
      rpc: { ...rpcOk, driver_complete_stop: { status: "late_evidence", late_reason: "removed_in_mcleod" } },
      tables: { loads: [] },
    });
    const result = await completeStop(rec.client, ORG, DRIVER, L1, STOP, USER, { status: "completed", photos: [PHOTO], action_id: ACTION });
    expect(result).toEqual({ ok: true, status: "late_evidence", load: null });
  });

  it("answers the function's other outcomes as they are, and a void function as recorded", async () => {
    for (const status of ["replayed", "photos_added", "already_done"] as const) {
      const rec = createSupabaseRecorder({ rpc: { ...rpcOk, driver_complete_stop: { status } }, tables: { loads: [] } });
      expect(await completeStop(rec.client, ORG, DRIVER, L1, STOP, USER, { status: "arrived", photos: [] })).toMatchObject({ ok: true, status });
    }
    const rec = createSupabaseRecorder({ rpc: { ...rpcOk, driver_accept_load: null }, tables: { loads: [] } });
    expect(await acceptLoad(rec.client, ORG, DRIVER, L1, USER, {})).toMatchObject({ ok: true, status: "recorded" });
  });

  it.each([
    ["DL012", 422, "action_id_reused"],
    ["DL013", 409, "mcleod_load_has_no_start"],
    ["DL014", 409, "mcleod_load_no_offer"],
    ["DL015", 422, "action_id_required"],
  ])("answers 0661's %s as %i %s, not as a 500", async (code, status, apiCode) => {
    const rec = createSupabaseRecorder({ rpc: { driver_start_load: { error: { code, message: "x" } } } });
    expect(await startLoad(rec.client, ORG, DRIVER, L1, USER, {})).toMatchObject({ ok: false, status, code: apiCode });
  });
});

describe("addStopPhotos (D-DV30, migration 0645)", () => {
  it("calls the late-photo function with this org, driver, load and stop, and only the photos", async () => {
    const rec = createSupabaseRecorder({ tables: { loads: [] }, rpc: { driver_visible_tms_load_ids: [], driver_add_stop_photos: 1 } });
    const result = await addStopPhotos(rec.client, ORG, DRIVER, L1, STOP, USER, { photos: [{ ...PHOTO, sha256: SHA }], action_id: ACTION });
    expect(result).toMatchObject({ ok: true, status: "photos_added" });
    expect(rec.rpcs()[0]).toEqual({
      fn: "driver_add_stop_photos",
      args: { p_org: ORG, p_driver: DRIVER, p_load: L1, p_stop: STOP, p_photos: [{ ...PHOTO, sha256: SHA }], p_actor_user: USER, p_occurred_at: null },
    });
  });

  it("a replay that adds nothing answers replayed", async () => {
    const rec = createSupabaseRecorder({ tables: { loads: [] }, rpc: { driver_visible_tms_load_ids: [], driver_add_stop_photos: 0 } });
    expect(await addStopPhotos(rec.client, ORG, DRIVER, L1, STOP, USER, { photos: [PHOTO] })).toMatchObject({ ok: true, status: "replayed" });
  });

  it("answers a stop finished too long ago (DL007) in the driver's words, not as a 500", async () => {
    const rec = createSupabaseRecorder({
      rpc: { driver_add_stop_photos: { error: { code: "DL007", message: "this stop finished more than 14 days ago" } } },
    });
    const result = await addStopPhotos(rec.client, ORG, DRIVER, L1, STOP, USER, { photos: [PHOTO] });
    expect(result).toMatchObject({ ok: false, status: 422, code: "late_photo_window_closed" });
    expect(result.ok === false && result.message).not.toMatch(/DL007|14 days ago/);
  });

  it("answers a stop that is not finished (DL003) as a state conflict", async () => {
    const rec = createSupabaseRecorder({
      rpc: { driver_add_stop_photos: { error: { code: "DL003", message: "late photos go on a completed stop (this one is arrived)" } } },
    });
    expect(await addStopPhotos(rec.client, ORG, DRIVER, L1, STOP, USER, { photos: [PHOTO] })).toMatchObject({ ok: false, status: 409, code: "wrong_state" });
  });
});
