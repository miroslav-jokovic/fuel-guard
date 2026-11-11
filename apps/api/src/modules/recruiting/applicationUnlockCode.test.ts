import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNLOCK_CODE_MAX_TRIES } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";

/**
 * The one-time code in place of the date of birth (F0b, 0585).
 *
 * What must hold: the code goes only where the link went (the invitation's email, or the agreed number),
 * never to anything the request names; a draft with nothing to unlock gets no code; a text the SMS rules
 * hold stores nothing, so it cannot retire a code already in the inbox; only the newest code counts,
 * five wrong answers retire it, a spent or expired one opens nothing; a right one releases what the date
 * of birth would, once, audited without the code; and every query is scoped to the invitation's org.
 */

const mailer = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true, provider: "resend", status: 200 })) }));
vi.mock("../../lib/mailer.js", () => ({ sendEmail: mailer.fn }));
const sms = vi.hoisted(() => ({
  send: vi.fn(async (): Promise<unknown> => ({ sent: true, messageId: "m-1" })),
  status: vi.fn(async () => ({ offered: true, state: "agreed", phoneLast4: "0142", grantedAt: null, revokedAt: null })),
}));
vi.mock("./applicationSms.js", () => ({ sendApplicationSms: sms.send, smsConsentStatus: sms.status }));

const { requestUnlockCode, unlockWithCode, latestCodeUnlock, hashUnlockCode } = await import("./applicationUnlockCode.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const TOKEN = "i".repeat(43);
const NOW = new Date("2026-11-10T15:00:00Z");
const env = loadEnv({ NODE_ENV: "test", MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", WEB_APP_URL: "https://app.test" } as NodeJS.ProcessEnv);

const invitation = {
  id: INV, org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN), sign_token_hash: null, sms_token_hash: null,
  expires_at: "2026-12-01T00:00:00Z", revoked_at: null, consented_at: "2026-11-01T00:00:00Z", unlock_failures: 0,
  email: "susan.godfrey@example.test",
};
const LOCKED_DRAFT = { payload: { first_name: "Susan", date_of_birth: "1980-04-01" }, furthest_section: "identity", updated_at: "2026-11-09T09:00:00Z", revision: 3 };

const codeRow = (over: Record<string, unknown> = {}) => ({
  id: "c-1", code_hash: hashUnlockCode(INV, "123456"), expires_at: "2026-11-10T15:10:00Z", attempts: 0, used_at: null, ...over,
});

const seed = (opts: { draft?: unknown[]; codes?: unknown[]; spent?: unknown[]; email?: string | null } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: (q: RecordedQuery) =>
        q.ops.some((o) => o.method === "or") ? [invitation] : [{ email: opts.email === undefined ? invitation.email : opts.email }],
      application_drafts: opts.draft ?? [LOCKED_DRAFT],
      application_intakes: [],
      application_intake_licences: [],
      drivers: [],
      organizations: [{ name: "Silvicom" }],
      audit_logs: [],
      application_unlock_codes: (q: RecordedQuery) => {
        if (q.write?.method === "update" && q.ops.some((o) => o.method === "is")) return opts.spent ?? [{ id: "c-1" }];
        if (q.write) return [];
        return opts.codes ?? [];
      },
    },
  });

const inserted = (rec: ReturnType<typeof seed>) =>
  rec.writes().filter((q) => q.table === "application_unlock_codes" && q.write?.method === "insert");
const audits = (rec: ReturnType<typeof seed>) =>
  rec.writes().filter((q) => q.table === "audit_logs").map((q) => q.write?.payload as Record<string, unknown>);

beforeEach(() => {
  mailer.fn.mockClear();
  sms.send.mockClear();
  sms.send.mockResolvedValue({ sent: true, messageId: "m-1" });
});

