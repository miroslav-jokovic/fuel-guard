import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Who a finding can be assigned to (Q-FUI15, ruled 2026-09-06).
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * P3 shipped `?owner=me`, which needs nobody's list. A picker needs names, and the only endpoint that
 * had them — `GET /api/members` — is `requireRole("admin")`. Four of the six roles that can READ this
 * ledger (dispatcher, safety_manager, auditor, accountant) would have opened an empty menu.
 *
 * ── AND WHY IT IS NOT A DIRECTORY ───────────────────────────────────────────────────────────────
 * The ruling took something narrower than the plan's recommended names-only org directory: this
 * answers only *who could be assigned a finding in this section*, and the answer is the same
 * derivation that decides who may CLOSE one. The tests below are mostly about who is absent.
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);

const as = (role: AuthContext["role"]): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

/**
 * The org as production actually holds it, measured 2026-09-06: four admins of whom ONE has never set
 * a profile name, two dispatchers, one safety manager, one technician — and no `fleet_manager` at all.
 * The unnamed admin is in the fixture on purpose; see the last test.
 */
const DIRECTORY = [
  { user_id: "u-1", email: "one@x.test", full_name: "Ana Ruiz", role: "admin", joined_at: "2026-01-01" },
  { user_id: "u-2", email: "two@x.test", full_name: null, role: "admin", joined_at: "2026-01-02" },
  { user_id: "u-3", email: "three@x.test", full_name: "Dana Cole", role: "safety_manager", joined_at: "2026-01-03" },
  { user_id: "u-4", email: "four@x.test", full_name: "E Vance", role: "dispatcher", joined_at: "2026-01-04" },
  { user_id: "u-5", email: "five@x.test", full_name: "Fen Ito", role: "driver", joined_at: "2026-01-05" },
  { user_id: "u-6", email: "six@x.test", full_name: "Gus Roy", role: "accountant", joined_at: "2026-01-06" },
];

let server: Server;
let baseUrl = "";
let auth: AuthContext = as("admin");

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return auth;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  auth = as("admin");
  holder.rec = createSupabaseRecorder({ tables: {}, rpc: { org_member_directory: DIRECTORY } });
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });
type Assignee = { id: string; name: string | null; role: string };
const assignees = async (path: string): Promise<Assignee[]> =>
  ((await (await get(path)).json()) as { assignees: Assignee[] }).assignees;

describe("who a finding can be assigned to", () => {
  it("offers only the roles that manage the finding's own section", async () => {
    const fuel = await assignees("/api/fueling/exceptions/assignees?section=fuel");
    // admin manages fuel; dispatcher, accountant and safety_manager hold `fuel: "view"` and cannot
    // close one, so offering them would produce a stuck finding.
    expect(fuel.map((a) => a.role)).toEqual(["admin", "admin"]);
  });

  // The whole reason Q-FUI4 could not take its recorded fallback: the safety manager works theft
  // cases and would have been excluded by a uniform `rolesThatManage("fuel")` gate.
  it("adds the safety manager for a safety finding, and only there", async () => {
    const safety = await assignees("/api/fueling/exceptions/assignees?section=safety");
    expect(safety.map((a) => a.role)).toContain("safety_manager");
    const fuel = await assignees("/api/fueling/exceptions/assignees?section=fuel");
    expect(fuel.map((a) => a.role)).not.toContain("safety_manager");
  });

  it("never offers a driver, and nothing anywhere says 'driver'", async () => {
    for (const section of ["fuel", "safety"]) {
      const list = await assignees(`/api/fueling/exceptions/assignees?section=${section}`);
      expect(list.map((a) => a.role)).not.toContain("driver");
    }
  });

  // No email, by omission rather than redaction — the shape Q-SAM7 chose for `feed-pulse`. A field
  // added to `org_member_directory()` later stays out until somebody adds it here on purpose.
  it("carries id, name and role and nothing else — no email reaches the wire", async () => {
    const res = await get("/api/fueling/exceptions/assignees?section=fuel");
    const body = await res.text();
    expect(body).not.toContain("@x.test");
    const list = (JSON.parse(body) as { assignees: Assignee[] }).assignees;
    for (const a of list) expect(Object.keys(a).sort()).toEqual(["id", "name", "role"]);
  });

  it("refuses a section the inbox holds no findings for", async () => {
    // `billing` is a real section and not one any finding kind maps to, so it must not be usable to
    // enumerate that section's members.
    expect((await get("/api/fueling/exceptions/assignees?section=billing")).status).toBe(400);
    expect((await get("/api/fueling/exceptions/assignees?section=")).status).toBe(400);
  });

  it("refuses a caller who cannot see findings in that section", async () => {
    auth = as("recruiter"); // `fuel: "none"`, `safety: "none"`
    expect((await get("/api/fueling/exceptions/assignees?section=fuel")).status).toBe(403);
    auth = as("dispatcher"); // `fuel: "view"` — may see the ledger, so may see who works it
    expect((await get("/api/fueling/exceptions/assignees?section=fuel")).status).toBe(200);
  });

  // Measured: one of this carrier's four admins has never set a profile name. The honest answer is a
  // null the caller labels, not a fallback to the address this route refuses to carry.
  it("reports an unnamed member as null rather than falling back to their email", async () => {
    const fuel = await assignees("/api/fueling/exceptions/assignees?section=fuel");
    expect(fuel).toContainEqual({ id: "u-2", name: null, role: "admin" });
  });
});
