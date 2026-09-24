import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * The packet opens only in the office (AF5, D-AF3, D-AF6).
 *
 * Two halves, as AF4's test has: what the applicant's link REFUSES while the office has not opened
 * signing — every mark, with a 409 that says where signing happens — and what the office's Open
 * signing does: mint through 0369's function, hand the sign link back on screen and NOWHERE else,
 * warn (never refuse) on the federal gates and the road test, audit.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
const mail = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../../lib/mailer.js", () => ({ sendEmail: mail.fn }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const TOKEN = "e".repeat(43);

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER, email: "susan@example.test",
  token_hash: hashInvitationToken(TOKEN), sign_token_hash: null,
  expires_at: "2099-01-01T00:00:00Z", revoked_at: null, created_at: "2026-09-20T00:00:00Z",
  consented_at: "2026-09-20T09:00:00Z", releases_completed_at: "2026-09-20T09:30:00Z",
  application_sent_at: "2026-09-21T09:00:00Z", review_requested_at: "2026-09-22T09:00:00Z",
  approved_at: "2026-09-23T09:00:00Z", signing_opened_at: null, submitted_at: null,
  ...over,
});

/** ⚠ Function fixtures for the tables read by key — the recorder does not filter (`supabaseRecorder`). */
const seed = (over: {
  invitation?: Record<string, unknown> | null;
  kinds?: string[];
  rpc?: Record<string, unknown>;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [invitation(over.invitation)],
      organizations: [{ name: "Silvicom Inc" }],
      drivers: [{ id: DRIVER, org_id: ORG, hire_date: null, date_of_birth: "1980-04-01", cdl_number: "D1", cdl_state: "IL" }],
      driver_authorizations: [],
      qualification_records: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "driver_id") ? (over.kinds ?? []).map((kind) => ({ kind })) : [],
      application_drafts: [{ invitation_id: INV, payload: { first_name: "Susan" }, furthest_section: null, updated_at: "2026-09-20T10:00:00Z" }],
      application_packet_marks: [],
      driver_employment_history: [],
      employer_inquiries: [],
      audit_logs: [],
    },
    rpc: {
      open_packet_signing: "2026-09-24T12:00:00Z",
      record_packet_mark: { mark_id: "m-1", signed_count: 1, complete: false },
      ...over.rpc,
    },
  });

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor") };

let server: Server;
let baseUrl: string;
let seq = 0;

