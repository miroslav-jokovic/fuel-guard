import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UNIT_NOTE_PAGE_LIMIT, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * `/api/notes` through the real mount (UNIT-NOTES-PLAN §4.3, step UN2): who reaches it (every office
 * role the `notes` screen is on for; never a driver — D-UN4), that every table query carries the org
 * and every RPC is handed the session's org (the service role bypasses RLS and UN1's table has no
 * client policies, so this file is the only layer that can see a missing filter), and the mapping
 * from UN1's snake_case rows to the frozen contract.
 *
 * The RPCs are UN1's (§4.1) and are scripted here; their SQL is proved by
 * `supabase/tests/unit-notes.test.mjs`.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const TRUCK = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const OTHER_TRUCK = "77777777-8888-4999-8aaa-000000000000";
const DRIVER = "66666666-8888-4999-8aaa-bbbbbbbbbbbb";
const NOTE_A = "50000000-0000-4000-8000-00000000000a";
const NOTE_THEIRS = "50000000-0000-4000-8000-0000000000ff";
const MENTIONED = "90000000-0000-4000-8000-000000000001";

const ROLES = ["admin", "dispatcher", "accountant", "recruiter", "technician", "driver"] as const;
const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(ROLES.map((r) => [r, ctx(r)]));

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/notes${path}`, {
    ...init,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
  });
const post = (path: string, token: string, body: unknown) => call(path, token, { method: "POST", body: JSON.stringify(body) });

const searchRow = (over: Record<string, unknown> = {}) => ({
  id: NOTE_A,
  subject_kind: "vehicle",
  subject_id: TRUCK,
  subject_label: "1042",
  body: `Brakes squeal, <@${MENTIONED}> booked it`,
  author_id: "u-dispatcher",
  author_name: "Dana Dispatch",
  pinned: false,
  created_at: "2026-11-10T15:00:00.123456+00:00",
  mentions: [MENTIONED],
  fuzzy: false,
  ...over,
});

function seed(over: { rpc?: Record<string, unknown>; surfaceRows?: unknown[]; insertError?: unknown } = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: postgrestFixture((over.surfaceRows ?? []) as Record<string, unknown>[]),
      user_surface_access: [],
      organizations: postgrestFixture([{ id: ORG, operating_hours: { timezone: "America/Chicago" } }]),
      vehicles: postgrestFixture([
        { id: TRUCK, org_id: ORG, unit_number: "1042" },
        { id: OTHER_TRUCK, org_id: OTHER_ORG, unit_number: "9" },
      ]),
      drivers: postgrestFixture([{ id: DRIVER, org_id: ORG, full_name: "Sam Driver" }]),
      trailers: postgrestFixture([]),
      user_profiles: [{ full_name: "Dana Dispatch" }],
      unit_notes: (q) => {
        if (q.write) {
          return over.insertError
            ? { data: null, error: over.insertError }
            : { data: [{ ...searchRow({ pinned: false, created_at: "2026-11-11T16:00:00+00:00" }), body: "Tyre low" }], error: null };
        }
        return postgrestFixture([
          { id: NOTE_A, org_id: ORG, subject_kind: "vehicle", subject_id: TRUCK },
          { id: NOTE_THEIRS, org_id: OTHER_ORG, subject_kind: "vehicle", subject_id: OTHER_TRUCK },
        ])(q);
      },
      audit_logs: [],
    },
    rpc: (fn: string) =>
      over.rpc && fn in over.rpc
        ? over.rpc[fn]
        : fn === "unit_notes_search" ? [searchRow()]
        : fn === "unit_note_summary" ? { vehicle: { [TRUCK]: { count: 3, last_at: "2026-11-10T15:00:00+00:00" } } }
        : fn === "set_unit_note_pinned" ? true
        : null,
  });
  holder.client = rec.client;
  return rec;
}

/**
 * The tables the gates read before the handler runs, and `user_profiles`. The two surface tables are
 * read by `requireSurface` org-scoped already (`surfaceAccess.ts`); `user_profiles` is a person's own
 * profile read by the session's user id (`displayNameFor`) and has no `org_id`.
 */
const EXEMPT = { exempt: ["user_profiles"] };
const rpcArgs = (fn: string) => rec.rpcs().filter((r) => r.fn === fn).map((r) => r.args as Record<string, unknown>);

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("who reaches /api/notes (D-UN4)", () => {
  const FIVE: Array<[string, () => Promise<Response>]> = [
    ["GET /summary", () => call("/summary?kinds=vehicle", "driver")],
    ["GET /", () => call(`/?subjects=vehicle:${TRUCK}`, "driver")],
    ["GET /people", () => call("/people", "driver")],
    ["POST /", () => post("/", "driver", { kind: "vehicle", subjectId: TRUCK, body: "x" })],
    ["POST /:id/pin", () => post(`/${NOTE_A}/pin`, "driver", { pinned: true })],
  ];

  it.each(FIVE)("refuses the driver role %s with 403 forbidden, before any note query", async (_name, send) => {
    seed();
    const res = await send();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(rec.forTable("unit_notes")).toEqual([]);
    expect(rec.rpcs()).toEqual([]);
  });

  /**
   * The notes screen is on for every office role by the catalogue alone (D-UN4): UN9 removed the
   * `startsOnFor: []` it was built dark behind (D-UN14), so no org answer is seeded here — the tests
   * ask the API's own question with an org that has never touched the Permissions page.
   */
  it("lets every office role read, write and pin with no org answer at all — billing reads a dispatcher's note", async () => {
    for (const role of ["admin", "dispatcher", "accountant", "recruiter", "technician"]) {
      seed();
      expect((await call(`/?subjects=vehicle:${TRUCK}`, role)).status, role).toBe(200);
      expect((await post("/", role, { kind: "vehicle", subjectId: TRUCK, body: "Tyre low" })).status, role).toBe(201);
      expect((await post(`/${NOTE_A}/pin`, role, { pinned: true })).status, role).toBe(200);
    }
  });

  it("is no longer dark: every office role reaches the summary without an org switching it on (UN9, D-UN14)", async () => {
    for (const role of ["dispatcher", "accountant", "recruiter", "technician"]) {
      seed({ surfaceRows: [] });
      expect((await call("/summary?kinds=vehicle", role)).status, role).toBe(200);
    }
  });
});

describe("GET /summary", () => {
  it("answers the one jsonb as the contract's camelCase, for the kinds asked, with the session's org", async () => {
    seed();
    const res = await call("/summary?kinds=vehicle,driver", "accountant");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kinds: { vehicle: { [TRUCK]: { count: 3, lastAt: "2026-11-10T15:00:00+00:00" } }, driver: {} },
    });
    expect(rpcArgs("unit_note_summary")).toEqual([{ p_org: ORG, p_kinds: ["vehicle", "driver"] }]);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses an unknown kind with 400 before the RPC", async () => {
    seed();
    expect((await call("/summary?kinds=boat", "dispatcher")).status).toBe(400);
    expect(rpcArgs("unit_note_summary")).toEqual([]);
  });
});

describe("GET / — the drawer, the search and the wall", () => {
  it("maps a unit's notes to the contract, mentions from the body's tokens, and passes the session's org", async () => {
    seed();
    // `kind` is the wall's filter: named units carry their own kind, so it is not passed on.
    const res = await call(`/?subjects=vehicle:${TRUCK}&kind=driver`, "dispatcher");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      notes: [{
        id: NOTE_A, kind: "vehicle", subjectId: TRUCK, subjectLabel: "1042",
        body: `Brakes squeal, <@${MENTIONED}> booked it`, authorId: "u-dispatcher", authorName: "Dana Dispatch",
        pinned: false, createdAt: "2026-11-10T15:00:00.123456+00:00", mentions: [MENTIONED], fuzzy: false,
      }],
      fuzzy: false,
      next: null,
    });
    const [args] = rpcArgs("unit_notes_search");
    expect(args).toMatchObject({ p_org: ORG, p_subjects: [{ kind: "vehicle", id: TRUCK }], p_kinds: null, p_limit: UNIT_NOTE_PAGE_LIMIT });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("with no subjects is the wall: the kind filter, the words, the author, and the picked days as Central instants", async () => {
    seed();
    const res = await call(`/?kind=trailer&q=brake%20pad&author=${MENTIONED}&from=2026-11-01&to=2026-11-10`, "accountant");
    expect(res.status).toBe(200);
    expect(rpcArgs("unit_notes_search")[0]).toMatchObject({
      p_org: ORG, p_subjects: null, p_kinds: ["trailer"], p_q: "brake pad", p_author: MENTIONED,
      // 2026-11-01 00:00 CDT and the first instant of 2026-11-11 CST: a half-open interval on the carrier's day.
      p_from: "2026-11-01T05:00:00.000Z", p_to: "2026-11-11T06:00:00.000Z",
    });
    // The zone read is the org's own row.
    expect(rec.forTable("organizations")[0]!.filters()).toEqual([{ col: "id", val: ORG }]);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("takes a listed note's mentions from unit_note_mentions (the row), not from re-reading the body", async () => {
    const OTHER = "90000000-0000-4000-8000-000000000002";
    seed({ rpc: { unit_notes_search: [searchRow({ mentions: [OTHER] })] } });
    const body = (await (await call(`/?subjects=vehicle:${TRUCK}`, "dispatcher")).json()) as { notes: Array<{ mentions: string[] }> };
    expect(body.notes[0]!.mentions).toEqual([OTHER]);
  });

  it("says the page is close matches when the trigram pass found it", async () => {
    seed({ rpc: { unit_notes_search: [searchRow({ fuzzy: true })] } });
    const body = (await (await call(`/?q=braks`, "dispatcher")).json()) as { fuzzy: boolean; notes: Array<{ fuzzy: boolean }> };
    expect(body.fuzzy).toBe(true);
    expect(body.notes[0]!.fuzzy).toBe(true);
  });

  it("offers the next older page from the last row of a full page, and passes cursors through", async () => {
    const full = Array.from({ length: UNIT_NOTE_PAGE_LIMIT }, (_, i) =>
      searchRow({ id: `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`, created_at: `2026-11-10T15:00:${String(59 - i).padStart(2, "0")}+00:00` }));
    seed({ rpc: { unit_notes_search: full } });
    const body = (await (await call(`/?before=2026-11-11T00:00:00%2B00:00~${NOTE_A}`, "dispatcher")).json()) as { next: string | null };
    expect(body.next).toBe(`2026-11-10T15:00:10+00:00~50000000-0000-4000-8000-000000000049`);
    expect(rpcArgs("unit_notes_search")[0]).toMatchObject({ p_before_at: "2026-11-11T00:00:00+00:00", p_before_id: NOTE_A, p_after_at: null });

    // A refresh asks for newer notes and is never offered an older page.
    seed({ rpc: { unit_notes_search: full } });
    const fresh = (await (await call(`/?after=2026-11-11T00:00:00Z~${NOTE_A}`, "dispatcher")).json()) as { next: string | null };
    expect(fresh.next).toBeNull();
    expect(rpcArgs("unit_notes_search")[0]).toMatchObject({ p_after_at: "2026-11-11T00:00:00Z", p_after_id: NOTE_A, p_before_at: null });
  });

  it("refuses a malformed cursor, and older-and-newer at once, with 400 before the RPC", async () => {
    seed();
    expect((await call(`/?before=yesterday`, "dispatcher")).status).toBe(400);
    expect((await call(`/?before=2026-11-11T00:00:00Z~${NOTE_A}&after=2026-11-11T00:00:00Z~${NOTE_A}`, "dispatcher")).status).toBe(400);
    expect(rpcArgs("unit_notes_search")).toEqual([]);
  });
});

describe("POST / — adding a note", () => {
  it("inserts it org-scoped, trimmed, under the session's name, and audits that it was written — never what it says", async () => {
    seed();
    const res = await post("/", "dispatcher", { kind: "vehicle", subjectId: TRUCK, body: "  Tyre low  " });
    expect(res.status).toBe(201);
    const { note } = (await res.json()) as { note: { subjectLabel: string; kind: string } };
    expect(note).toMatchObject({ kind: "vehicle", subjectLabel: "1042" });
    expect(rec.writtenRows("unit_notes")).toEqual([{
      org_id: ORG, subject_kind: "vehicle", subject_id: TRUCK, body: "Tyre low",
      author_id: "u-dispatcher", author_name: "Dana Dispatch",
    }]);
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit).toMatchObject({ org_id: ORG, action: "notes.added", entity: "unit_notes", entity_id: NOTE_A });
    expect(JSON.stringify(audit)).not.toContain("Tyre");
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses another carrier's truck with a 404 and writes nothing", async () => {
    seed();
    const res = await post("/", "dispatcher", { kind: "vehicle", subjectId: OTHER_TRUCK, body: "hi" });
    expect(res.status).toBe(404);
    expect(rec.writtenRows("unit_notes")).toEqual([]);
    expect(rec.forTable("vehicles")[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
  });

  it("reads the label from the table the kind names — a driver's name", async () => {
    seed();
    const res = await post("/", "dispatcher", { kind: "driver", subjectId: DRIVER, body: "Off Friday" });
    expect(((await res.json()) as { note: { subjectLabel: string } }).note.subjectLabel).toBe("Sam Driver");
    expect(rec.forTable("vehicles")).toEqual([]);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("answers 0592's refusals: no such unit (UN012) and an applicant (UN013) are 404, a non-member mention (UN015) is 422", async () => {
    for (const code of ["UN012", "UN013"]) {
      seed({ insertError: { code, message: "refused" } });
      expect((await post("/", "dispatcher", { kind: "driver", subjectId: DRIVER, body: "x" })).status, code).toBe(404);
    }
    seed({ insertError: { code: "UN015", message: "not a member" } });
    const bad = await post("/", "dispatcher", { kind: "driver", subjectId: DRIVER, body: "x" });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_mention");
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });

  it("refuses a blank note before any query", async () => {
    seed();
    expect((await post("/", "dispatcher", { kind: "vehicle", subjectId: TRUCK, body: "   " })).status).toBe(400);
    expect(rec.forTable("unit_notes")).toEqual([]);
  });
});

describe("POST /:id/pin", () => {
  it("pins through the RPC with the session's org, and audits the unit", async () => {
    seed();
    const res = await post(`/${NOTE_A}/pin`, "technician", { pinned: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pinned: true });
    expect(rpcArgs("set_unit_note_pinned")).toEqual([{ p_org: ORG, p_note: NOTE_A, p_pinned: true }]);
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "notes.pinned", entity_id: NOTE_A });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses another carrier's note with a 404 and never asks the RPC", async () => {
    seed();
    expect((await post(`/${NOTE_THEIRS}/pin`, "dispatcher", { pinned: true })).status).toBe(404);
    expect(rpcArgs("set_unit_note_pinned")).toEqual([]);
  });

  it("answers the RPC's own not-this-carrier's (UN020) as 404, and audits nothing", async () => {
    seed({ rpc: { set_unit_note_pinned: { error: { code: "UN020", message: "unit_note_not_found" } } } });
    expect((await post(`/${NOTE_A}/pin`, "dispatcher", { pinned: true })).status).toBe(404);
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });
});
