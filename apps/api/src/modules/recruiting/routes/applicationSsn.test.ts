import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { editsSent } from "../../../testing/officeEdits.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { open, seal, secretAad } from "../../../lib/secretBox.js";

/**
 * The office's two acts on an applicant's SSN before signing (Q-AM17; `applicantSsn.ts`).
 *
 * Pinned: a corrector of any role replaces it, sealed, and the driver's 3.1 row records only THAT it
 * changed (withheld, 0586); the replace is closed once signing starts; reading all nine digits is
 * "See the full SSN"'s — the safety manager and the admin by default, never the recruiter, and a carrier
 * may switch it either way — and every read is audited without the number; the read is never cached.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: KEY } as NodeJS.ProcessEnv);
const SEALED = seal(ENV, "123456789", secretAad(ORG, "driver_ssn"));

const seed = (over: { marks?: number; submitted?: string | null; ssn?: Record<string, unknown> | null; grants?: unknown[]; replaced?: unknown } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{ id: INV, org_id: ORG, driver_id: DRIVER, submitted_at: over.submitted ?? null }],
      application_packet_marks: { data: [], count: over.marks ?? 0 },
      application_ssns: over.ssn === null ? [] : [{ ssn_last4: "6789", ssn_sealed: SEALED, entered_by: "applicant", ...over.ssn }],
      application_edits: [],
      audit_logs: [],
      org_role_permissions: (over.grants ?? []) as never,
    },
    rpc: { correct_applicant_ssn: over.replaced ?? null },
  });

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(
  ["recruiter", "safety_manager", "admin", "auditor"].map((r) => [r, ctx(r)]),
);

let server: Server;
let baseUrl: string;
const call = (method: "GET" | "POST", token: string, body?: unknown) =>
  fetch(`${baseUrl}/api/recruitment/applications/${INV}/ssn`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code ?? "";

beforeAll(async () => {
  const app = createApp(ENV);
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

describe("replacing the SSN", () => {
  it("lets a recruiter replace it, sealed, and shows the driver only that it changed", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("POST", "recruiter", { ssn: "987-65-4321" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, last4: "4321" });
    const args = rec.rpcs().find((r) => r.fn === "correct_applicant_ssn")!.args as Record<string, unknown>;
    // `correct_applicant_ssn` always enters it as the office's (0593); the editor is the recruiter.
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INV, p_driver: DRIVER, p_last4: "4321", p_edited_by: "u-recruiter" });
    expect(open(ENV, String(args.p_sealed), secretAad(ORG, "driver_ssn"))).toBe("987654321");
    const rows = editsSent(rec);
    expect(rows).toEqual([expect.objectContaining({ path: ["ssn"], before: null, after: null, withheld: true })]);
    // Neither the old nor the new number reaches the edit row or the audit row.
    expect(JSON.stringify([rows, rec.writtenRows("audit_logs")])).not.toMatch(/987654321|4321|123456789/);
    expectOrgScoped(rec, ORG);
  });

  it("is closed once the driver has started signing, and writes nothing", async () => {
    const rec = seed({ marks: 1 });
    holder.client = rec.client;
    const res = await call("POST", "recruiter", { ssn: "987654321" });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
  });

  it("Q-AM14: keeps the driver's number when the record of the replacement is refused, and says so", async () => {
    const rec = seed({ replaced: { error: { code: "AE001", message: "application_edits_invalid" } } });
    holder.client = rec.client;
    const res = await call("POST", "recruiter", { ssn: "987654321" });
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("edit_not_recorded");
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });

  it("refuses a role that does not manage recruitment", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await call("POST", "auditor", { ssn: "987654321" })).status).toBe(403);
    expect(rec.rpcs()).toEqual([]);
  });
});

describe("reading all nine digits (\"See the full SSN\")", () => {
  it("answers the safety manager and the admin, uncached, and audits the read without the number", async () => {
    for (const role of ["safety_manager", "admin"]) {
      const rec = seed();
      holder.client = rec.client;
      const res = await call("GET", role);
      expect(res.status, role).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ssn: "123456789", last4: "6789" });
      const audit = rec.writtenRows("audit_logs");
      expect(audit).toEqual([expect.objectContaining({ action: "application.ssn_viewed", actor_id: `u-${role}` })]);
      expect(JSON.stringify(audit)).not.toContain("123456789");
    }
  });

  it("refuses the recruiter by default, and reads nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("GET", "recruiter");
    expect(res.status).toBe(403);
    expect(rec.forTable("application_ssns")).toEqual([]);
  });

  it("follows the carrier's switch: on for a recruiter, off for the safety manager", async () => {
    const grants = [
      { role: "recruiter", permission: "recruitment.full_ssn", allowed: true },
      { role: "safety_manager", permission: "recruitment.full_ssn", allowed: false },
    ];
    const rec = seed({ grants });
    holder.client = rec.client;
    expect((await call("GET", "recruiter")).status).toBe(200);
    holder.client = seed({ grants }).client;
    expect((await call("GET", "safety_manager")).status).toBe(403);
  });

  it("answers null when the number was kept as its last four only, or none was given", async () => {
    holder.client = seed({ ssn: { ssn_sealed: null } }).client;
    expect(await (await call("GET", "admin")).json()).toEqual({ ssn: null, last4: "6789" });
    holder.client = seed({ ssn: null }).client;
    expect(await (await call("GET", "admin")).json()).toEqual({ ssn: null, last4: null });
  });
});