const pub = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(seq++ % 250) + 1}` },
  });

const open = (token: string | null = "recruiter") =>
  fetch(`${baseUrl}/api/recruitment/applications/${INV}/open-signing`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: "{}",
  });

const code = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code ?? "";

/** Every column list PostgREST was asked for on this table. */
const selected = (rec: SupabaseRecorder, table: string): string[] =>
  rec.forTable(table).map((q) => String(q.ops.find((o) => o.method === "select")?.args[0] ?? ""));

const MARK = JSON.stringify({ placement_id: "p03", signed_name: "Susan Driver", esign_consent: true });

beforeAll(async () => {
  const app = createApp(loadEnv({
    NODE_ENV: "test", WEB_APP_URL: "https://app.test", MAIL_PROVIDER: "brevo",
  } as unknown as NodeJS.ProcessEnv));
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

describe("the applicant's link before the office opens signing", () => {
  /** ⚠ Approved is not enough since 0369: the driver meets this from home, and it is "not yet". */
  it("refuses every mark as a conflict, and reaches no transaction", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/mark`, { method: "POST", body: MARK });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("packet_not_opened");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("tells the page whether signing has been opened", async () => {
    holder.client = seed().client;
    const closed = (await (await pub(`/${TOKEN}`)).json()) as { phases: { signingOpenedAt: string | null } };
    expect(closed.phases.signingOpenedAt).toBeNull();
    holder.client = seed({ invitation: { signing_opened_at: "2026-09-24T12:00:00Z" } }).client;
    const opened = (await (await pub(`/${TOKEN}`)).json()) as { phases: { signingOpenedAt: string | null } };
    expect(opened.phases.signingOpenedAt).toBe("2026-09-24T12:00:00Z");
  });

  /**
   * ⚠ The recorder hands back whole rows whatever was selected, so only this sees an unselected
   * column — and unselected, `signing_opened_at` reads `undefined`, which refuses EVERY mark on every
   * link with nothing erroring anywhere.
   */
  it("asks PostgREST for the opening stamp when it resolves the link", async () => {
    const rec = seed({ invitation: { signing_opened_at: "2026-09-24T12:00:00Z" } });
    holder.client = rec.client;
    await pub(`/${TOKEN}/mark`, { method: "POST", body: MARK });
    expect(selected(rec, "application_invitations").some((c) => c.includes("signing_opened_at"))).toBe(true);
  });

  it("takes the mark once it has been opened", async () => {
    const rec = seed({ invitation: { signing_opened_at: "2026-09-24T12:00:00Z" } });
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/mark`, { method: "POST", body: MARK });
    expect(res.status).toBe(201);
    expect(rec.rpcs().map((r) => r.fn)).toContain("record_packet_mark");
  });
});

describe("the office opens signing", () => {
  it("mints the sign link through 0369's function and hands it back on screen", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await open();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { link: string; signingOpenedAt: string };
    const args = rec.rpcs().find((r) => r.fn === "open_packet_signing")!.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INV, p_extend_days: 14 });
    // ⚠ The hash handed to SQL is the hash OF the link handed back — otherwise the link is dead.
    const token = body.link.split("/apply/")[1]!;
    expect(body.link.startsWith("https://app.test/apply/")).toBe(true);
    expect(args.p_sign_token_hash).toBe(hashInvitationToken(token));
    expect(body.signingOpenedAt).toBe("2026-09-24T12:00:00Z");
  });

  /**
   * ⚠ D-AF3. The one office act that sends nothing: a sign link emailed from here would let the
   * packet be signed from anywhere the moment it was opened.
   */
  it("emails nothing, and writes no sign token outside the function", async () => {
    mail.fn.mockClear();
    const rec = seed();
    holder.client = rec.client;
    await open();
    expect(mail.fn).not.toHaveBeenCalled();
    expect(rec.writes().filter((w) => w.table === "application_invitations")).toHaveLength(0);
  });

  /** D-AF6: it WARNS, it never refuses, and the warning is the checklist's own reading. */
  it("warns about the federal gates and the road test still outstanding, and opens anyway", async () => {
    holder.client = seed({ kinds: ["mvr", "clearinghouse_full"] }).client;
    const res = await open();
    expect(res.status).toBe(201);
    const { warnings } = (await res.json()) as { warnings: string[] };
    expect(warnings).toContain("drug_test");
    expect(warnings).toContain("road_test");
    expect(warnings).not.toContain("mvr");
    expect(warnings).not.toContain("clearinghouse");
  });

  /** ⚠ And the checklist's own read, or the packet row says "waiting on you" after it was opened. */
  it("reads the opening stamp into the checklist it warns from", async () => {
    const rec = seed();
    holder.client = rec.client;
    await open();
    expect(selected(rec, "application_invitations").some((c) => c.includes("signing_opened_at"))).toBe(true);
  });

  it("audits the act without the link or its hash", async () => {
    const rec = seed();
    holder.client = rec.client;
    const body = (await (await open()).json()) as { link: string };
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.packet_signing_opened", entity_id: INV });
    const token = body.link.split("/apply/")[1]!;
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(hashInvitationToken(token));
  });

  it("refuses an application nobody has approved, as a conflict", async () => {
    const rec = seed({ rpc: { open_packet_signing: { error: { code: "AI006", message: "packet_not_yet_approved" } } } });
    holder.client = rec.client;
    const res = await open();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_approved");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses a filed application, which never signs again", async () => {
    holder.client = seed({ rpc: { open_packet_signing: { error: { code: "AI003", message: "application_already_submitted" } } } }).client;
    const res = await open();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("already_filed");
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed();
    holder.client = rec.client;
    await open();
    expectOrgScoped(rec, ORG);
  });

  it("404s an invitation that is not this org's, opening nothing", async () => {
    const rec = seed({ invitation: null });
    holder.client = rec.client;
    expect((await open()).status).toBe(404);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a reader and the unauthenticated", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await open("auditor")).status).toBe(403);
    expect((await open(null)).status).toBe(401);
    expect(rec.rpcs()).toHaveLength(0);
  });
});
