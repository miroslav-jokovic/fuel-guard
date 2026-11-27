import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rolesThatManage, type AuthContext, type CareersPageStatus } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv, type Env } from "../../../env.js";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "../../../lib/stepUpToken.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * AP1 (APPLY-PAGE-PLAN): the careers page card's two doors — who may use them, when a fresh sign-in is asked, what
 * the card is told (the public link, the robot check, which openings are published and why not), and what is saved.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PAGE = "2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ROLES = ["admin", "recruiter", "fleet_manager", "safety_manager", "dispatcher", "auditor", "driver"];
const SECRET = Buffer.alloc(32, 7).toString("base64");

const makeEnv = (extra: Record<string, string> = {}): Env =>
  loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: SECRET, WEB_APP_URL: "https://360.example.test/", ...extra } as NodeJS.ProcessEnv);
let env = makeEnv();

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;
let page: Array<Record<string, unknown>>;

const pay = (max: number | null) => ({ per: "mile", min_cents: 60, max_cents: max });
const OPENINGS = [
  { id: "o-open", status: "open", created_at: "2026-11-01T00:00:00Z", recruiter_id: null },
  { id: "o-nomax", status: "open", created_at: "2026-11-02T00:00:00Z", recruiter_id: null },
  { id: "o-paused", status: "paused", created_at: "2026-11-03T00:00:00Z", recruiter_id: null },
  { id: "o-empty", status: "open", created_at: "2026-11-04T00:00:00Z", recruiter_id: null },
  { id: "o-closed", status: "closed", created_at: "2026-11-05T00:00:00Z", recruiter_id: null },
];
const VERSIONS = [
  // Oldest first on purpose: the newest must be chosen by its version, not by where it sits.
  { id: "v0", opening_id: "o-open", version: 1, title: "Old title", facts: { pay: pay(null) } },
  { id: "v1", opening_id: "o-open", version: 2, title: "Regional dry van", facts: { pay: pay(75) } },
  { id: "v2", opening_id: "o-nomax", version: 1, title: "OTR reefer", facts: { pay: pay(null) } },
  { id: "v3", opening_id: "o-paused", version: 1, title: "Local flatbed", facts: { pay: pay(80) } },
  { id: "v4", opening_id: "o-closed", version: 1, title: "Gone", facts: { pay: pay(80) } },
];

function seed(over: { page?: Record<string, unknown> | null; writeError?: { code: string; message: string } } = {}): SupabaseRecorder {
  page = over.page === null || over.page === undefined ? [] : [{
    id: PAGE, org_id: ORG, handle: "silvicom", enabled: false, accommodation_email: null, accommodation_phone: null, ...over.page,
  }];
  rec = createSupabaseRecorder({
    tables: {
      recruiting_careers_pages: (q: RecordedQuery) => {
        if (q.write) {
          if (over.writeError) return { writeError: over.writeError };
          if (q.write.method === "update") Object.assign(page[0]!, q.write.payload as object);
          if (q.write.method === "insert") page.push({ id: PAGE, ...(q.write.payload as object) });
          return { data: null };
        }
        return postgrestFixture(page)(q);
      },
      recruiting_openings: postgrestFixture(OPENINGS.map((o) => ({ ...o, org_id: ORG }))),
      recruiting_opening_versions: postgrestFixture(VERSIONS.map((v) => ({ ...v, org_id: ORG }))),
      audit_logs: [],
    },
  });
  holder.client = rec.client;
  return rec;
}

