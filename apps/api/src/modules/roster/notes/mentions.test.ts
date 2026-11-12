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
 * Mentions in unit notes (UNIT-NOTES-PLAN D-UN8, step UN3), through the real mount:
 * - the `@` list is the carrier's office members and nobody else;
 * - a mention rings the bell once per note through `notify()` (its dedupe key), never for the author;
 * - the bell names the note, and `GET /:id` turns that id back into the unit the drawer opens on.
 * `routes.test.ts` holds UN2's routes; the gates are the same router's, asserted again here for the
 * two routes UN3 adds.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const TRUCK = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOTE = "50000000-0000-4000-8000-00000000000a";
const NOTE_THEIRS = "50000000-0000-4000-8000-0000000000ff";
const AUTHOR = "90000000-0000-4000-8000-0000000000a0";
const BILLING = "90000000-0000-4000-8000-000000000001";
const SAFETY = "90000000-0000-4000-8000-000000000002";

const ctx = (userId: string, role: string): AuthContext => ({ userId, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  dispatcher: ctx(AUTHOR, "dispatcher"),
  admin: ctx("u-admin", "admin"),
  driver: ctx("u-driver", "driver"),
};

/** The directory as 0393 answers it: two office members, the author, a driver login and a suspended member. */
const DIRECTORY = [
  { user_id: SAFETY, email: "s@x.test", full_name: "Sam Safety", role: "safety_manager", suspended_at: null },
  { user_id: BILLING, email: "b@x.test", full_name: "Bea Billing", role: "accountant", suspended_at: null },
  { user_id: AUTHOR, email: "d@x.test", full_name: "Dana Dispatch", role: "dispatcher", suspended_at: null },
  { user_id: "90000000-0000-4000-8000-0000000000d1", email: "drv@x.test", full_name: "Driver Dan", role: "driver", suspended_at: null },
  { user_id: "90000000-0000-4000-8000-0000000000e1", email: "gone@x.test", full_name: "Gone Gary", role: "dispatcher", suspended_at: "2026-10-01T00:00:00Z" },
];

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/notes${path}`, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown) => call(path, token, { method: "POST", body: JSON.stringify(body) });

function seed(over: { directory?: unknown; emit?: (args: Record<string, unknown>) => unknown } = {}): SupabaseRecorder {
  let n = 0;
  rec = createSupabaseRecorder({
    tables: {
      // The screen is dark (D-UN14); the org has switched it on for dispatchers, as an admin would.
      org_role_surface_access: postgrestFixture([{ org_id: ORG, role: "dispatcher", surface_key: "notes", allowed: true }]),
      user_surface_access: [],
      vehicles: postgrestFixture([{ id: TRUCK, org_id: ORG, unit_number: "1042" }]),
      user_profiles: [{ full_name: "Dana Dispatch" }],
      driver_app_features: [],
      // The insert answers the row it was given, the way PostgREST's `.select()` after an insert does.
      unit_notes: (q) => {
        if (q.write) {
          const row = q.write.payload as Record<string, unknown>;
          return [{ ...row, id: NOTE, pinned: false, created_at: "2026-11-12T15:00:00+00:00" }];
        }
        return postgrestFixture([
          { id: NOTE, org_id: ORG, subject_kind: "vehicle", subject_id: TRUCK, body: `Ask <@${BILLING}>`, author_id: AUTHOR, author_name: "Dana Dispatch", pinned: true, created_at: "2026-11-12T15:00:00+00:00" },
          { id: NOTE_THEIRS, org_id: OTHER_ORG, subject_kind: "vehicle", subject_id: TRUCK, body: "theirs", author_id: null, author_name: "Them", pinned: false, created_at: "2026-11-12T15:00:00+00:00" },
        ])(q);
      },
      audit_logs: [],
    },
    rpc: (fn: string, args: unknown) => {
      if (fn === "org_member_directory") return over.directory ?? DIRECTORY;
      if (fn === "emit_notification") return over.emit ? over.emit(args as Record<string, unknown>) : `evt-${++n}`;
      return null;
    },
  });
  holder.client = rec.client;
  return rec;
}

const EXEMPT = { exempt: ["user_profiles"] };
const rings = () => rec.rpcs().filter((r) => r.fn === "emit_notification").map((r) => r.args as Record<string, unknown>);

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

describe("GET /people — the @ list", () => {
  it("is the carrier's office members, sorted by name: never a driver login, never a suspended member", async () => {
    seed();
    const res = await call("/people", "admin");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      people: [
        { id: BILLING, name: "Bea Billing" },
        { id: AUTHOR, name: "Dana Dispatch" },
        { id: SAFETY, name: "Sam Safety" },
      ],
    });
    expect(rec.rpcs()).toContainEqual({ fn: "org_member_directory", args: { p_org_id: ORG } });
    expectOrgScoped(rec, ORG);
  });

  it("answers a failed directory read as an error, not as nobody", async () => {
    seed({ directory: { error: { message: "down" } } });
    expect((await call("/people", "admin")).status).toBe(500);
  });

  it("refuses the driver role by code before the directory is read", async () => {
    seed();
    const res = await call("/people", "driver");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(rec.rpcs()).toEqual([]);
  });
});

describe("POST / — a mention rings the bell", () => {
  it("rings each person named once, keyed to the note, naming the note and the unit; never the author", async () => {
    seed();
    const body = `<@${BILLING}> and <@${SAFETY}>, the fuel card for this one — <@${BILLING}> again, and me <@${AUTHOR}>`;
    const res = await post("/", "dispatcher", { kind: "vehicle", subjectId: TRUCK, body });
    expect(res.status).toBe(201);
    const sent = rings();
    expect(sent.map((r) => r.p_user).sort()).toEqual([BILLING, SAFETY].sort());
    for (const r of sent) {
      expect(r).toMatchObject({
        p_org: ORG,
        p_category: "unit_note_mention",
        p_title: "Dana Dispatch mentioned you on Truck 1042",
        p_entity_type: "unit_note",
        p_entity_id: NOTE,
        p_dedupe_key: `unit_note_mention:${NOTE}`,
      });
      // Names, not raw ids, in the preview; cut at chat's 80 characters.
      expect(r.p_body).toMatch(/^@Bea Billing and @Sam Safety, the fuel card/);
      expect(String(r.p_body).length).toBeLessThanOrEqual(80);
      expect(String(r.p_body)).not.toContain("<@");
    }
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("rings nobody for a note with no mention, or one that names only its author", async () => {
    seed();
    expect((await post("/", "dispatcher", { kind: "vehicle", subjectId: TRUCK, body: "Tyre low" })).status).toBe(201);
    expect((await post("/", "dispatcher", { kind: "vehicle", subjectId: TRUCK, body: `Reminder for <@${AUTHOR}>` })).status).toBe(201);
    expect(rec.writtenRows("unit_notes")).toHaveLength(2);
    expect(rings()).toEqual([]);
  });

  it("keeps the note when the bell fails: still 201, still audited", async () => {
    seed({ emit: () => ({ error: { message: "notifications down" } }) });
    const res = await post("/", "dispatcher", { kind: "vehicle", subjectId: TRUCK, body: `<@${BILLING}> look` });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("unit_notes")).toHaveLength(1);
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "notes.added" });
  });
});

describe("GET /:id — the bell's note, back to its unit", () => {
  it("answers the note with its unit, org-scoped", async () => {
    seed();
    const res = await call(`/${NOTE}`, "admin");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { note: unknown }).note).toMatchObject({
      id: NOTE, kind: "vehicle", subjectId: TRUCK, subjectLabel: "1042", mentions: [BILLING], pinned: true,
    });
    expectOrgScoped(rec, ORG);
  });

  it("answers another carrier's note, and a non-id, as 404", async () => {
    seed();
    expect((await call(`/${NOTE_THEIRS}`, "admin")).status).toBe(404);
    expect((await call(`/not-a-note`, "admin")).status).toBe(404);
  });

  it("refuses the driver role by code before any note is read", async () => {
    seed();
    const res = await call(`/${NOTE}`, "driver");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(rec.forTable("unit_notes")).toEqual([]);
  });
});
