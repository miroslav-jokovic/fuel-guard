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
 * The packet is sent for signing from the office, to the applicant's phone (D-AW14, C3s3a; AF5 before).
 *
 * Two halves, as AF4's test has: what the applicant's link REFUSES while the office has not sent it —
 * every mark, with a 409 that says where signing happens — and what the office's Send for signing does:
 * start the link's 72 hours and a fresh unlock count BEFORE minting through 0369's function, email the
 * link and answer WITHOUT it, warn (never refuse) on the federal gates and the road test, audit.
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
  /** The draft's `applying_as`, as the path select hands it back (Q-HM14). */
  applyingAs?: string;
  /** The carrier's own link lifetime (Q-AW41). Absent: no row, the product's defaults. */
  settings?: Record<string, unknown>;
  draftPayload?: Record<string, unknown>;
  /** How many rows the pre-mint UPDATE matched — 0 is an invitation that changed under the office. */
  startMatches?: number;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: (q: RecordedQuery) =>
        over.invitation === null || (q.write && over.startMatches === 0) ? [] : [invitation(over.invitation)],
      recruiting_settings: over.settings ? [over.settings] : [],
      organizations: [{ name: "Silvicom Inc" }],
      drivers: [{ id: DRIVER, org_id: ORG, hire_date: null, date_of_birth: "1980-04-01", cdl_number: "D1", cdl_state: "IL" }],
      driver_authorizations: [],
      qualification_records: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "driver_id") ? (over.kinds ?? []).map((kind) => ({
          driver_id: DRIVER, kind, occurred_on: "2026-09-18",
          // AW7: the driver's row says Illinois, so that is the MVR owed.
          ...(kind === "mvr" ? { jurisdiction: "IL" } : {}),
        })) : [],
      application_drafts: [{ invitation_id: INV, payload: over.draftPayload ?? { first_name: "Susan" }, furthest_section: null, updated_at: "2026-09-20T10:00:00Z", applying_as: over.applyingAs ?? null }],
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
  fetch(`${baseUrl}/api/recruitment/applications/${INV}/send-for-signing`, {
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

  /**
   * ⚠ Q-HM14: a company driver's p31b is a CONFLICT, not a bad request — the same line is theirs to
   * sign if their answer says owner-operator — and it never reaches the transaction.
   */
  it("refuses a company driver's owner-operator line as a conflict, naming why", async () => {
    const rec = seed({ invitation: { signing_opened_at: "2026-09-24T12:00:00Z" }, applyingAs: "company_driver" });
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/mark`, {
      method: "POST",
      body: JSON.stringify({ placement_id: "p31b", signed_name: "Susan Driver", esign_consent: true }),
    });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("packet_mark_not_their_capacity");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("takes the mark once it has been opened", async () => {
    const rec = seed({ invitation: { signing_opened_at: "2026-09-24T12:00:00Z" } });
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/mark`, { method: "POST", body: MARK });
    expect(res.status).toBe(201);
    expect(rec.rpcs().map((r) => r.fn)).toContain("record_packet_mark");
  });
});

describe("the sent link's unlock, over HTTP", () => {
  const SIGN = "f".repeat(43);
  const sent = (failures: number) => seed({
    invitation: {
      sign_token_hash: hashInvitationToken(SIGN), signing_opened_at: "2026-09-24T12:00:00Z",
      sign_link_expires_at: "2099-01-01T00:00:00Z", unlock_failures: failures,
    },
    draftPayload: { first_name: "Susan", date_of_birth: "1980-04-01" },
  });
  const unlock = () => pub(`/${SIGN}/unlock`, { method: "POST", body: JSON.stringify({ date_of_birth: "1999-09-09" }) });

  it("answers a counted wrong date with the tries left", async () => {
    holder.client = sent(1).client;
    const res = await unlock();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { draft: { locked: boolean; attemptsLeft: number } }).draft).toMatchObject({ locked: true, attemptsLeft: 3 });
  });

  /** 410: only the holder of a live link reaches it, so saying it stopped discloses nothing. */
  it("answers the fifth with 410 sign_link_locked", async () => {
    holder.client = sent(4).client;
    const res = await unlock();
    expect(res.status).toBe(410);
    expect(await code(res)).toBe("sign_link_locked");
  });
});