const call = (method: string, role: string | null, body?: unknown, stepUp = false) =>
  fetch(`${baseUrl}/api/recruitment/careers-page`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(role ? { Authorization: `Bearer ${role}` } : {}),
      ...(role && stepUp ? { [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, `u-${role}`, ORG)!.token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const status = async () => (await (await call("GET", "admin")).json()) as CareersPageStatus;
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
const SAVE = { handle: "silvicom", enabled: false, accommodationEmail: null, accommodationPhone: null };

async function start(e: Env) {
  if (server) await closeTestServer(server);
  env = e;
  const app = createApp(env);
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    if (!ROLES.includes(t)) throw new Error("bad token");
    return { userId: `u-${t}`, email: `${t}@x.test`, orgId: ORG, role: t } as AuthContext;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}
beforeAll(() => start(makeEnv()));
afterAll(async () => closeTestServer(server));

describe("who may use the careers page card (recruitment manage)", () => {
  it("the roles that manage recruiting may read and save it; the others are refused before anything is read", async () => {
    const managers = new Set<string>(rolesThatManage("recruitment"));
    expect(managers.has("recruiter")).toBe(true);
    expect(managers.has("dispatcher")).toBe(false);
    for (const role of ROLES) {
      seed();
      const manages = managers.has(role);
      expect((await call("GET", role)).status, role).toBe(manages ? 200 : 403);
      expect((await call("PUT", role, SAVE)).status, role).toBe(manages ? 200 : 403);
      if (!manages) expect(rec.forTable("recruiting_careers_pages"), role).toHaveLength(0);
    }
  });

  it("the unauthenticated get 401", async () => {
    seed();
    expect((await call("GET", null)).status).toBe(401);
  });
});

describe("GET — what the card is told", () => {
  it("before a handle is saved: not configured, no link, every query org-scoped", async () => {
    seed();
    const s = await status();
    expect(s).toMatchObject({ configured: false, handle: null, enabled: false, publicUrl: null, accommodationEmail: null, accommodationPhone: null });
    expectOrgScoped(rec, ORG);
  });

  it("a saved page: its link on the web host, with no doubled slash", async () => {
    seed({ page: { enabled: true, accommodation_email: "recruiting@silvicominc.com" } });
    expect(await status()).toMatchObject({
      configured: true, handle: "silvicom", enabled: true, accommodationEmail: "recruiting@silvicominc.com",
      publicUrl: "https://360.example.test/careers/silvicom",
    });
  });

  it("a server that names its careers host links there instead (D-AP9), still with no doubled slash", async () => {
    await start(makeEnv({ CAREERS_URL: "https://careers.example.test/" }));
    try {
      seed({ page: { enabled: true, accommodation_email: "recruiting@silvicominc.com" } });
      expect((await status()).publicUrl).toBe("https://careers.example.test/careers/silvicom");
    } finally {
      await start(makeEnv());
    }
  });

  it("each opening says whether it is published, from its NEWEST version; closed ones are not listed", async () => {
    seed();
    const byId = Object.fromEntries((await status()).openings.map((o) => [o.id, o]));
    expect(Object.keys(byId).sort()).toEqual(["o-empty", "o-nomax", "o-open", "o-paused"]);
    // Version 2 has a top; version 1 did not. The page reads the newest, so it is published.
    expect(byId["o-open"]).toEqual({ id: "o-open", title: "Regional dry van", status: "open", unpublished: null });
    expect(byId["o-nomax"]!.unpublished).toBe("no_pay_top");
    expect(byId["o-paused"]!.unpublished).toBe("not_open");
    expect(byId["o-empty"]).toMatchObject({ title: null, unpublished: "no_version" });
  });

  it("the robot check is ready only when the server holds BOTH of Turnstile's keys; one alone is not ready", async () => {
    seed();
    expect((await status()).robotCheckReady).toBe(false);
    try {
      for (const [keys, ready] of [
        [{ TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret" }, false],
        [{ TURNSTILE_SITE_KEY: "0x4AAAAAAA-site" }, false],
        [{ TURNSTILE_SITE_KEY: "0x4AAAAAAA-site", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret" }, true],
      ] as const) {
        await start(makeEnv(keys));
        seed();
        expect((await status()).robotCheckReady, JSON.stringify(keys)).toBe(ready);
      }
    } finally {
      await start(makeEnv());
    }
  });
});

describe("PUT — what is saved", () => {
  it("a first save while off needs no fresh sign-in; the contact is stored normalised; the audit says it was created", async () => {
    seed();
    const res = await call("PUT", "admin", { ...SAVE, handle: "  Silvicom ", accommodationEmail: " Recruiting@SilvicomInc.com ", accommodationPhone: "(708) 236-5732" });
    expect(res.status).toBe(200);
    expect(rec.writtenRows("recruiting_careers_pages")).toEqual([expect.objectContaining({
      org_id: ORG, handle: "silvicom", enabled: false, accommodation_email: "recruiting@silvicominc.com", accommodation_phone: "+17082365732", updated_by: "u-admin",
    })]);
    expect(auditRows()).toEqual([expect.objectContaining({
      action: "recruitment.careers_page.saved", entity: "recruiting_careers_pages",
      meta: { created: true, handle: { was: null, now: "silvicom" }, enabled: { was: false, now: false } },
    })]);
    expectOrgScoped(rec, ORG);
  });

  it("switching ON asks for a fresh sign-in first, and nothing is read or written", async () => {
    seed({ page: {} });
    const res = await call("PUT", "admin", { ...SAVE, enabled: true, accommodationEmail: "jobs@silvicominc.com" });
    expect(res.status).toBe(403);
    expect((await errorCode(res)).code).toBe("step_up_required");
    expect(rec.forTable("recruiting_careers_pages")).toHaveLength(0);
  });

  it("with a fresh sign-in it switches on, updates the one row, and the audit says what moved", async () => {
    seed({ page: {} });
    const res = await call("PUT", "admin", { ...SAVE, handle: "silvicom-inc", enabled: true, accommodationEmail: "jobs@silvicominc.com" }, true);
    expect(res.status).toBe(200);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ handle: "silvicom-inc", enabled: true, accommodation_email: "jobs@silvicominc.com", accommodation_phone: null });
    expect(auditRows()[0]).toMatchObject({ meta: { created: false, handle: { was: "silvicom", now: "silvicom-inc" }, enabled: { was: false, now: true } } });
    expectOrgScoped(rec, ORG);
  });

  it("refuses, before anything is read: on with no accommodation contact, a handle people cannot type, a bad email or phone, an unknown field", async () => {
    for (const body of [
      { ...SAVE, enabled: true },
      { ...SAVE, handle: "silvicom inc" },
      { ...SAVE, handle: "-silvicom" },
      { ...SAVE, accommodationEmail: "not an email" },
      { ...SAVE, accommodationPhone: "12345" },
      { ...SAVE, org_id: ORG },
    ]) {
      seed({ page: {} });
      const res = await call("PUT", "admin", body, true);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(rec.forTable("recruiting_careers_pages"), JSON.stringify(body)).toHaveLength(0);
    }
  });

  it("a handle another carrier holds is answered by name; any other duplicate is a plain failure", async () => {
    seed({ writeError: { code: "23505", message: 'duplicate key value violates unique constraint "recruiting_careers_pages_handle_key"' } });
    const res = await call("PUT", "admin", SAVE);
    expect(res.status).toBe(409);
    expect((await errorCode(res)).code).toBe("careers_handle_taken");
    expect(auditRows()).toHaveLength(0);
    seed({ writeError: { code: "23505", message: 'duplicate key value violates unique constraint "recruiting_careers_pages_org_id_key"' } });
    expect((await call("PUT", "admin", SAVE)).status).toBe(500);
  });
});

function auditRows() {
  return rec.writtenRows("audit_logs");
}
