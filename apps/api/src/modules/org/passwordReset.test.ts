import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, type RecordedQuery, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { hashLinkToken } from "../../lib/linkToken.js";
import { loadEnv } from "../../env.js";

/**
 * The reset link's lifecycle (0363, PASSWORD-RESET-PLAN.md). What is pinned here, and why each one:
 *
 *  · THE LINK IS THE ONLY LIVE ONE. A new link revokes the old before it is inserted (D-PWR2).
 *  · THE TABLE HOLDS A HASH, THE EMAIL HOLDS THE TOKEN, THE CALLER HOLDS NEITHER (D-PWR1, D-PWR8).
 *  · A DRIVER IS NEVER A TARGET, read from `isRosterIssuedRole` (D-PWR5).
 *  · SPENDING IS A CLAIM FIRST; a refused password releases it (D-PWR3).
 *  · A COMPLETED RESET ENDS EVERY SESSION and says whether it did (D-PWR6).
 *
 * `password_resets` is modelled as a tiny in-memory table that APPLIES the chain's filters, because
 * the property under test — "only a live row can be claimed" — is a property of the WHERE clause,
 * and a fixture that ignores filters would pass with the clause deleted.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-2222-4333-8444-555555555555";
const ADMIN = "99999999-2222-4333-8444-555555555555";
const EMAIL = "pavlin@silvicominc.com";
const NOW = new Date("2026-09-23T20:00:00Z");
const ENV = loadEnv({
  NODE_ENV: "test",
  WEB_APP_URL: "https://app.example.test",
  MAIL_PROVIDER: "brevo",
  BREVO_API_KEY: "test-key",
} as NodeJS.ProcessEnv);

const sent = vi.hoisted(() => ({ mails: [] as Array<{ to: string[]; subject: string; text: string }>, ok: true }));
vi.mock("../../lib/mailer.js", () => ({
  makeSender: () => async (m: { to: string[]; subject: string; text: string }) => {
    sent.mails.push(m);
    return sent.ok;
  },
}));
vi.mock("../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));

const { issueReset, pickResetTarget, redeemReset, requestSelfServiceReset, resolveReset } = await import("./passwordReset.js");
const { writeAudit } = await import("../../lib/audit.js");

type Row = Record<string, unknown>;

/** Apply the recorded filters the way PostgREST would. Only the operators this service uses. */
function matches(row: Row, q: RecordedQuery): boolean {
  return q.ops.every((op) => {
    const [col, val] = op.args as [string, unknown];
    switch (op.method) {
      case "eq": return row[col] === val;
      case "is": return (row[col] ?? null) === val;
      case "gt": return String(row[col]) > String(val);
      case "gte": return String(row[col]) >= String(val);
      default: return true;
    }
  });
}

interface World {
  rec: SupabaseRecorder;
  resets: Row[];
}

