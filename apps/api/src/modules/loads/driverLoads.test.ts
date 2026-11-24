import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { addStopPhotos, getDriverLoads } from "./driverLoads.js";

/**
 * The driver's load list reads with the service role, so it must restate every rule RLS would have
 * applied (0087, 0371). The database half — that a McLeod load reaches a driver only while its current
 * dispatch names them — is proven in `loads-mirror-status-guard.test.mjs` as a real driver session. The
 * recorder does not evaluate PostgREST's `or` grammar, so this pins the exact predicate the query
 * sends, and the dispatch fixtures decide which load ids reach it.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const L1 = "22222222-2222-4333-8444-000000000001";
const L2 = "22222222-2222-4333-8444-000000000002";

const loadsOr = (rec: ReturnType<typeof createSupabaseRecorder>) =>
  rec.forTable("loads")[0]!.ops.find((o) => o.method === "or")?.args[0];

describe("getDriverLoads", () => {
  it("asks only for this driver's loads in this org, and with no dispatch, no McLeod load at all", async () => {
    const rec = createSupabaseRecorder({ tables: { loads: [], load_dispatches: [] } });
    await getDriverLoads(rec.client, ORG, DRIVER);
    expectOrgScoped(rec, ORG);
    expect(rec.forTable("loads")[0]!.filters()).toContainEqual({ col: "driver_id", val: DRIVER });
    expect(loadsOr(rec)).toBe("source.neq.tms");
  });

  it("admits a McLeod load only while its LATEST dispatch names this driver", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        loads: [],
        // First read: the rows naming me. Second read: every row of those loads, newest first — L2 was
        // re-sent to somebody else after it was sent to me, so it is theirs now.
        load_dispatches: {
          pages: [
            [{ load_id: L1 }, { load_id: L2 }],
            [
              { load_id: L2, driver_id: OTHER },
              { load_id: L1, driver_id: DRIVER },
              { load_id: L2, driver_id: DRIVER },
            ],
          ],
        },
      },
    });
    await getDriverLoads(rec.client, ORG, DRIVER);
    expectOrgScoped(rec, ORG);
    expect(loadsOr(rec)).toBe(`source.neq.tms,id.in.(${L1})`);
    // Newest first, with the same tie-break as auth_dispatched_load_ids (0371).
    const history = rec.forTable("load_dispatches")[1]!.ops.filter((o) => o.method === "order").map((o) => o.args);
    expect(history).toEqual([
      ["sent_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });
});

describe("addStopPhotos (D-DV30, migration 0645)", () => {
  const STOP = "33333333-2222-4333-8444-000000000001";
  const USER = "44444444-2222-4333-8444-000000000001";
  const PHOTO = { id: "55555555-2222-4333-8444-000000000001", slot: "seal", storage_path: `${ORG}/${DRIVER}/${L1}/p.jpg` };

  it("calls the late-photo function with this org, driver, load and stop, and only the photos", async () => {
    const rec = createSupabaseRecorder({ tables: { loads: [], load_dispatches: [] }, rpc: { driver_add_stop_photos: 1 } });
    const result = await addStopPhotos(rec.client, ORG, DRIVER, L1, STOP, USER, { photos: [PHOTO] });
    expect(result.ok).toBe(true);
    expect(rec.rpcs()).toEqual([
      {
        fn: "driver_add_stop_photos",
        args: { p_org: ORG, p_driver: DRIVER, p_load: L1, p_stop: STOP, p_photos: [PHOTO], p_actor_user: USER, p_occurred_at: null },
      },
    ]);
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
