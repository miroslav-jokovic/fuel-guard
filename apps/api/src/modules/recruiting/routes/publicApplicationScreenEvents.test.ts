import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { APPLICATION_INTAKE_LIMIT, SCREEN_EVENTS_LIMIT } from "../../../middleware/applicationLimits.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * The screen reports (AW14, C3d3a), end to end.
 *
 * What is pinned: a visit is inserted once, org- and invitation-scoped, with its times moved by the
 * difference between the phone's clock and the server's; a visit reported open is closed by a later
 * report and never touched again; a replayed report writes nothing; another link's visit cannot be
 * closed; a dead link is the one `invalid_link`; a name that is not a screen is refused; and the
 * reports count against their own per-link bucket, never the intake's 20 a minute.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INV = "11111111-2222-4333-8444-555555555555";
const V1 = "3f0c8a52-6d0e-4c7a-9b1e-2a4f5d6e7c8b";
const V2 = "4a1d9b63-7e1f-4d8b-8c2f-3b5a6e7f8d9c";
/** The server's clock. */
const NOW = new Date("2026-09-28T15:00:00.000Z");

let server: Server;
let baseUrl: string;
let seq = 0;
let n = 0;
/** A fresh link per test: the bucket under test is keyed by the link and lives as long as the app. */
const freshToken = (): string => String(++n).padStart(3, "0").repeat(15).slice(0, 43);

const post = (token: string, body: unknown, ip = `198.51.100.${(seq++ % 250) + 1}`) =>
  fetch(`${baseUrl}/api/public/application/${token}/screen-events`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });

const seed = (token: string, visits: FixtureRow[] = [], invitation: FixtureRow = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: INV, org_id: ORG, driver_id: "d-1", token_hash: hashInvitationToken(token),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: null, ...invitation,
      }],
      application_screen_events: postgrestFixture(visits),
    },
  });
const TOKEN_LOOKUP = { exempt: ["application_invitations"] };

/** A report sent when the phone read `phoneNow`. */
const report = (phoneNow: string, events: unknown[]) => ({ sent_at: phoneNow, events });

const writesTo = (rec: ReturnType<typeof seed>) =>
  rec.writes().filter((q) => q.table === "application_screen_events");