function world(opts: { roles?: string[]; resets?: Row[]; auth?: Record<string, (...a: unknown[]) => unknown>; sessions?: number } = {}): World {
  const resets: Row[] = opts.resets ?? [];
  let seq = resets.length;
  const roles = opts.roles ?? ["dispatcher"];
  const rec = createSupabaseRecorder({
    tables: {
      password_resets: (q) => {
        const w = q.write;
        if (w?.method === "insert") {
          const row = { id: `reset-${++seq}`, consumed_at: null, revoked_at: null, ...(w.payload as Row) };
          resets.push(row);
          return { data: [row], error: null };
        }
        const hit = resets.filter((r) => matches(r, q));
        if (w?.method === "update") {
          for (const r of hit) Object.assign(r, w.payload as Row);
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        return { data: hit, error: null };
      },
    },
    rpc: (fn) => {
      if (fn === "password_reset_candidates") {
        return roles.map((role, i) => ({ user_id: USER, org_id: ORG, role, joined_at: `2026-09-0${i + 1}T00:00:00Z` }));
      }
      if (fn === "revoke_user_sessions") return opts.sessions ?? 2;
      return null;
    },
    auth: { getUserById: (id: unknown) => ({ data: { user: { id, email: EMAIL } }, error: null }), ...opts.auth },
  });
  return { rec, resets };
}

const liveRow = (token: string, over: Row = {}): Row => ({
  id: "reset-live",
  org_id: ORG,
  user_id: USER,
  token_hash: hashLinkToken(token),
  created_at: "2026-09-23T19:30:00.000Z",
  expires_at: "2026-09-23T20:30:00.000Z",
  consumed_at: null,
  revoked_at: null,
  ...over,
});
const TOKEN = "k".repeat(43);

/** The token the email carried, read back out of the sent message. */
const tokenFromMail = (i = 0): string => decodeURIComponent(/token=([^\s]+)/.exec(sent.mails[i]!.text)![1]!);

beforeEach(() => {
  vi.clearAllMocks();
  sent.mails = [];
  sent.ok = true;
});

describe("pickResetTarget", () => {
  it("refuses an address that holds ANY driver membership, even beside an office one", () => {
    expect(pickResetTarget([
      { user_id: USER, org_id: ORG, role: "dispatcher" },
      { user_id: USER, org_id: "other-org", role: "driver" },
    ])).toBeNull();
  });
  it("refuses an address with no membership at all", () => {
    expect(pickResetTarget([])).toBeNull();
  });
  it("takes the oldest office membership for a person in two orgs", () => {
    expect(pickResetTarget([
      { user_id: USER, org_id: ORG, role: "admin" },
      { user_id: USER, org_id: "second-org", role: "dispatcher" },
    ])).toEqual({ userId: USER, orgId: ORG });
  });
});

describe("issueReset", () => {
  it("revokes the previous live link BEFORE inserting the new one, stores only the hash, and never returns the link", async () => {
    const w = world({ resets: [liveRow("old-token-".padEnd(43, "x"))] });
    const out = await issueReset(w.rec.client, ENV, { target: { userId: USER, orgId: ORG }, email: EMAIL, requestedBy: null, now: NOW });

    expect(out).toEqual({ sent: true, expiresAt: "2026-09-23T21:00:00.000Z" });
    expect(JSON.stringify(out)).not.toContain("token");
    const writes = w.rec.forTable("password_resets").filter((q) => q.write);
    expect(writes.map((q) => q.write!.method)).toEqual(["update", "insert"]);
    expect(w.resets[0]!.revoked_at).toBe(NOW.toISOString());

    const token = tokenFromMail();
    const inserted = w.resets[1]!;
    expect(inserted.token_hash).toBe(hashLinkToken(token));
    expect(JSON.stringify(inserted)).not.toContain(token);
    expect(sent.mails[0]!.text).toContain("https://app.example.test/reset-password?token=");
    expect(w.resets.filter((r) => !r.consumed_at && !r.revoked_at)).toHaveLength(1);
  });

  it("revokes the link it just made when the email did not go out, and says so in the audit row", async () => {
    sent.ok = false;
    const w = world();
    const out = await issueReset(w.rec.client, ENV, { target: { userId: USER, orgId: ORG }, email: EMAIL, requestedBy: ADMIN, now: NOW });
    expect(out).toMatchObject({ sent: false });
    expect(w.resets[0]!.revoked_at).toBe(NOW.toISOString());
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orgId: ORG, actorId: ADMIN, action: "auth.password_reset_requested", entityId: USER,
      meta: expect.objectContaining({ via: "admin", sent: false }),
    }));
  });

  it("tells the person an admin sent it, and a self-service email says to ignore it if unasked", async () => {
    const w = world();
    await issueReset(w.rec.client, ENV, { target: { userId: USER, orgId: ORG }, email: EMAIL, requestedBy: ADMIN, now: NOW });
    await issueReset(w.rec.client, ENV, { target: { userId: USER, orgId: ORG }, email: EMAIL, requestedBy: null, now: NOW });
    expect(sent.mails[0]!.text).toContain("Your administrator sent you");
    expect(sent.mails[1]!.text).toContain("If it wasn't you, ignore this email");
  });
});

