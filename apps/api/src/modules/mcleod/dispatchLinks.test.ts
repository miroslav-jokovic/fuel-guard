import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readDispatchLinks, linkFleet, linkDispatcherUser } from "./dispatchLinks.js";

/**
 * Whose fleet is whose (DISPATCH-BOARD-PLAN DB2/DB3): two office links and the scope derived from them.
 * "My fleet" is computed at request time and stored nowhere.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VINNIE = "7e3c1a2b-0000-4000-8000-000000000001";
const ADMIN = "7e3c1a2b-0000-4000-8000-000000000009";
const NOW = new Date("2026-10-09T20:00:00Z");

const dispatchers = [
  { external_id: "vinniev", display_name: "vinniev", is_system: false, is_active: true, user_id: VINNIE },
  { external_id: "ivok", display_name: "Ivo K", is_system: false, is_active: true, user_id: VINNIE },
  { external_id: "loadmaster", display_name: "McLeod Administrator", is_system: true, is_active: true, user_id: null },
];
const fleets = [
  { code: "VINNIEV", dispatcher_external_id: "vinniev" },
  { code: "IVO", dispatcher_external_id: "ivok" },
  { code: "KANE", dispatcher_external_id: "kane" },
  { code: "1", dispatcher_external_id: null },
];

describe("readDispatchLinks — the caller's scope, derived", () => {
  it("is every fleet run by any McLeod login linked to the caller", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_dispatchers: dispatchers, tms_fleets: fleets } });
    const r = await readDispatchLinks(rec.client, ORG, VINNIE);
    // Fleet codes are not logins: 'IVO' is run by 'ivok', and only the link says so.
    expect(r.scope).toEqual({ linked: true, fleetCodes: ["IVO", "VINNIEV"], dispatcherIds: ["ivok", "vinniev"] });
    expect(r.dispatchers.find((d) => d.id === "loadmaster")).toMatchObject({ isSystem: true, userId: null });
    expectOrgScoped(rec, ORG);
  });

  it("is unlinked — and empty — for somebody no McLeod login is linked to", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_dispatchers: dispatchers, tms_fleets: fleets } });
    const r = await readDispatchLinks(rec.client, ORG, ADMIN);
    expect(r.scope).toEqual({ linked: false, fleetCodes: [], dispatcherIds: [] });
  });
});

describe("linkFleet", () => {
  it("links a fleet to a login, stamping who and when", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_fleets: [{ code: "VINNIEV" }], tms_dispatchers: [{ external_id: "vinniev" }] } });
    const r = await linkFleet(rec.client, ORG, "VINNIEV", "vinniev", ADMIN, NOW);
    expect(r).toEqual({ ok: true });
    expect(rec.writtenRows("tms_fleets")).toEqual([
      { dispatcher_external_id: "vinniev", linked_by: ADMIN, linked_at: NOW.toISOString(), updated_at: NOW.toISOString() },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("unlinks with null, clearing who linked it", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_fleets: [{ code: "VINNIEV" }], tms_dispatchers: [] } });
    await linkFleet(rec.client, ORG, "VINNIEV", null, ADMIN, NOW);
    expect(rec.writtenRows("tms_fleets")[0]).toMatchObject({ dispatcher_external_id: null, linked_by: null, linked_at: null });
  });

  it("refuses a fleet or a login McLeod never sent, and writes nothing", async () => {
    const none = createSupabaseRecorder({ tables: { tms_fleets: [], tms_dispatchers: [{ external_id: "vinniev" }] } });
    expect(await linkFleet(none.client, ORG, "NOPE", "vinniev", ADMIN, NOW)).toMatchObject({ ok: false, code: "unknown_fleet" });
    const noLogin = createSupabaseRecorder({ tables: { tms_fleets: [{ code: "VINNIEV" }], tms_dispatchers: [] } });
    expect(await linkFleet(noLogin.client, ORG, "VINNIEV", "ghost", ADMIN, NOW)).toMatchObject({ ok: false, code: "unknown_dispatcher" });
    expect([...none.writes(), ...noLogin.writes()]).toEqual([]);
  });
});

describe("linkDispatcherUser", () => {
  it("links a McLeod login to a user, and refuses a login McLeod never sent", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_dispatchers: [{ external_id: "vinniev" }] } });
    expect(await linkDispatcherUser(rec.client, ORG, "vinniev", VINNIE, NOW)).toEqual({ ok: true });
    expect(rec.writtenRows("tms_dispatchers")).toEqual([{ user_id: VINNIE, updated_at: NOW.toISOString() }]);
    expectOrgScoped(rec, ORG);
    const none = createSupabaseRecorder({ tables: { tms_dispatchers: [] } });
    expect(await linkDispatcherUser(none.client, ORG, "ghost", VINNIE, NOW)).toMatchObject({ ok: false, code: "unknown_dispatcher" });
  });
});
