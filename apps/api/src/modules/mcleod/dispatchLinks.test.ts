import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readDispatchLinks, linkFleet, linkDispatcherUser, planAutoLinks, autoLinkDispatchers } from "./dispatchLinks.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";

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

describe("linkDispatcherUser — the office's word is final (0626)", () => {
  it("unlinking a linked login holds it, first, with who it was linked to and who unlinked it", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_dispatchers: [{ external_id: "vinniev", user_id: VINNIE }], tms_dispatcher_link_holds: [] } });
    expect(await linkDispatcherUser(rec.client, ORG, "vinniev", null, NOW, ADMIN)).toEqual({ ok: true });
    expect(rec.writtenRows("tms_dispatcher_link_holds")).toEqual([{ org_id: ORG, provider: "mcleod", external_id: "vinniev", user_id: VINNIE, held_by: ADMIN, held_at: NOW.toISOString() }]);
    const order = rec.writes().map((q) => q.table);
    expect(order.indexOf("tms_dispatcher_link_holds")).toBeLessThan(order.indexOf("tms_dispatchers"));
    expectOrgScoped(rec, ORG);
  });

  it("does not unlink when the hold cannot be written, so no automatic pass can undo an unlink nobody recorded", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_dispatchers: [{ external_id: "vinniev", user_id: VINNIE }], tms_dispatcher_link_holds: { writeError: { message: "relation does not exist" } } } });
    await expect(linkDispatcherUser(rec.client, ORG, "vinniev", null, NOW, ADMIN)).rejects.toThrow(/link_holds/);
    expect(rec.writtenRows("tms_dispatchers")).toEqual([]);
  });

  it("linking by hand releases any hold on the login", async () => {
    const rec = createSupabaseRecorder({ tables: { tms_dispatchers: [{ external_id: "vinniev", user_id: null }], tms_dispatcher_link_holds: [] } });
    await linkDispatcherUser(rec.client, ORG, "vinniev", VINNIE, NOW, ADMIN);
    expect(rec.forTable("tms_dispatcher_link_holds").filter((q) => q.write?.method === "delete")).toHaveLength(1);
  });
});

describe("planAutoLinks — link only what the data proves", () => {
  // The live carrier's shape on 2026-11-17 (Settings › McLeod fleets; office accounts by login email).
  const d = (id: string, o: { userId?: string | null; isSystem?: boolean; isActive?: boolean } = {}) => ({ id, userId: o.userId ?? null, isSystem: o.isSystem ?? false, isActive: o.isActive ?? true });
  const m = (userId: string, email: string | null, role = "dispatcher") => ({ userId, email, role });
  const LIVE_DISPATCHERS = ["aneta", "arturk", "asen", "chris", "ivok", "kane", "koni", "miro", "pete", "robert", "romann", "steve", "teo", "vladi"].map((id) => d(id))
    .concat([d("vinniev", { userId: "u-vinnie" }), d("marija", { userId: "u-marija" }), d("lmeadm", { isSystem: true }), d("loadmaster", { isSystem: true })]);
  const LIVE_MEMBERS = [
    m("u-asen", "alex@silvicominc.com", "admin"), m("u-miki", "miki@silvicominc.com", "admin"), m("u-marija", "safety@silvicominc.com", "admin"),
    m("u-pete", "pete@silvicominc.com"), m("u-robert", "robert@silvicominc.com"), m("u-steve", "steve@silvicominc.com"),
    m("u-teo", "teo@silvicominc.com"), m("u-vinnie", "vinnie@silvicominc.com"), m("u-vladi", "vladi@silvicominc.com"),
  ];

  it("links the five logins the live data proves, and none of the others", () => {
    expect(planAutoLinks(LIVE_DISPATCHERS, LIVE_MEMBERS, new Set()).sort((a, b) => a.dispatcherId.localeCompare(b.dispatcherId))).toEqual([
      { dispatcherId: "pete", userId: "u-pete" }, { dispatcherId: "robert", userId: "u-robert" }, { dispatcherId: "steve", userId: "u-steve" },
      { dispatcherId: "teo", userId: "u-teo" }, { dispatcherId: "vladi", userId: "u-vladi" },
    ]);
  });

  it("never links by a name that only looks alike, a longer email name, or a different case of nothing", () => {
    expect(planAutoLinks([d("steve")], [m("u-1", "stevens@x.com"), m("u-2", "s.teve@x.com"), m("u-3", null)], new Set())).toEqual([]);
    expect(planAutoLinks([d("steve")], [m("u-1", "Steve@X.com")], new Set())).toEqual([{ dispatcherId: "steve", userId: "u-1" }]);
  });

  it("leaves a login when two people could be it, or the one person already holds a login", () => {
    expect(planAutoLinks([d("steve")], [m("u-1", "steve@a.com"), m("u-2", "steve@b.com")], new Set())).toEqual([]);
    expect(planAutoLinks([d("steve"), d("vinniev", { userId: "u-1" })], [m("u-1", "steve@a.com")], new Set())).toEqual([]);
  });

  it("never links a held, linked, system or inactive login", () => {
    const one = [m("u-1", "steve@a.com")];
    expect(planAutoLinks([d("steve")], one, new Set(["steve"]))).toEqual([]);
    expect(planAutoLinks([d("steve", { userId: "u-9" })], one, new Set())).toEqual([]);
    expect(planAutoLinks([d("steve", { isSystem: true })], one, new Set())).toEqual([]);
    expect(planAutoLinks([d("steve", { isActive: false })], one, new Set())).toEqual([]);
  });
});

describe("autoLinkDispatchers", () => {
  it("fills only an empty link, so an office link made a moment before wins, and reports what it made", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        tms_dispatchers: (q) => (q.write ? [{ external_id: "steve" }] : postgrestFixture([{ org_id: ORG, provider: "mcleod", external_id: "steve", display_name: "steve", is_system: false, is_active: true, user_id: null }])(q)),
        tms_fleets: [],
        tms_dispatcher_link_holds: postgrestFixture([]),
      },
    });
    expect(await autoLinkDispatchers(rec.client, ORG, [{ userId: VINNIE, email: "steve@silvicominc.com", role: "dispatcher" }], NOW)).toEqual([{ dispatcherId: "steve", userId: VINNIE }]);
    const up = rec.forTable("tms_dispatchers").find((q) => q.write?.method === "update")!;
    expect(up.ops.some((o) => o.method === "is" && o.args[0] === "user_id" && o.args[1] === null)).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("links nothing when the holds cannot be read", async () => {
    const rec = createSupabaseRecorder({
      tables: { tms_dispatchers: [{ external_id: "steve", is_system: false, is_active: true, user_id: null }], tms_fleets: [], tms_dispatcher_link_holds: { error: { message: "relation does not exist" } } },
    });
    await expect(autoLinkDispatchers(rec.client, ORG, [{ userId: VINNIE, email: "steve@x.com", role: "dispatcher" }], NOW)).rejects.toThrow(/link_holds/);
    expect(rec.writes()).toEqual([]);
  });
});

