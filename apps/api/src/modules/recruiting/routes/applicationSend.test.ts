import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SMS_CONSENT, type AuthContext } from "@silvicom/shared";
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
 * The permissions visit ends, and the office sends the application (AF4, D-AF5, D-AF7).
 *
 * Two halves: what the applicant's link REFUSES until the form is sent — the draft, the hand-over and
 * the application's two documents — and what the office's Send does: rotate through 0365's function,
 * hand the link back on screen, warn (never refuse) on outstanding screening, audit, email.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
const mail = vi.hoisted(() => ({
  fn: vi.fn(async (_env: unknown, _msg: { to: string[]; text: string }) => ({ ok: true })),
}));
vi.mock("../../../lib/mailer.js", () => ({ sendEmail: mail.fn }));
const sms = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../../lib/sms.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/sms.js")>()),
  sendSms: sms.fn,
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const TOKEN = "d".repeat(43);

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER, email: "susan@example.test",
  token_hash: hashInvitationToken(TOKEN), expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
  created_at: "2026-09-20T00:00:00Z",
  consented_at: "2026-09-20T09:00:00Z", releases_completed_at: "2026-09-20T09:30:00Z",
  application_sent_at: null, review_requested_at: null, approved_at: null, submitted_at: null,
  ...over,
});

