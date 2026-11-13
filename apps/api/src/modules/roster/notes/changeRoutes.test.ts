import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * `/api/notes`' v3 writes through the real mount (UNIT-NOTES-PLAN §9): the author edits and removes their
 * own note; anybody else only with `notes.manage_all` (D-UN19), whose answer reaches the database as
 * `p_any`; an edit rings only the people it ADDS; a typed `@1042` becomes the truck's token; a chip is
 * resolved by anybody who reads notes; every act is on the Audit page and none of them carries the words;
 * and every query is the session's org. The SQL is `supabase/tests/unit-notes-v3.test.mjs`'s.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TRUCK = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const TRAILER = "88888888-8888-4999-8aaa-bbbbbbbbbbbb";
const DRIVER = "66666666-8888-4999-8aaa-bbbbbbbbbbbb";
const NOTE = "50000000-0000-4000-8000-00000000000a";
const AUTHOR = "90000000-0000-4000-8000-0000000000a0";
const BILLING = "90000000-0000-4000-8000-000000000001";
const SAFETY = "90000000-0000-4000-8000-000000000002";

const ctx = (userId: string, role: string): AuthContext => ({ userId, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  author: ctx(AUTHOR, "dispatcher"),
  billing: ctx(BILLING, "accountant"),
  admin: ctx("u-admin", "admin"),
  driver: ctx("u-driver", "driver"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/notes${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const patch = (token: string, body: unknown) => call(`/${NOTE}`, token, { method: "PATCH", body: JSON.stringify(body) });
const remove = (token: string) => call(`/${NOTE}`, token, { method: "DELETE" });
const resolve = (token: string, body: unknown) => call(`/${NOTE}/units/resolve`, token, { method: "POST", body: JSON.stringify(body) });

/** The note's body before and after the edit: the read before the edit sees `before`, the read after it `after`. */
function seed(over: { rpc?: Record<string, unknown>; grants?: Record<string, unknown>[]; before?: string; after?: string; trailerNumber?: string } = {}): SupabaseRecorder {
  let reads = 0;
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: [],
      user_surface_access: [],
      org_role_permissions: postgrestFixture((over.grants ?? []).map((g) => ({ org_id: ORG, ...g }))),
      vehicles: postgrestFixture([{ id: TRUCK, org_id: ORG, unit_number: "1042" }]),
      trailers: postgrestFixture([{ id: TRAILER, org_id: ORG, unit_number: over.trailerNumber ?? "5310" }]),
      drivers: postgrestFixture([{ id: DRIVER, org_id: ORG, full_name: "Marcus Hill", status: "active" }]),
      user_profiles: [{ full_name: "Dana Dispatch" }],
      driver_app_features: [],
      unit_notes: (q) => {
        const body = reads++ === 0 ? (over.before ?? `Ask <@${BILLING}>`) : (over.after ?? over.before ?? `Ask <@${BILLING}>`);
        return postgrestFixture([
          { id: NOTE, org_id: ORG, subject_kind: "vehicle", subject_id: TRUCK, body, author_id: AUTHOR, author_name: "Dana Dispatch", pinned: false, created_at: "2026-11-12T15:00:00+00:00", edited_at: reads > 1 ? "2026-11-12T16:00:00+00:00" : null, deleted_at: null },
        ])(q);
      },
      audit_logs: [],
    },
    rpc: (fn: string) => {
      if (over.rpc && fn in over.rpc) return over.rpc[fn];
      if (fn === "edit_unit_note") return { id: NOTE, kind: "vehicle", subject_id: TRUCK, edited_at: "2026-11-12T16:00:00+00:00", author_id: AUTHOR };
      if (fn === "remove_unit_note") return { id: NOTE, kind: "vehicle", subject_id: TRUCK, author_id: AUTHOR };
      if (fn === "resolve_unit_note_unit_mention") return true;
      if (fn === "org_member_directory") return [];
      if (fn === "emit_notification") return "evt-1";
      return null;
    },
  });
  holder.client = rec.client;
  return rec;
}

const EXEMPT = { exempt: ["user_profiles"] };
const rpcArgs = (fn: string) => rec.rpcs().filter((r) => r.fn === fn).map((r) => r.args as Record<string, unknown>);
const audits = () => rec.writtenRows("audit_logs") as Record<string, unknown>[];

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((done) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("PATCH /:id — editing (D-UN15, D-UN19)", () => {
  it("lets the author edit, tells the database it is the author's own (p_any false), audits it without the words", async () => {
    seed({ after: `Ask <@${BILLING}> today` });
    const res = await patch("author", { body: `Ask <@${BILLING}> today` });
    expect(res.status).toBe(200);
    const { note } = (await res.json()) as { note: { body: string; editedAt: string | null } };
    expect(note).toMatchObject({ body: `Ask <@${BILLING}> today`, editedAt: "2026-11-12T16:00:00+00:00" });
    expect(rpcArgs("edit_unit_note")).toEqual([
      { p_org: ORG, p_note: NOTE, p_body: `Ask <@${BILLING}> today`, p_actor: AUTHOR, p_actor_name: "Dana Dispatch", p_any: false },
    ]);
    expect(audits()[0]).toMatchObject({ org_id: ORG, action: "notes.edited", entity: "unit_notes", entity_id: NOTE, meta: { kind: "vehicle", subjectId: TRUCK, byAuthor: true } });
    expect(JSON.stringify(audits())).not.toContain("today");
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("answers somebody else without the permission with 403, and audits nothing (the database's UN025)", async () => {
    seed({ rpc: { edit_unit_note: { error: { code: "UN025", message: "unit_note_not_yours" } } } });
    const res = await patch("billing", { body: "Hijacked" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(rpcArgs("edit_unit_note")[0]).toMatchObject({ p_actor: BILLING, p_any: false });
    expect(audits()).toEqual([]);
  });

  it("hands the admin's permission to the database as p_any, and audits it as not the author's", async () => {
    seed({ rpc: { edit_unit_note: { id: NOTE, kind: "vehicle", subject_id: TRUCK, author_id: AUTHOR } } });
    expect((await patch("admin", { body: "Corrected by the office" })).status).toBe(200);
    expect(rpcArgs("edit_unit_note")[0]).toMatchObject({ p_actor: "u-admin", p_any: true });
    expect(audits()[0]).toMatchObject({ action: "notes.edited", meta: { byAuthor: false } });
  });

  it("reads the carrier's switch: a role the admin turned notes.manage_all on for edits anybody's note", async () => {
    seed({ grants: [{ role: "accountant", permission: "notes.manage_all", allowed: true }] });
    expect((await patch("billing", { body: "Billing fixed the amount" })).status).toBe(200);
    expect(rpcArgs("edit_unit_note")[0]).toMatchObject({ p_actor: BILLING, p_any: true });
    expect(rec.forTable("org_role_permissions")[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
  });

  it("turns a typed @1042 into the truck's token before the save, and leaves @9999 (no such unit) as words", async () => {
    seed();
    await patch("author", { body: "Swap to @1042, not @9999" });
    expect(rpcArgs("edit_unit_note")[0]!.p_body).toBe(`Swap to <#vehicle:${TRUCK}>, not @9999`);
    expect(rec.forTable("vehicles")[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
  });

  it("leaves a number that names a truck AND a trailer as typed — a guess would put the chip on the wrong row", async () => {
    seed({ trailerNumber: "1042" });
    await patch("author", { body: "Swap to @1042" });
    expect(rpcArgs("edit_unit_note")[0]!.p_body).toBe("Swap to @1042");
    seed();
    await patch("author", { body: "Hook @5310" });
    expect(rpcArgs("edit_unit_note")[0]!.p_body).toBe(`Hook <#trailer:${TRAILER}>`);
  });

  it("rings only the people the edit ADDED — never again the one already named, never the author", async () => {
    seed({ before: `Ask <@${BILLING}>`, after: `Ask <@${BILLING}> and <@${SAFETY}> and <@${AUTHOR}>` });
    expect((await patch("author", { body: `Ask <@${BILLING}> and <@${SAFETY}> and <@${AUTHOR}>` })).status).toBe(200);
    const rung = rpcArgs("emit_notification").map((a) => a.p_audience_user_id ?? a.p_user_id ?? a.audience_user_id);
    expect(rpcArgs("emit_notification")).toHaveLength(1);
    expect(JSON.stringify(rpcArgs("emit_notification")[0])).toContain(SAFETY);
    expect(rung).not.toContain(BILLING);
  });

  it("refuses an empty edit with 400 before anything is asked", async () => {
    seed();
    expect((await patch("author", { body: "   " })).status).toBe(400);
    expect(rpcArgs("edit_unit_note")).toEqual([]);
  });

  it("answers a removed or another carrier's note with 404 (the read finds none)", async () => {
    seed();
    rec = createSupabaseRecorder({ tables: { org_role_surface_access: [], user_surface_access: [], unit_notes: postgrestFixture([]) } });
    holder.client = rec.client;
    expect((await patch("author", { body: "x" })).status).toBe(404);
    expect(rec.rpcs().filter((r) => r.fn === "edit_unit_note")).toEqual([]);
  });

  it("refuses the driver role with 403 before any note is read", async () => {
    seed();
    expect((await patch("driver", { body: "x" })).status).toBe(403);
    expect(rec.forTable("unit_notes")).toEqual([]);
  });
});

describe("DELETE /:id — removing (D-UN16, D-UN19)", () => {
  it("lets the author remove their note and audits notes.removed, signed and without the words", async () => {
    seed();
    const res = await remove("author");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(rpcArgs("remove_unit_note")).toEqual([{ p_org: ORG, p_note: NOTE, p_actor: AUTHOR, p_actor_name: "Dana Dispatch", p_any: false }]);
    expect(audits()[0]).toMatchObject({ org_id: ORG, action: "notes.removed", entity_id: NOTE, meta: { kind: "vehicle", subjectId: TRUCK, byAuthor: true } });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("answers somebody else without the permission with 403 (UN025), the admin with p_any", async () => {
    seed({ rpc: { remove_unit_note: { error: { code: "UN025", message: "unit_note_not_yours" } } } });
    expect((await remove("billing")).status).toBe(403);
    expect(audits()).toEqual([]);
    seed();
    expect((await remove("admin")).status).toBe(200);
    expect(rpcArgs("remove_unit_note")[0]).toMatchObject({ p_any: true });
  });

  it("answers a note already removed, or not this carrier's, with 404 (UN020)", async () => {
    seed({ rpc: { remove_unit_note: { error: { code: "UN020", message: "unit_note_not_found" } } } });
    expect((await remove("author")).status).toBe(404);
  });

  it("refuses the driver role with 403 before the database is asked", async () => {
    seed();
    expect((await remove("driver")).status).toBe(403);
    expect(rpcArgs("remove_unit_note")).toEqual([]);
  });
});

describe("POST /:id/units/resolve — the board's chip (D-UN18)", () => {
  it("resolves for anybody who reads notes, signed by the session, and audits it", async () => {
    seed();
    const res = await resolve("billing", { kind: "vehicle", subjectId: TRUCK });
    expect(res.status).toBe(200);
    expect(rpcArgs("resolve_unit_note_unit_mention")).toEqual([
      { p_org: ORG, p_note: NOTE, p_kind: "vehicle", p_subject: TRUCK, p_actor: BILLING, p_actor_name: "Dana Dispatch" },
    ]);
    expect(audits()[0]).toMatchObject({ action: "notes.mention_resolved", entity_id: NOTE, meta: { kind: "vehicle", subjectId: TRUCK } });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("answers a unit the note does not name with 404 (UN020), and audits nothing", async () => {
    seed({ rpc: { resolve_unit_note_unit_mention: { error: { code: "UN020", message: "unit_note_mention_not_found" } } } });
    expect((await resolve("author", { kind: "trailer", subjectId: TRAILER })).status).toBe(404);
    expect(audits()).toEqual([]);
  });

  it("refuses a kind outside the three with 400", async () => {
    seed();
    expect((await resolve("author", { kind: "load", subjectId: TRUCK })).status).toBe(400);
    expect(rpcArgs("resolve_unit_note_unit_mention")).toEqual([]);
  });
});

describe("GET /units — the @ list's trucks, trailers and drivers (D-UN17)", () => {
  it("answers trucks, then trailers, then drivers, each org-scoped, never an applicant", async () => {
    seed();
    const res = await call("/units?q=1", "billing");
    expect(res.status).toBe(200);
    expect(rec.forTable("drivers")[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
    expect(rec.forTable("drivers")[0]!.ops).toContainEqual({ method: "neq", args: ["status", "applicant"] });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("refuses an empty search with 400", async () => {
    seed();
    expect((await call("/units?q=", "billing")).status).toBe(400);
  });
});
