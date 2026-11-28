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
  it("puts the load in the app of a driver with an app login: one app/sent row, and a New load notice to driver and co-driver (S1.1)", async () => {
    const CO = "11111111-2222-4333-8444-000000000009";
    const rec = createSupabaseRecorder({
      tables: tables({
        loads: [{ id: LOAD, ref: "0012345", status: "approved", source: "tms", vehicles: { unit_number: "702" }, trailers: null,
          driver_id: DRIVER, co_driver_id: CO }],
        // Answered by the driver the query asks for, as the database would.
        drivers: (q: { filters: () => { col: string; val: unknown }[] }) => {
          const id = q.filters().find((f) => f.col === "id")?.val;
          return id === CO
            ? [{ id: CO, user_id: "u-co" }]
            : [{ id: DRIVER, full_name: "Dana Kelly", status: "active", user_id: "u-dana", app_access_enabled: true }];
        },
      }),
      rpc: { emit_notification: "n-1" },
    });
    const result = await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER);
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "driver_app_features", "rpc:emit_notification"] });
    const rows = rec.writtenRows("load_dispatches");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "app", outcome: "sent", outcome_reason: null });
    expect(result).toMatchObject({ ok: true, data: { channel: "app", outcome: "sent", outcomeReason: null } });
    const told = rec.rpcs().filter((r) => r.fn === "emit_notification").map((r) => r.args as Record<string, unknown>);
    expect(told.map((a) => a.p_user)).toEqual(["u-dana", "u-co"]);
    expect(told[0]).toMatchObject({ p_category: "load_offered", p_title: "New load from dispatch", p_entity_id: LOAD,
      p_dedupe_key: "load_dispatch:d-1:u-dana" });
  });

  it("tells nobody, and keeps the held text record, when the driver has no app login", async () => {
    const rec = createSupabaseRecorder({ tables: tables(), rpc: { emit_notification: "n-1" } });
    const result = await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER);
    expect(rec.writtenRows("load_dispatches")[0]).toMatchObject({ channel: "sms", outcome: "not_sent" });
    expect(rec.rpcs().filter((r) => r.fn === "emit_notification")).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, data: { channel: "sms" } });
  });

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

/**
 * §40.25(j) (0237). Create, edit and assign were the doors onto a load and each carried this gate; LR6
 * retired all three, and since D-LMR5 Dispatch is the one act that puts a driver on a load. So the gate
 * lives here now, and a test pins it where it lives: a regulation's refusal that moves without its test
 * is the one that quietly stops refusing.
 */