/** Where in the recorded order a query or call landed — the pre-mint UPDATE must precede the mint. */
const at = (rec: SupabaseRecorder, pred: (q: RecordedQuery) => boolean): number => rec.queries.findIndex(pred);
const isStart = (q: RecordedQuery) =>
  q.table === "application_invitations" && q.write !== null
  && JSON.stringify(q.write.payload).includes("sign_link_expires_at");

describe("the office sends it for signing", () => {
  it("extends the invitation by the carrier's own lifetime (Q-AW41)", async () => {
    const rec = seed({ settings: { invite_ttl_days: 5, reminders_enabled: true, reminder_after_hours: 48, updated_at: "2026-09-28T00:00:00Z" } });
    holder.client = rec.client;
    expect((await open()).status).toBe(201);
    const args = rec.rpcs().find((r) => r.fn === "open_packet_signing")!.args as Record<string, unknown>;
    expect(args.p_extend_days).toBe(5);
  });

  /**
   * ⚠ The order is the point: the 72 hours and the zeroed count land BEFORE the link exists, so no
   * failure can leave a live link carrying the previous send's end, or none.
   */
  it("starts the link's 72 hours and a fresh unlock count, before minting", async () => {
    const rec = seed();
    holder.client = rec.client;
    const before = Date.now();
    const res = await open();
    expect(res.status).toBe(201);
    const [start] = rec.writtenRows("application_invitations");
    expect(start!.unlock_failures).toBe(0);
    const end = Date.parse(String(start!.sign_link_expires_at));
    expect(end - before).toBeGreaterThanOrEqual(72 * 3_600_000 - 1);
    expect(end - Date.now()).toBeLessThanOrEqual(72 * 3_600_000);
    expect(at(rec, isStart)).toBeGreaterThanOrEqual(0);
    expect(at(rec, isStart)).toBeLessThan(at(rec, (q) => q.table === "rpc:open_packet_signing"));
    const body = (await res.json()) as { signLinkExpiresAt: string };
    expect(body.signLinkExpiresAt).toBe(start!.sign_link_expires_at);
  });

  it("writes the start only on an approved, live, unfiled invitation", async () => {
    const rec = seed();
    holder.client = rec.client;
    await open();
    const start = rec.queries.find(isStart)!;
    const ops = start.ops.map((o) => `${o.method}:${String(o.args[0])}:${String(o.args[1])}:${String(o.args[2])}`);
    expect(ops).toContain("is:revoked_at:null:undefined");
    expect(ops).toContain("is:submitted_at:null:undefined");
    expect(ops).toContain("not:approved_at:is:null");
    expect(start.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "id", val: INV }]));
  });

  it("emails the sign link it minted, and answers without it", async () => {
    mail.fn.mockClear();
    const rec = seed();
    holder.client = rec.client;
    const res = await open();
    expect(res.status).toBe(201);
    const args = rec.rpcs().find((r) => r.fn === "open_packet_signing")!.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INV, p_extend_days: 14 });
    expect(mail.fn).toHaveBeenCalledTimes(1);
    const sent = (mail.fn.mock.calls[0] as unknown as [unknown, { to: string[]; text: string }])[1];
    expect(sent.to).toEqual(["susan@example.test"]);
    // ⚠ The hash handed to SQL is the hash OF the link emailed — otherwise the link is dead.
    const token = /\/apply\/([A-Za-z0-9_-]+)/.exec(sent.text)![1]!;
    expect(args.p_sign_token_hash).toBe(hashInvitationToken(token));
    expect(sent.text).toContain("72 hours");
    const raw = await res.clone().text();
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("/apply/");
    const body = (await res.json()) as { email: { sent: boolean; email: string }; signingOpenedAt: string; text: { state: string } };
    expect(body.email).toEqual({ sent: true, email: "susan@example.test", reason: null });
    expect(body.signingOpenedAt).toBe("2026-09-24T12:00:00Z");
    expect(body.text.state).toBe("held");
  });

  it("reports an invitation with no address as not emailed, and still sends", async () => {
    mail.fn.mockClear();
    holder.client = seed({ invitation: { email: null } }).client;
    const res = await open();
    expect(res.status).toBe(201);
    expect(mail.fn).not.toHaveBeenCalled();
    expect(((await res.json()) as { email: { reason: string } }).email.reason).toBe("no_address");
  });

  /** D-AF6: it WARNS, it never refuses, and the warning is the checklist's own reading. */
  it("warns about the federal gates and the road test still outstanding, and sends anyway", async () => {
    holder.client = seed({ kinds: ["mvr", "clearinghouse_full"] }).client;
    const res = await open();
    expect(res.status).toBe(201);
    const { warnings } = (await res.json()) as { warnings: string[] };
    expect(warnings).toContain("drug_test");
    expect(warnings).toContain("road_test");
    expect(warnings).not.toContain("mvr");
    expect(warnings).not.toContain("clearinghouse");
  });

  /** ⚠ And the checklist's own read, or the packet row says "waiting on you" after it was sent. */
  it("reads the opening stamp into the checklist it warns from", async () => {
    const rec = seed();
    holder.client = rec.client;
    await open();
    expect(selected(rec, "application_invitations").some((c) => c.includes("signing_opened_at"))).toBe(true);
  });

  it("audits the act without the link or its hash", async () => {
    mail.fn.mockClear();
    const rec = seed();
    holder.client = rec.client;
    await open();
    const sent = (mail.fn.mock.calls[0] as unknown as [unknown, { text: string }])[1];
    const token = /\/apply\/([A-Za-z0-9_-]+)/.exec(sent.text)![1]!;
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.packet_signing_sent", entity_id: INV });
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(hashInvitationToken(token));
  });

  it("refuses an application nobody has approved, from the row, writing nothing", async () => {
    mail.fn.mockClear();
    const rec = seed({ invitation: { approved_at: null } });
    holder.client = rec.client;
    const res = await open();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_approved");
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.writes()).toHaveLength(0);
    expect(mail.fn).not.toHaveBeenCalled();
  });

  it("refuses a revoked invitation and a filed application, writing nothing", async () => {
    const revoked = seed({ invitation: { revoked_at: "2026-09-25T00:00:00Z" } });
    holder.client = revoked.client;
    const r1 = await open();
    expect([r1.status, await code(r1)]).toEqual([409, "invitation_revoked"]);
    expect(revoked.writes()).toHaveLength(0);
    const filed = seed({ invitation: { submitted_at: "2026-09-25T00:00:00Z" } });
    holder.client = filed.client;
    const r2 = await open();
    expect([r2.status, await code(r2)]).toEqual([409, "already_filed"]);
    expect(filed.writes()).toHaveLength(0);
  });

  it("mints nothing when the start matched no row — the invitation changed under the office", async () => {
    mail.fn.mockClear();
    const rec = seed({ startMatches: 0 });
    holder.client = rec.client;
    const res = await open();
    expect([res.status, await code(res)]).toEqual([409, "link_changed"]);
    expect(rec.rpcs()).toHaveLength(0);
    expect(mail.fn).not.toHaveBeenCalled();
  });

  it("still maps the function's own refusal, sending nothing", async () => {
    mail.fn.mockClear();
    const rec = seed({ rpc: { open_packet_signing: { error: { code: "AI006", message: "packet_not_yet_approved" } } } });
    holder.client = rec.client;
    const res = await open();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_approved");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
    expect(mail.fn).not.toHaveBeenCalled();
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed();
    holder.client = rec.client;
    await open();
    expectOrgScoped(rec, ORG);
  });

  it("404s an invitation that is not this org's, sending nothing", async () => {
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

  it("no longer answers the retired open-signing path", async () => {
    const res = await fetch(`${baseUrl}/api/recruitment/applications/${INV}/open-signing`, {
      method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer recruiter" }, body: "{}",
    });
    expect(res.status).toBe(404);
  });
});