const filtersOf = (q: RecordedQuery) => q.ops.filter((o) => ["eq", "is", "in"].includes(o.method)).map((o) => o.args);

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /:token/screen-events", () => {
  it("inserts each new visit once, on this link, with its times moved onto the server's clock", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = freshToken();
    const rec = seed(token);
    holder.client = rec.client;
    // The phone runs ten minutes fast: it says 15:10 when the server says 15:00.
    const res = await post(token, report("2026-09-28T15:10:00.000Z", [
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T15:07:00.000Z", left_at: "2026-09-28T15:08:30.000Z" },
      { id: V2, screen: "part1.other_licences", entered_at: "2026-09-28T15:08:30.000Z", left_at: null },
    ]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, inserted: 2, closed: 0 });
    expect(rec.writtenRows("application_screen_events")).toEqual([
      { id: V1, org_id: ORG, invitation_id: INV, screen: "part1.about",
        entered_at: "2026-09-28T14:57:00.000Z", left_at: "2026-09-28T14:58:30.000Z" },
      { id: V2, org_id: ORG, invitation_id: INV, screen: "part1.other_licences",
        entered_at: "2026-09-28T14:58:30.000Z", left_at: null },
    ]);
    // Insert-or-nothing on the page's own id: a replayed report or a made-up id is a no-op, never an overwrite.
    const [insert] = writesTo(rec);
    expect(insert!.write!.method).toBe("upsert");
    expect(insert!.ops.find((o) => o.method === "upsert")!.args[1]).toEqual({ onConflict: "id", ignoreDuplicates: true });
    // The lookup of what this link already reported is scoped to this link.
    const lookup = rec.forTable("application_screen_events").find((q) => q.write === null)!;
    expect(filtersOf(lookup)).toEqual([["org_id", ORG], ["invitation_id", INV], ["id", [V1, V2]]]);
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });

  it("closes a visit it was told about open, and only that one, scoped to this link", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = freshToken();
    const rec = seed(token, [
      { id: V1, org_id: ORG, invitation_id: INV, screen: "part1.about", entered_at: "2026-09-28T14:50:00.000Z", left_at: null },
    ]);
    holder.client = rec.client;
    const res = await post(token, report(NOW.toISOString(), [
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T14:50:00.000Z", left_at: "2026-09-28T14:55:00.000Z" },
    ]));
    expect(await res.json()).toEqual({ ok: true, inserted: 0, closed: 1 });
    const writes = writesTo(rec);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.write).toEqual({ method: "update", payload: { left_at: "2026-09-28T14:55:00.000Z" } });
    expect(filtersOf(writes[0]!)).toEqual([["id", V1], ["org_id", ORG], ["invitation_id", INV], ["left_at", null]]);
  });

  it("writes nothing for a report it already holds — a closed visit is never touched again", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = freshToken();
    const rec = seed(token, [
      { id: V1, org_id: ORG, invitation_id: INV, screen: "part1.about",
        entered_at: "2026-09-28T14:50:00.000Z", left_at: "2026-09-28T14:55:00.000Z" },
    ]);
    holder.client = rec.client;
    const res = await post(token, report(NOW.toISOString(), [
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T14:50:00.000Z", left_at: "2026-09-28T14:56:00.000Z" },
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T14:50:00.000Z", left_at: null },
    ]));
    expect(await res.json()).toEqual({ ok: true, inserted: 0, closed: 0 });
    expect(writesTo(rec)).toEqual([]);
  });

  it("keeps a new visit closed when one report names it closed and then open", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = freshToken();
    const rec = seed(token);
    holder.client = rec.client;
    await post(token, report(NOW.toISOString(), [
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T14:50:00.000Z", left_at: "2026-09-28T14:55:00.000Z" },
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T14:50:00.000Z", left_at: null },
    ]));
    expect(rec.writtenRows("application_screen_events")).toEqual([
      expect.objectContaining({ id: V1, left_at: "2026-09-28T14:55:00.000Z" }),
    ]);
  });

  it("cannot close another link's visit: an id it does not hold is offered only as an insert", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = freshToken();
    const rec = seed(token, [
      { id: V1, org_id: ORG, invitation_id: "99999999-2222-4333-8444-555555555555", screen: "part1.about",
        entered_at: "2026-09-28T14:50:00.000Z", left_at: null },
    ]);
    holder.client = rec.client;
    await post(token, report(NOW.toISOString(), [
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T14:50:00.000Z", left_at: "2026-09-28T14:55:00.000Z" },
    ]));
    const writes = writesTo(rec);
    expect(writes.map((w) => w.write!.method)).toEqual(["upsert"]);
    expect(rec.writtenRows("application_screen_events")[0]).toMatchObject({ invitation_id: INV });
  });

  it("drops a visit that lands in the future even after the clocks are reconciled", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = freshToken();
    const rec = seed(token);
    holder.client = rec.client;
    const res = await post(token, report(NOW.toISOString(), [
      { id: V1, screen: "part1.about", entered_at: "2026-09-28T15:30:00.000Z", left_at: null },
    ]));
    expect(await res.json()).toEqual({ ok: true, inserted: 0, closed: 0 });
    expect(writesTo(rec)).toEqual([]);
  });

  it("answers a dead link with the one invalid_link, and refuses a name that is not a screen", async () => {
    const dead = freshToken();
    const rec = seed(dead, [], { revoked_at: "2026-09-20T00:00:00Z" });
    holder.client = rec.client;
    const res = await post(dead, report(new Date().toISOString(), [
      { id: V1, screen: "part1.about", entered_at: new Date(Date.now() - 1000).toISOString(), left_at: null },
    ]));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_link");
    expect(writesTo(rec)).toEqual([]);

    const token = freshToken();
    holder.client = seed(token).client;
    const bad = await post(token, report(new Date().toISOString(), [
      { id: V1, screen: "dob-1990-01-01", entered_at: new Date(Date.now() - 1000).toISOString(), left_at: null },
    ]));
    expect(bad.status).toBe(400);
  });

  it(`takes ${SCREEN_EVENTS_LIMIT} reports a minute per link, and none of them from the intake's ${APPLICATION_INTAKE_LIMIT}`, async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ip = "203.0.113.77";
    const body = () => report(new Date().toISOString(), [
      { id: V1, screen: "part1.about", entered_at: new Date(Date.now() - 1000).toISOString(), left_at: null },
    ]);
    // More reports from one address than the intake allows, spread over links: none refused.
    const links = Math.ceil((APPLICATION_INTAKE_LIMIT + 1) / SCREEN_EVENTS_LIMIT);
    for (let l = 0; l < links; l += 1) {
      const token = freshToken();
      holder.client = seed(token).client;
      for (let i = 0; i < SCREEN_EVENTS_LIMIT; i += 1) expect((await post(token, body(), ip)).status).toBe(200);
      if (l === 0) {
        const refused = await post(token, body(), ip);
        expect(refused.status).toBe(429);
        expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("too_many_requests");
      }
    }
  });
});
