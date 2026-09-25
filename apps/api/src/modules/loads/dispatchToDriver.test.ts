import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import { dispatchLoad, dispatchesByLoad, previewLoadDispatch } from "./dispatchToDriver.js";

/**
 * Dispatch (LR-D2, D-LMR5/D-LMR6). What the API must hold on its own, since it writes with the service
 * role: every read scoped to the org, the refusals, and — above all — an outcome recorded as it is. The
 * database half (the CHECK that makes "sent" unwritable without a receipt, the append-only guard) is
 * `load-dispatches.test.mjs`.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LOAD = "11111111-2222-4333-8444-000000000001";
const DRIVER = "11111111-2222-4333-8444-000000000002";
const ACTOR = "11111111-2222-4333-8444-000000000003";

const dark = testEnv({ SMS_PROVIDER: "none" });
const live = testEnv({ SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "key", TELNYX_FROM: "+13125550100" });

const tables = (over: Record<string, unknown> = {}) => ({
  loads: [{ id: LOAD, ref: "0012345", status: "in_transit", source: "tms", vehicles: { unit_number: "702" }, trailers: null }],
  drivers: [{ id: DRIVER, full_name: "Dana Kelly", status: "active" }],
  load_stops: [
    { seq: 1, kind: "pickup", name: "S", location_name: "ACME Foods", city: "Dallas", state: "TX", appointment_start: "2026-09-25T13:00:00Z" },
    { seq: 2, kind: "dropoff", name: "C", location_name: null, city: "Chicago", state: "IL", appointment_start: null },
  ],
  organizations: [{ name: "Silvicom Transport", operating_hours: { tz: "America/Chicago" } }],
  load_dispatches: [{ id: "d-1", sent_at: "2026-09-24T23:00:00Z" }],
  ...over,
});

// `organizations` is read by its own primary key, the org id itself — there is no `org_id` column.
const EXEMPT = { exempt: ["organizations"] };

describe("dispatchLoad", () => {
  it("writes one not-sent row, scoped to the org, saying SMS is not configured — never that it was sent", async () => {
    const rec = createSupabaseRecorder({ tables: tables() });
    const result = await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER);
    expectOrgScoped(rec, ORG, EXEMPT);
    expect(rec.forTable("organizations")[0]!.filters()).toContainEqual({ col: "id", val: ORG });

    const [row] = rec.writtenRows("load_dispatches");
    expect(row).toMatchObject({
      org_id: ORG,
      load_id: LOAD,
      driver_id: DRIVER,
      sent_by: ACTOR,
      channel: "sms",
      outcome: "not_sent",
      outcome_reason: "sms_not_configured",
      recipient: null,
      provider_message_id: null,
    });
    // The text as the driver would read it: the carrier's clock, McLeod's stop name.
    expect(row!.body).toContain("Pick up: ACME Foods, Dallas TX, 09/25/2026 8:00 AM");
    expect(result).toMatchObject({ ok: true, data: { outcome: "not_sent", outcomeReason: "sms_not_configured" } });
  });

  it("with Telnyx configured it still does not text: no consent covers a dispatch yet (Q-LMR9)", async () => {
    const rec = createSupabaseRecorder({ tables: tables() });
    await dispatchLoad(rec.client, live, ORG, ACTOR, LOAD, DRIVER);
    expect(rec.writtenRows("load_dispatches")[0]).toMatchObject({ outcome: "not_sent", outcome_reason: "no_dispatch_consent" });
  });

  it("refuses a load that is not in this org — 404, and nothing written", async () => {
    const rec = createSupabaseRecorder({ tables: tables({ loads: [] }) });
    expect(await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER)).toMatchObject({ ok: false, status: 404 });
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a manual load: Dispatch is the McLeod path", async () => {
    const rec = createSupabaseRecorder({ tables: tables({ loads: [{ id: LOAD, ref: "M", status: "approved", source: "manual" }] }) });
    expect(await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER)).toMatchObject({ ok: false, code: "not_a_mcleod_load" });
    expect(rec.writes()).toHaveLength(0);
  });

  it.each(["delivered", "canceled"])("refuses a %s load", async (status) => {
    const rec = createSupabaseRecorder({ tables: tables({ loads: [{ id: LOAD, ref: "X", status, source: "tms" }] }) });
    expect(await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER)).toMatchObject({ ok: false, code: "load_closed" });
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a driver who is not active here", async () => {
    const rec = createSupabaseRecorder({ tables: tables({ drivers: [{ id: DRIVER, full_name: "Gone", status: "terminated" }] }) });
    expect(await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER)).toMatchObject({ ok: false, code: "unknown_driver" });
    expect(rec.writes()).toHaveLength(0);
  });
});

describe("previewLoadDispatch", () => {
  it("returns the exact text Send would store, and why it would not be texted, writing nothing", async () => {
    const rec = createSupabaseRecorder({ tables: tables() });
    const preview = await previewLoadDispatch(rec.client, dark, ORG, LOAD, DRIVER);
    expectOrgScoped(rec, ORG, EXEMPT);
    expect(rec.writes()).toHaveLength(0);

    const sent = createSupabaseRecorder({ tables: tables() });
    await dispatchLoad(sent.client, dark, ORG, ACTOR, LOAD, DRIVER);
    expect(preview).toMatchObject({ ok: true, data: { driverName: "Dana Kelly", smsHeldBecause: "sms_not_configured" } });
    expect(preview.ok && preview.data.body).toBe(sent.writtenRows("load_dispatches")[0]!.body);
  });
});

describe("dispatchesByLoad", () => {
  const OTHER_LOAD = "11111111-2222-4333-8444-000000000009";
  it("groups every dispatch by load, keeps the newest first, and names the driver — one org-scoped read", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        // Rows arrive in the order the query asks for: newest first.
        load_dispatches: [
          { id: "d-3", load_id: LOAD, driver_id: DRIVER, sent_at: "2026-09-24T12:00:00Z", channel: "sms", outcome: "not_sent", outcome_reason: "sms_not_configured", drivers: { full_name: "Dana Kelly" } },
          { id: "d-2", load_id: OTHER_LOAD, driver_id: DRIVER, sent_at: "2026-09-24T11:00:00Z", channel: "sms", outcome: "not_sent", outcome_reason: "sms_not_configured", drivers: [{ full_name: "Dana Kelly" }] },
          { id: "d-1", load_id: LOAD, driver_id: "x", sent_at: "2026-09-24T10:00:00Z", channel: "sms", outcome: "not_sent", outcome_reason: "sms_not_configured", drivers: null },
        ],
      },
    });
    const by = await dispatchesByLoad(rec.client, ORG, [LOAD, OTHER_LOAD]);
    expectOrgScoped(rec, ORG);
    expect(by.get(LOAD)?.map((d) => d.id)).toEqual(["d-3", "d-1"]);
    expect(by.get(LOAD)?.[0]).toMatchObject({ driverName: "Dana Kelly", outcome: "not_sent", outcomeReason: "sms_not_configured" });
    expect(by.get(LOAD)?.[1]?.driverName).toBeNull();
    expect(by.get(OTHER_LOAD)?.[0]?.driverName).toBe("Dana Kelly");
    const orders = rec.forTable("load_dispatches")[0]!.ops.filter((o) => o.method === "order").map((o) => o.args);
    expect(orders).toEqual([["sent_at", { ascending: false }], ["id", { ascending: false }]]);
  });

  it("asks nothing when there are no McLeod loads on the page", async () => {
    const rec = createSupabaseRecorder();
    expect((await dispatchesByLoad(rec.client, ORG, [])).size).toBe(0);
    expect(rec.queries).toHaveLength(0);
  });
});