describe("sending a code", () => {
  it("emails it to the invitation's own address, stores only its hash, says where masked, and audits without it", async () => {
    const rec = seed();
    const answer = await requestUnlockCode(rec.client, env, TOKEN, { channel: "email", language: "en" }, NOW, () => "042917");
    expect(answer).toEqual({ outcome: "sent", channel: "email", to: "s•••@example.test", expiresInMinutes: 10 });

    const mail = (mailer.fn.mock.calls[0] as unknown as [unknown, { to: string[]; text: string }])[1];
    expect(mail.to).toEqual(["susan.godfrey@example.test"]);
    expect(mail.text).toContain("042917");

    const [row] = inserted(rec);
    expect(row!.write!.payload).toMatchObject({
      org_id: ORG, invitation_id: INV, channel: "email", code_hash: hashUnlockCode(INV, "042917"), expires_at: "2026-11-10T15:10:00.000Z",
    });
    expect(JSON.stringify(row!.write!.payload)).not.toContain("042917");

    const audit = audits(rec).find((a) => a.action === "compliance.unlock_code_sent")!;
    expect(audit.meta).toEqual({ driverId: DRIVER, channel: "email" });
    expect(JSON.stringify(audit)).not.toContain("042917");
    expect(JSON.stringify(audit)).not.toContain("susan");
    // The token lookup is what FINDS the org, so it is the one read that cannot filter on it.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  it("texts it in Spanish when asked, to the agreed number, masked to its last four", async () => {
    const rec = seed();
    const answer = await requestUnlockCode(rec.client, env, TOKEN, { channel: "sms", language: "es" }, NOW, () => "042917");
    expect(answer).toEqual({ outcome: "sent", channel: "sms", to: "•••-•••-0142", expiresInMinutes: 10 });
    const body = (sms.send.mock.calls[0] as unknown as unknown[])[4] as string;
    expect(body).toMatch(/^042917 es su código/);
    expect(inserted(rec)).toHaveLength(1);
  });

  it("stores nothing when the text is held, so a code already in the email stays the newest", async () => {
    sms.send.mockResolvedValue({ sent: false, held: "quiet_hours" });
    const rec = seed();
    const answer = await requestUnlockCode(rec.client, env, TOKEN, { channel: "sms", language: "en" }, NOW);
    expect(answer).toEqual({ outcome: "held", channel: "sms", held: "quiet_hours" });
    expect(inserted(rec)).toHaveLength(0);
  });

  it("says there is no address rather than sending anywhere, and stores nothing", async () => {
    const rec = seed({ email: null });
    expect(await requestUnlockCode(rec.client, env, TOKEN, { channel: "email", language: "en" }, NOW)).toEqual({
      outcome: "held", channel: "email", held: "no_address",
    });
    expect(mailer.fn).not.toHaveBeenCalled();
    expect(inserted(rec)).toHaveLength(0);
  });

  it("sends no code for an application with nothing locked — it is not a way to email the applicant", async () => {
    const rec = seed({ draft: [] });
    const answer = await requestUnlockCode(rec.client, env, TOKEN, { channel: "email", language: "en" }, NOW);
    expect(isIntakeError(answer) && answer.code).toBe("not_locked");
    expect(mailer.fn).not.toHaveBeenCalled();
  });
});

describe("using a code", () => {
  it("opens the application with the newest code, spends it once, and tells the office", async () => {
    const rec = seed({ codes: [codeRow()] });
    const view = await unlockWithCode(rec.client, TOKEN, "123456", NOW);
    expect(isIntakeError(view)).toBe(false);
    expect(view).toMatchObject({ locked: false, payload: LOCKED_DRAFT.payload, revision: 3 });
    const spend = rec.writes().find((q) => q.table === "application_unlock_codes" && q.write?.method === "update")!;
    expect(spend.write!.payload).toEqual({ used_at: NOW.toISOString() });
    expect(spend.ops.some((o) => o.method === "is")).toBe(true);
    expect(audits(rec).map((a) => a.action)).toContain("compliance.draft_unlocked_by_code");
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  it("counts a wrong code against the value it read and opens nothing", async () => {
    const rec = seed({ codes: [codeRow({ attempts: 2 })] });
    const view = await unlockWithCode(rec.client, TOKEN, "654321", NOW);
    expect(isIntakeError(view) && view.code).toBe("code_not_accepted");
    const count = rec.writes().find((q) => q.table === "application_unlock_codes")!;
    expect(count.write!.payload).toEqual({ attempts: 3 });
    expect(count.filters()).toContainEqual({ col: "attempts", val: 2 });
  });

  it("refuses even the right code once it is spent, expired or out of tries", async () => {
    for (const over of [
      { used_at: "2026-11-10T14:59:00Z" },
      { expires_at: "2026-11-10T15:00:00Z" },
      { attempts: UNLOCK_CODE_MAX_TRIES },
    ]) {
      const view = await unlockWithCode(seed({ codes: [codeRow(over)] }).client, TOKEN, "123456", NOW);
      expect(isIntakeError(view) && view.code, JSON.stringify(over)).toBe("code_not_accepted");
    }
  });

  it("opens nothing when another tab spent the same code first", async () => {
    const view = await unlockWithCode(seed({ codes: [codeRow()], spent: [] }).client, TOKEN, "123456", NOW);
    expect(isIntakeError(view) && view.code).toBe("code_not_accepted");
  });

  it("refuses when no code was ever sent", async () => {
    const view = await unlockWithCode(seed().client, TOKEN, "123456", NOW);
    expect(isIntakeError(view) && view.code).toBe("code_not_accepted");
  });
});

describe("the office's notice", () => {
  it("reads when the applicant last used a code, scoped to the org", async () => {
    const rec = createSupabaseRecorder({ tables: { application_unlock_codes: [{ used_at: "2026-11-10T15:01:00Z" }] } });
    expect(await latestCodeUnlock(rec.client, ORG, INV)).toBe("2026-11-10T15:01:00Z");
    expectOrgScoped(rec, ORG);
    expect(await latestCodeUnlock(createSupabaseRecorder({ tables: { application_unlock_codes: [] } }).client, ORG, INV)).toBeNull();
  });
});
