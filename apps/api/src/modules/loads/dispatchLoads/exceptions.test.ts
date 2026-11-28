import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { listExceptions } from "./exceptions.js";

/**
 * The Loads page's exceptions feed — the three kinds T1 N-9 adds (M-A): late evidence, a sent load
 * nobody's app shows, and McLeod stops the mirror could not apply. Every read org-scoped.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LOAD = "22222222-2222-4333-8444-000000000001";
const DRIVER = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-27T18:00:00Z");

const eq = (q: RecordedQuery, col: string, val: unknown) =>
  q.ops.some((o) => o.method === "eq" && o.args[0] === col && o.args[1] === val);

/** `load_events` answered by which read is asking: candidates, late evidence, resolutions, or driver events. */
function seed(opts: { candidates?: unknown[]; late?: unknown[]; resolved?: unknown[]; dispatches?: unknown[]; openLoads?: unknown[]; drivers?: unknown[] } = {}) {
  return createSupabaseRecorder({
    tables: {
      load_events: (q) =>
        eq(q, "payload->>late_evidence", "true")
          ? (opts.late ?? [])
          : eq(q, "kind", "exception_resolved")
            ? (opts.resolved ?? [])
            : eq(q, "actor_role", "driver")
              ? []
              : (opts.candidates ?? []),
      loads: (q) =>
        eq(q, "source", "tms")
          ? (opts.openLoads ?? [])
          : [{ id: LOAD, ref: "0132143", drivers: { full_name: "Dana Kelly" }, status: "approved", external_closed_at: null, driver_id: DRIVER, co_driver_id: null }],
      load_dispatches: opts.dispatches ?? [],
      drivers: opts.drivers ?? [{ id: DRIVER, full_name: "Dana Kelly", user_id: null, app_access_enabled: false }],
      driver_duty_sessions: [],
      device_push_tokens: [],
    },
  });
}

describe("listExceptions — T1 N-9", () => {
  it("late evidence is an open exception naming the driver and the stop", async () => {
    const rec = seed({
      late: [
        {
          id: "e-late", load_id: LOAD, kind: "stop_completed", occurred_at: "2026-11-27T16:00:00Z",
          payload: { driver_id: DRIVER, seq: 2, late_evidence: true, late_reason: "not_current_driver" },
        },
      ],
    });
    const [x] = await listExceptions(rec.client, ORG, NOW);
    expect(x).toMatchObject({ id: "e-late", kind: "late_evidence", load_id: LOAD, driver_name: "Dana Kelly", action: "acknowledge" });
    expect(x!.summary).toBe("Dana Kelly sent work for stop 2 of 0132143 after it was sent to somebody else. It was kept, not applied.");
    expectOrgScoped(rec, ORG);
  });

  it("late evidence somebody resolved is gone", async () => {
    const rec = seed({
      late: [{ id: "e-late", load_id: LOAD, kind: "stop_photo_added", occurred_at: "2026-11-27T16:00:00Z", payload: { driver_id: DRIVER, late_evidence: true } }],
      resolved: [{ load_id: LOAD, occurred_at: "2026-11-27T17:00:00Z", payload: { resolves: "e-late" } }],
    });
    expect(await listExceptions(rec.client, ORG, NOW)).toEqual([]);
  });

  it("a sent load nobody can see is an open exception", async () => {
    const dispatch = {
      id: "d-1", load_id: LOAD, driver_id: DRIVER, sent_at: "2026-11-27T14:00:00Z", channel: "sms", outcome: "not_sent",
      outcome_reason: "sms_not_configured", drivers: { full_name: "Dana Kelly" },
    };
    const rec = seed({ openLoads: [{ id: LOAD }], dispatches: [dispatch] });
    const [x] = await listExceptions(rec.client, ORG, NOW);
    expect(x).toMatchObject({
      id: `dispatch_not_visible:${LOAD}`, kind: "dispatch_not_visible", driver_name: "Dana Kelly",
      detail: { dispatch_id: "d-1", reason: "no_app_login" }, occurred_at: "2026-11-27T14:00:00Z",
    });
    expect(x!.summary).toContain("who has no app login");
    // Only open McLeod loads are asked about: a closed load is done, not an exception.
    const open = rec.forTable("loads").find((q) => eq(q, "source", "tms"))!;
    expect(open.ops.some((o) => o.method === "is" && o.args[0] === "external_closed_at")).toBe(true);
    expectOrgScoped(rec, ORG);

    // Acknowledged after that Send: gone. Acknowledged BEFORE it (an earlier Send): still open.
    const later = seed({ openLoads: [{ id: LOAD }], dispatches: [dispatch], resolved: [{ load_id: LOAD, occurred_at: "2026-11-27T15:00:00Z", payload: { resolves: `dispatch_not_visible:${LOAD}` } }] });
    expect(await listExceptions(later.client, ORG, NOW)).toEqual([]);
    const earlier = seed({ openLoads: [{ id: LOAD }], dispatches: [dispatch], resolved: [{ load_id: LOAD, occurred_at: "2026-11-27T13:00:00Z", payload: { resolves: `dispatch_not_visible:${LOAD}` } }] });
    expect(await listExceptions(earlier.client, ORG, NOW)).toHaveLength(1);
  });

  it("a refused stop mirror is open until the next clean apply", async () => {
    const refusal = (id: string, at: string) => ({ id, load_id: LOAD, kind: "stop_mirror_refused", occurred_at: at, payload: { reason: "stop_tail_over_200" } });
    const two = [refusal("r-1", "2026-11-25T10:00:00Z"), refusal("r-2", "2026-11-26T10:00:00Z")];

    // Refused two days running: ONE row, the newest.
    const open = await listExceptions(seed({ candidates: two }).client, ORG, NOW);
    expect(open.map((x) => [x.id, x.kind])).toEqual([["r-2", "stop_mirror_refused"]]);

    // The mirror's clean apply closes the newest (0660); the older one is the same fact, not a new row.
    const clean = { load_id: LOAD, occurred_at: "2026-11-27T10:00:00Z", payload: { resolves: "r-2", kind: "stop_mirror_refused", by: "mirror" } };
    expect(await listExceptions(seed({ candidates: two, resolved: [clean] }).client, ORG, NOW)).toEqual([]);

    // Refused again after that clean apply: open again.
    const again = [...two, refusal("r-3", "2026-11-27T12:00:00Z")];
    expect((await listExceptions(seed({ candidates: again, resolved: [clean] }).client, ORG, NOW)).map((x) => x.id)).toEqual(["r-3"]);
  });
});