describe("requestSelfServiceReset", () => {
  it("does nothing at all for an address with no account", async () => {
    const w = world({ roles: [] });
    await requestSelfServiceReset(w.rec.client, ENV, { email: "nobody@example.test", now: NOW, ip: "1.2.3.4" });
    expect(w.rec.writes()).toHaveLength(0);
    expect(sent.mails).toHaveLength(0);
  });

  it("does nothing for a driver's login — their password is reset on the Drivers page", async () => {
    const w = world({ roles: ["driver"] });
    await requestSelfServiceReset(w.rec.client, ENV, { email: EMAIL, now: NOW, ip: "1.2.3.4" });
    expect(w.rec.writes()).toHaveLength(0);
    expect(sent.mails).toHaveLength(0);
  });

  it("stops at three links an hour for one person and audits the refusal", async () => {
    const recent = [0, 1, 2].map((i) => liveRow(`t${i}`.padEnd(43, "y"), {
      id: `r${i}`, created_at: `2026-09-23T19:${10 + i}:00.000Z`, revoked_at: i < 2 ? "2026-09-23T19:59:00.000Z" : null,
    }));
    const w = world({ resets: recent });
    await requestSelfServiceReset(w.rec.client, ENV, { email: EMAIL, now: NOW, ip: "1.2.3.4" });
    expect(sent.mails).toHaveLength(0);
    expect(w.resets).toHaveLength(3);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "auth.password_reset_throttled" }));
  });

  it("issues a link for an office member, matching the address case-insensitively", async () => {
    const w = world();
    await requestSelfServiceReset(w.rec.client, ENV, { email: "  Pavlin@SilvicomInc.com ", now: NOW, ip: "1.2.3.4" });
    expect(w.rec.rpcs()[0]).toEqual({ fn: "password_reset_candidates", args: { p_email: EMAIL } });
    expect(sent.mails).toHaveLength(1);
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: null, meta: expect.objectContaining({ via: "self", ip: "1.2.3.4" }),
    }));
  });
});

describe("resolveReset", () => {
  const dead: Array<[string, Row]> = [
    ["used", { consumed_at: "2026-09-23T19:40:00.000Z" }],
    ["revoked", { revoked_at: "2026-09-23T19:40:00.000Z" }],
    ["expired", { expires_at: "2026-09-23T19:59:59.000Z" }],
  ];
  it.each(dead)("refuses a %s link with the one answer every dead link gets", async (_label, over) => {
    const w = world({ resets: [liveRow(TOKEN, over)] });
    expect(await resolveReset(w.rec.client, TOKEN, NOW)).toMatchObject({ code: "invalid_link", status: 404 });
  });

  it("refuses a token nobody issued with the same answer", async () => {
    const w = world({ resets: [liveRow(TOKEN)] });
    expect(await resolveReset(w.rec.client, "z".repeat(43), NOW)).toMatchObject({ code: "invalid_link" });
  });

  it("refuses a live link for somebody who became a driver after it was sent", async () => {
    const w = world({ roles: ["driver"], resets: [liveRow(TOKEN)] });
    expect(await resolveReset(w.rec.client, TOKEN, NOW)).toMatchObject({ code: "invalid_link" });
  });

  it("names the address a live link sets the password for", async () => {
    const w = world({ resets: [liveRow(TOKEN)] });
    expect(await resolveReset(w.rec.client, TOKEN, NOW)).toMatchObject({ email: EMAIL, userId: USER, orgId: ORG });
  });
});