describe("a driver who owes return-to-duty documentation", () => {
  const owes = { id: DRIVER, full_name: "Dana Kelly", status: "active", return_to_duty_required: true };

  it("cannot be dispatched a load — 409, nothing written", async () => {
    const rec = createSupabaseRecorder({ tables: tables({ drivers: [owes], qualification_records: [] }) });
    const result = await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER);
    expect(result).toMatchObject({ ok: false, status: 409, code: "return_to_duty_required" });
    expect(rec.writes()).toHaveLength(0);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("is refused at the preview, before a text is shown, in words that do not say why", async () => {
    const rec = createSupabaseRecorder({ tables: tables({ drivers: [owes], qualification_records: [] }) });
    const preview = await previewLoadDispatch(rec.client, dark, ORG, LOAD, DRIVER);
    expect(preview).toMatchObject({ ok: false, code: "return_to_duty_required" });
    const message = preview.ok ? "" : preview.message.toLowerCase();
    for (const leak of ["drug", "alcohol", "positive", "refus", "test"]) expect(message).not.toContain(leak);
  });

  it("is dispatched once the §40.305 documentation is on file", async () => {
    const rec = createSupabaseRecorder({ tables: tables({ drivers: [owes], qualification_records: [{ id: "rtd-1" }] }) });
    expect(await dispatchLoad(rec.client, dark, ORG, ACTOR, LOAD, DRIVER)).toMatchObject({ ok: true });
    expect(rec.writtenRows("load_dispatches")).toHaveLength(1);
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

/**
 * What the office sees after Send (T1 N-9): who said "Got it", whether anybody's app shows the load,
 * and McLeod's seats — derived per read from the load, the driver and 0661's events.
 */
describe("dispatchesByLoad — what the office sees after Send (T1 N-9)", () => {
  const CO = "11111111-2222-4333-8444-000000000009";
  const SOMEONE = "11111111-2222-4333-8444-000000000008";
  const facts = (over: { load?: Record<string, unknown>; drivers?: unknown[]; events?: unknown[]; tokens?: unknown[] } = {}) =>
    createSupabaseRecorder({
      tables: {
        load_dispatches: [
          { id: "d-1", load_id: LOAD, driver_id: DRIVER, sent_at: "2026-11-27T14:00:00Z", channel: "app", outcome: "sent", outcome_reason: null, drivers: { full_name: "Dana Kelly" } },
        ],
        loads: [{ id: LOAD, status: "approved", external_closed_at: null, driver_id: DRIVER, co_driver_id: null, ...over.load }],
        drivers: over.drivers ?? [{ id: DRIVER, full_name: "Dana Kelly", user_id: "u-dana", app_access_enabled: true }],
        load_events: over.events ?? [],
        device_push_tokens: over.tokens ?? [],
      },
    });

  it("a dispatch seen by its driver lists the acknowledgement", async () => {
    const rec = facts({
      events: [
        { load_id: LOAD, kind: "acknowledged", occurred_at: "2026-11-27T15:14:00Z", recorded_at: "2026-11-27T15:14:02Z", payload: { dispatch_id: "d-1", driver_id: DRIVER } },
        // An ack of an EARLIER dispatch of the same load is not this dispatch's.
        { load_id: LOAD, kind: "acknowledged", occurred_at: "2026-11-26T09:00:00Z", recorded_at: "2026-11-26T09:00:00Z", payload: { dispatch_id: "d-0", driver_id: DRIVER } },
      ],
      tokens: [{ user_id: "u-dana", last_seen_at: "2026-11-27T13:00:00Z" }],
    });
    const [d] = (await dispatchesByLoad(rec.client, ORG, [LOAD])).get(LOAD)!;
    expect(d).toMatchObject({
      acknowledgements: [{ driverId: DRIVER, driverName: "Dana Kelly", at: "2026-11-27T15:14:00Z" }],
      reachable: { ok: true },
      seatNote: null,
      // The later of the driver's newest event on this load and the app's last check-in.
      lastContactAt: "2026-11-27T15:14:02Z",
    });
    expect(rec.forTable("load_events")[0]!.filters()).toContainEqual({ col: "actor_role", val: "driver" });
    expectOrgScoped(rec, ORG);
  });

  it("a dispatch to a driver with no app login says the driver will not see it", async () => {
    const rec = facts({ drivers: [{ id: DRIVER, full_name: "Dana Kelly", user_id: null, app_access_enabled: false }] });
    const [d] = (await dispatchesByLoad(rec.client, ORG, [LOAD])).get(LOAD)!;
    expect(d!.reachable).toEqual({ ok: false, reason: "no_app_login" });
    expect(d!.lastContactAt).toBeNull();
  });

  it("a dispatch of an uncovered McLeod load says nobody will see it", async () => {
    const rec = facts({ load: { status: "draft" } });
    const [d] = (await dispatchesByLoad(rec.client, ORG, [LOAD])).get(LOAD)!;
    expect(d!.reachable).toEqual({ ok: false, reason: "uncovered_in_mcleod" });
  });

  it("a dispatch to a driver McLeod does not seat is visible to them and says McLeod seats someone else", async () => {
    const rec = facts({ load: { driver_id: SOMEONE, co_driver_id: CO } });
    const [d] = (await dispatchesByLoad(rec.client, ORG, [LOAD])).get(LOAD)!;
    expect(d!.reachable).toEqual({ ok: true });
    expect(d!.seatNote).toBe("mcleod_seats_someone_else");
    // Sent to somebody McLeod does not name, the co-driver is not a seat of this dispatch (0655).
    expect(d!.seats.map((s) => s.driverId)).toEqual([DRIVER]);
  });

  it("a dispatch to McLeod's driver seats the co-driver too, by name", async () => {
    const rec = facts({
      load: { co_driver_id: CO },
      drivers: [
        { id: DRIVER, full_name: "Dana Kelly", user_id: "u-dana", app_access_enabled: true },
        { id: CO, full_name: "Luis Ortega", user_id: null, app_access_enabled: false },
      ],
    });
    const [d] = (await dispatchesByLoad(rec.client, ORG, [LOAD])).get(LOAD)!;
    expect(d!.seats).toEqual([
      { driverId: DRIVER, driverName: "Dana Kelly" },
      { driverId: CO, driverName: "Luis Ortega" },
    ]);
  });
});