/** ⚠ Function fixtures for the tables read by key — the recorder does not filter (`supabaseRecorder`). */
const seed = (over: {
  invitation?: Record<string, unknown> | null;
  kinds?: string[];
  rpc?: Record<string, unknown>;
  /** D-SMS7: a live consent to be texted, as `sendApplicationSms` reads one. */
  consents?: Record<string, unknown>[];
  /** The carrier's own link lifetime (Q-AW41). Absent: no row, the product's defaults. */
  settings?: Record<string, unknown>;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      sms_consents: over.consents ?? [],
      recruiting_settings: over.settings ? [over.settings] : [],
      sms_outbox: (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: "o-1" }] : []),
      application_invitations: over.invitation === null ? [] : [invitation(over.invitation)],
      organizations: [{ name: "Silvicom Inc" }],
      drivers: [{ id: DRIVER, org_id: ORG, hire_date: null, date_of_birth: "1980-04-01", cdl_number: "D1", cdl_state: "IL" }],
      driver_authorizations: [],
      qualification_records: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "driver_id") ? (over.kinds ?? []).map((kind) => ({
          driver_id: DRIVER, kind, occurred_on: "2026-09-18",
          // AW7: the driver's row says Illinois, so that is the MVR owed.
          ...(kind === "mvr" ? { jurisdiction: "IL" } : {}),
        })) : [],
      application_drafts: [{ invitation_id: INV, payload: { first_name: "Susan" }, furthest_section: null, updated_at: "2026-09-20T10:00:00Z" }],
      application_packet_marks: [],
      driver_employment_history: [],
      employer_inquiries: [],
      audit_logs: [],
    },
    rpc: {
      send_application_invitation: "2026-09-24T12:00:00Z",
      rotate_invitation_sms_token: true,
      save_application_draft: { draft_id: "d-1", updated_at: "2026-09-24T12:05:00Z" },
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
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${(seq++ % 250) + 1}` },
  });

const send = (token: string | null = "recruiter") =>
  fetch(`${baseUrl}/api/recruitment/applications/${INV}/send-application`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: "{}",
  });

const code = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code ?? "";

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

describe("the applicant's link before the application is sent", () => {
  it("refuses a draft save, and writes nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/draft`, { method: "PUT", body: JSON.stringify({ payload: { first_name: "S" }, section: null, revision: 0 }) });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_sent");
    expect(rec.rpcs()).toHaveLength(0);
  });

  /** ⚠ AF3's identity step leaves a draft behind — so "is there a draft" cannot be the gate. */
  it("refuses the hand-over although a draft exists", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/review`, { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_sent");
    expect(rec.writes()).toHaveLength(0);
  });

  /**
   * ⚠ The medical card moved to Part 1 on 2026-09-26 (D-AW4, APPLICATION-FLOW-V2 C2): Part 1 cannot
   * finish without it or "I don't have one yet", so it is admitted before the form is sent, like the
   * licence. The Social Security card still waits for the application.
   */
  it("refuses the Social Security card, and admits the licence and the medical card", async () => {
    holder.client = seed().client;
    const res = await pub(`/${TOKEN}/capture`, { method: "POST", body: JSON.stringify({ slot: "ssn_card", content_type: "image/jpeg" }) });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_sent");
    for (const slot of ["cdl_front", "medical_card"]) {
      holder.client = seed().client;
      const admitted = await pub(`/${TOKEN}/capture`, { method: "POST", body: JSON.stringify({ slot, content_type: "image/jpeg" }) });
      expect(await code(admitted), slot).not.toBe("application_not_sent");
    }
  });

  it("tells the page when the form has been sent", async () => {
    holder.client = seed({ invitation: { application_sent_at: "2026-09-24T12:00:00Z" } }).client;
    const body = (await (await pub(`/${TOKEN}`)).json()) as { phases: { applicationSentAt: string | null } };
    expect(body.phases.applicationSentAt).toBe("2026-09-24T12:00:00Z");
  });

  it("saves the draft once the form has been sent", async () => {
    holder.client = seed({ invitation: { application_sent_at: "2026-09-24T12:00:00Z" } }).client;
    const res = await pub(`/${TOKEN}/draft`, { method: "PUT", body: JSON.stringify({ payload: { first_name: "S" }, section: null, revision: 0 }) });
    expect(res.status).toBe(200);
  });
});

describe("the office sends the application", () => {
  it("rotates the link through 0365's function and hands the new one back on screen", async () => {
    mail.fn.mockClear();
    const rec = seed();
    holder.client = rec.client;
    const res = await send();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { link: string; applicationSentAt: string; delivery: { sent: boolean } };
    const call = rec.rpcs().find((r) => r.fn === "send_application_invitation")!;
    const args = call.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INV, p_extend_days: 14 });
    // ⚠ The hash handed to SQL is the hash OF the link handed back — otherwise the link is dead.
    const token = body.link.split("/apply/")[1]!;
    expect(body.link.startsWith("https://app.test/apply/")).toBe(true);
    expect(args.p_token_hash).toBe(hashInvitationToken(token));
    expect(body.applicationSentAt).toBe("2026-09-24T12:00:00Z");
    expect(body.delivery.sent).toBe(true);
  });

  it("extends the link by the carrier's own lifetime, and the email promises that many days (Q-AW41)", async () => {
    mail.fn.mockClear();
    const rec = seed({ settings: { invite_ttl_days: 5, reminders_enabled: true, reminder_after_hours: 48, updated_at: "2026-09-28T00:00:00Z" } });
    holder.client = rec.client;
    expect((await send()).status).toBe(201);
    const args = rec.rpcs().find((r) => r.fn === "send_application_invitation")!.args as Record<string, unknown>;
    expect(args.p_extend_days).toBe(5);
    expect(mail.fn.mock.calls[0]![1].text).toContain("stops working in 5 days");
  });

  it("emails the new link, and tells the applicant the old one is dead", async () => {
    mail.fn.mockClear();
    holder.client = seed().client;
    const body = (await (await send()).json()) as { link: string };
    const sent = mail.fn.mock.calls[0]![1];
    expect(sent.to).toEqual(["susan@example.test"]);
    expect(sent.text).toContain(body.link);
    expect(sent.text).toContain("no longer works");
  });

  /** D-AF5: it WARNS, it never refuses, and the warning is the checklist's own reading. */
  it("warns about the screening still outstanding, and sends anyway", async () => {
    holder.client = seed({ kinds: ["mvr", "drug_test"] }).client;
    const res = await send();
    expect(res.status).toBe(201);
    // §7: the medical certificate is screening now (Part 1 brings the card), so Send names it too.
    expect(((await res.json()) as { warnings: string[] }).warnings).toEqual(["psp", "clearinghouse", "medical_certificate"]);
  });

  it("warns about nothing once screening is done", async () => {
    holder.client = seed({ kinds: ["mvr", "drug_test", "clearinghouse_full", "psp_report", "medical_registry_verification"] }).client;
    expect(((await (await send()).json()) as { warnings: string[] }).warnings).toEqual([]);
  });

  it("audits the act without the link or its hash", async () => {
    const rec = seed();
    holder.client = rec.client;
    const body = (await (await send()).json()) as { link: string };
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.application_sent", entity_id: INV });
    const token = body.link.split("/apply/")[1]!;
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(hashInvitationToken(token));
  });

  it("refuses before the permissions are signed, as a conflict", async () => {
    const rec = seed({ rpc: { send_application_invitation: { error: { code: "AI005", message: "releases_not_complete" } } } });
    holder.client = rec.client;
    const res = await send();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("permissions_incomplete");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed();
    holder.client = rec.client;
    await send();
    // `organizations` is read by its own id — the caller's org — for the carrier's name in the email.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("404s an invitation that is not this org's, sending nothing", async () => {
    mail.fn.mockClear();
    const rec = seed({ invitation: null });
    holder.client = rec.client;
    expect((await send()).status).toBe(404);
    expect(rec.rpcs()).toHaveLength(0);
    expect(mail.fn).not.toHaveBeenCalled();
  });

  it("refuses a reader and the unauthenticated", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await send("auditor")).status).toBe(403);
    expect((await send(null)).status).toBe(401);
    expect(rec.rpcs()).toHaveLength(0);
  });
});

/**
 * D-SMS7: the link goes by text too, to an applicant who agreed on their waiting screen — and a text
 * that is refused or waiting never costs them the email or the on-screen link. Since Q-AW29 (0378) the
 * text carries a link of its OWN, minted on the invitation's text token, and after hours it waits in
 * the outbox for the applicant's morning rather than being dropped.
 */
describe("and texts it, when the applicant agreed", () => {
  type Sent = { link: string; text: { sent: boolean; reason: string | null } };
  const publish = () => vi.spyOn(SMS_CONSENT, "version", "get").mockReturnValue("v1");
  const LIVE = [{ id: "c-1", phone: "+17082365732", driver_id: DRIVER }];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sms.fn.mockReset();
    mail.fn.mockClear();
  });

  it("texts the new link at a civil hour, and emails it as well", async () => {
    publish();
    // 16:00 Eastern, 10:00 Hawaii — civil everywhere.
    vi.useFakeTimers({ now: new Date("2026-09-25T20:00:00Z"), toFake: ["Date"] });
    sms.fn.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-1" });
    const rec = seed({ consents: LIVE });
    holder.client = rec.client;
    const body = (await (await send()).json()) as Sent;

    expect(body.text).toEqual({ sent: true, reason: null });
    expect(sms.fn.mock.calls[0]![1]).toMatchObject({ to: "+17082365732" });
    // Its own link, not the one on screen and in the email: a later text rotates only its own token.
    const texted = String(sms.fn.mock.calls[0]![1].body).match(/\/apply\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    expect(texted).not.toBe("");
    expect(body.link).not.toContain(texted);
    const rotation = rec.rpcs().find((r) => r.fn === "rotate_invitation_sms_token")!.args as Record<string, unknown>;
    expect(rotation).toMatchObject({ p_org: ORG, p_invitation: INV, p_token_hash: hashInvitationToken(texted) });
    expect(mail.fn).toHaveBeenCalledTimes(1);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  /** Q-AW29: after hours the text WAITS — it used to be dropped here, with nothing to retry it. */
  it("queues a text after hours for the applicant's morning, and still emails and shows the link", async () => {
    publish();
    // 03:00 Eastern.
    vi.useFakeTimers({ now: new Date("2026-09-25T07:00:00Z"), toFake: ["Date"] });
    const rec = seed({ consents: LIVE });
    holder.client = rec.client;
    const body = (await (await send()).json()) as Sent;

    expect(body.text).toEqual({ sent: false, reason: "queued" });
    expect(rec.writtenRows("sms_outbox")[0]).toMatchObject({
      status: "queued", template: "application_sent", reason: "application_sent", invitation_id: INV, params: {},
    });
    // No link minted yet: that happens when the drain sends it.
    expect(rec.rpcs().some((r) => r.fn === "rotate_invitation_sms_token")).toBe(false);
    expect(sms.fn).not.toHaveBeenCalled();
    expect(mail.fn).toHaveBeenCalledTimes(1);
    expect(body.link).toContain("/apply/");
  });

  it("reads an applicant who never agreed as not agreed, not as a failure", async () => {
    publish();
    holder.client = seed().client;
    const body = (await (await send()).json()) as Sent;
    expect(body.text).toEqual({ sent: false, reason: "no_consent" });
    expect(sms.fn).not.toHaveBeenCalled();
    expect(mail.fn).toHaveBeenCalledTimes(1);
  });
});