describe("redeemReset", () => {
  it("sets the password, spends the link, ends every session, sends the notice, and audits the count", async () => {
    const resets = [liveRow(TOKEN)];
    // What the row said at the moment GoTrue was asked — the claim must already be on it (D-PWR3).
    let consumedWhenSet: unknown = "never called";
    const w = world({
      resets,
      sessions: 3,
      auth: {
        updateUserById: () => {
          consumedWhenSet = resets[0]!.consumed_at;
          return { data: {}, error: null };
        },
      },
    });
    const out = await redeemReset(w.rec.client, ENV, { token: TOKEN, password: "correct horse battery", now: NOW });

    expect(out).toEqual({ email: EMAIL });
    expect(consumedWhenSet).toBe(NOW.toISOString());
    expect(w.resets[0]!.consumed_at).toBe(NOW.toISOString());
    expect(w.rec.authCalls.find((c) => c.fn === "updateUserById")?.args).toEqual([USER, { password: "correct horse battery" }]);
    expect(w.rec.rpcs().find((r) => r.fn === "revoke_user_sessions")?.args).toEqual({ p_user_id: USER });
    expect(sent.mails[0]!.subject).toBe("Your Silvicom 360 password was changed");
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "auth.password_reset_completed", actorId: USER, meta: { sessionsEnded: 3, noticeSent: true },
    }));
  });

  it("works exactly once: the second submit of the same link is refused and sets nothing", async () => {
    const w = world({ resets: [liveRow(TOKEN)] });
    await redeemReset(w.rec.client, ENV, { token: TOKEN, password: "correct horse battery", now: NOW });
    const again = await redeemReset(w.rec.client, ENV, { token: TOKEN, password: "another good passphrase", now: NOW });
    expect(again).toMatchObject({ code: "invalid_link" });
    expect(w.rec.authCalls.filter((c) => c.fn === "updateUserById")).toHaveLength(1);
  });

  it("lets exactly one of two SIMULTANEOUS submits through — both pass the read, only one wins the claim", async () => {
    const w = world({ resets: [liveRow(TOKEN)] });
    const [a, b] = await Promise.all([
      redeemReset(w.rec.client, ENV, { token: TOKEN, password: "correct horse battery", now: NOW }),
      redeemReset(w.rec.client, ENV, { token: TOKEN, password: "another good passphrase", now: NOW }),
    ]);
    expect([a, b].filter((r) => "email" in r)).toHaveLength(1);
    expect([a, b].filter((r) => "code" in r && r.code === "invalid_link")).toHaveLength(1);
    expect(w.rec.authCalls.filter((c) => c.fn === "updateUserById")).toHaveLength(1);
  });

  it("refuses a password containing the person's own address before claiming anything", async () => {
    const w = world({ resets: [liveRow(TOKEN)] });
    const out = await redeemReset(w.rec.client, ENV, { token: TOKEN, password: "pavlin-2026-password", now: NOW });
    expect(out).toMatchObject({ code: "weak_password", status: 422 });
    expect(w.resets[0]!.consumed_at).toBeNull();
    expect(w.rec.authCalls.filter((c) => c.fn === "updateUserById")).toHaveLength(0);
  });

  it("releases the claim when GoTrue refuses the password, so the same link still works", async () => {
    const w = world({
      resets: [liveRow(TOKEN)],
      auth: { updateUserById: () => ({ data: null, error: { code: "weak_password", message: "Password is known to be weak and easy to guess" } }) },
    });
    const out = await redeemReset(w.rec.client, ENV, { token: TOKEN, password: "correct horse battery", now: NOW });
    expect(out).toMatchObject({ code: "weak_password", message: "Password is known to be weak and easy to guess" });
    expect(w.resets[0]!.consumed_at).toBeNull();
    expect(w.rec.rpcs().map((r) => r.fn)).not.toContain("revoke_user_sessions");
    expect(await resolveReset(w.rec.client, TOKEN, NOW)).toMatchObject({ email: EMAIL });
  });
});
