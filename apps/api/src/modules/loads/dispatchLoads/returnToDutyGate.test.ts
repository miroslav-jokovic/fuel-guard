import { describe, it, expect } from "vitest";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { assignLoad, createLoad, updateLoad } from "./mutations.js";

/**
 * §40.25(j) at the three doors a driver can walk through onto a load (0237).
 *
 * ── WHY THREE TESTS AND NOT ONE ───────────────────────────────────────────────────────────────
 * The gate looks like it belongs on the action called "assign", and a gate only there would have
 * been trivially walked around: `createLoad` takes a `driver_id` on the new load, and `updateLoad`
 * takes one in its patch — which is the request the board already sends. All three are asserted here
 * because the ONE that gets forgotten is the one that ships.
 *
 * §40.25(j) forbids USING the driver for a safety-sensitive function. Driving a commercial motor
 * vehicle is one (§382.107), and a load assignment is the act that puts somebody behind the wheel.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const LOAD = "11111111-2222-4333-8444-555555555555";
const ACTOR = { userId: "user-1", role: "dispatcher" };

/** A roster where the named driver owes return-to-duty documentation and has filed none. */
const blocked = () =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ return_to_duty_required: true }],
      qualification_records: [],
      loads: [{ driver_id: null, status: "draft" }],
    },
  });

/** The same driver, with the §40.305 paperwork on file. */
const cleared = () =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ return_to_duty_required: true }],
      qualification_records: [{ id: "rtd-1" }],
      loads: [{ driver_id: null, status: "draft" }],
      load_stops: [],
    },
  });

const REFUSAL = { status: 409, code: "return_to_duty_required" };

describe("a driver who owes return-to-duty documentation", () => {
  it("cannot be assigned to a load", async () => {
    const rec = blocked();
    const res = await assignLoad(rec.client, ORG, LOAD, ACTOR, { driver_id: DRIVER });
    expect(res).toMatchObject({ ok: false, ...REFUSAL });
    expect(rec.writtenRows("loads")).toHaveLength(0);
  });

  it("cannot be put on a load at creation either", async () => {
    const rec = blocked();
    const res = await createLoad(rec.client, ORG, ACTOR, {
      ref: "L-1", driver_id: DRIVER, hazmat: false, stops: [],
    } as Parameters<typeof createLoad>[3]);
    expect(res).toMatchObject({ ok: false, ...REFUSAL });
    expect(rec.writtenRows("loads")).toHaveLength(0);
  });

  it("cannot be patched onto a load through the board's own request", async () => {
    const rec = blocked();
    const res = await updateLoad(rec.client, ORG, LOAD, {
      driver_id: DRIVER,
    } as Parameters<typeof updateLoad>[3]);
    expect(res).toMatchObject({ ok: false, ...REFUSAL });
    // ⚠ Refused BEFORE the patch is built, so `replaceStops` never runs on a rejected request.
    expect(rec.writtenRows("loads")).toHaveLength(0);
    expect(rec.forTable("load_stops")).toHaveLength(0);
  });

  /**
   * ⚠ The refusal tells the dispatcher nothing about the underlying fact. A return-to-duty record is
   * a §382.401(a) testing record and they may not read one; a message naming a failed drug test would
   * hand them in an error string exactly what the custody rule keeps out of their hands.
   */
  it("is refused in words that do not say why", async () => {
    const res = await assignLoad(blocked().client, ORG, LOAD, ACTOR, { driver_id: DRIVER });
    const message = (res as { message: string }).message.toLowerCase();
    for (const leak of ["drug", "alcohol", "positive", "test"]) {
      expect(message, `leaks "${leak}"`).not.toContain(leak);
    }
  });
});

describe("the gate lets everything else through", () => {
  it("assigns the same driver once the documentation is filed", async () => {
    const rec = cleared();
    const res = await assignLoad(rec.client, ORG, LOAD, ACTOR, { driver_id: DRIVER });
    expect(res).toMatchObject({ ok: true });
    expect(rec.writtenRows("loads")[0]).toMatchObject({ driver_id: DRIVER });
  });

  /**
   * Unassigning is never the act §40.25(j) forbids, and a gate that refused it would trap a blocked
   * driver on whatever load they were already on — the exact opposite of the regulation's intent.
   */
  it("never blocks a patch that carries no driver at all", async () => {
    const rec = blocked();
    const res = await updateLoad(rec.client, ORG, LOAD, {
      notes: "reroute",
    } as Parameters<typeof updateLoad>[3]);
    expect(res).toMatchObject({ ok: true });
    expect(rec.forTable("drivers")).toHaveLength(0);
  });
});
