import { describe, expect, it, vi } from "vitest";
import { loadEnv, type Env } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { busyCounts, issueFormToken, readFormToken, turnstileBootWarning, turnstileKeys, verifyTurnstile, TURNSTILE_VERIFY_URL, type FetchLike } from "./applyChecks.js";

/**
 * APPLY-PAGE-PLAN D-AP5/D-AP6: each check's reading, on its own. The rule that turns readings into flags is the shared
 * `applyFlags` (its own test); the road that stores the lead is `routes/publicCareers.test.ts`.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OPENING = "60000000-0000-4000-8000-000000000001";
const SECRET = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-11-20T15:00:00Z");
const env = (extra: Record<string, string> = {}): Env =>
  loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: SECRET, WEB_APP_URL: "https://360.example.test", ...extra } as NodeJS.ProcessEnv);
const KEYS = { TURNSTILE_SITE_KEY: "0x4AAAAAAAsite", TURNSTILE_SECRET_KEY: "0x4AAAAAAAsecret" };

describe("Turnstile's keys come as a pair (D-AP6)", () => {
  it("both set: on; either alone or neither: off, and the boot line says which", () => {
    expect(turnstileKeys(env(KEYS))).toEqual({ siteKey: "0x4AAAAAAAsite", secret: "0x4AAAAAAAsecret" });
    expect(turnstileBootWarning(env(KEYS))).toBeNull();
    expect(turnstileKeys(env({ TURNSTILE_SITE_KEY: "s" }))).toBeNull();
    expect(turnstileKeys(env({ TURNSTILE_SECRET_KEY: "s" }))).toBeNull();
    expect(turnstileBootWarning(env({ TURNSTILE_SECRET_KEY: "s" }))).toContain("only one of");
    expect(turnstileBootWarning(env())).toContain("no robot check");
  });
});

describe("the form token: which form was served, and when", () => {
  const later = (ms: number) => new Date(NOW.getTime() + ms);

  it("read back for its own carrier and opening: the fill time on the server's clock, and the form's own id", () => {
    const t = issueFormToken(env(), ORG, OPENING, NOW)!;
    const a = readFormToken(env(), ORG, OPENING, t, later(65_000));
    const b = readFormToken(env(), ORG, OPENING, t, later(70_000));
    expect(a).toMatchObject({ fill: "ok", fill_ms: 65_000 });
    // The same form read twice is the same id: that is what makes a second send ONE lead.
    expect(b.ref).toBe(a.ref);
    expect(readFormToken(env(), ORG, OPENING, issueFormToken(env(), ORG, OPENING, NOW)!, later(65_000)).ref).not.toBe(a.ref);
  });

  it("sent under 4 seconds is too fast; at 4 seconds it is not", () => {
    const t = issueFormToken(env(), ORG, OPENING, NOW)!;
    expect(readFormToken(env(), ORG, OPENING, t, later(3_999)).fill).toBe("too_fast");
    expect(readFormToken(env(), ORG, OPENING, t, later(4_000)).fill).toBe("ok");
  });

  it("another carrier's, another opening's, an edited, a missing or a future token is invalid, with a fresh id each time", () => {
    const t = issueFormToken(env(), ORG, OPENING, NOW)!;
    const bad = [
      readFormToken(env(), OTHER, OPENING, t, later(10_000)),
      readFormToken(env(), ORG, "60000000-0000-4000-8000-000000000002", t, later(10_000)),
      readFormToken(env(), ORG, OPENING, `${t.slice(0, -2)}xx`, later(10_000)),
      readFormToken(env(), ORG, OPENING, null, later(10_000)),
      readFormToken(env(), ORG, OPENING, issueFormToken(env(), ORG, OPENING, later(120_000))!, NOW),
    ];
    for (const r of bad) expect(r).toMatchObject({ fill: "token_invalid", fill_ms: null });
    expect(new Set(bad.map((r) => r.ref)).size).toBe(bad.length);
  });

  it("a clock a little behind another instance's is not a forgery", () => {
    const t = issueFormToken(env(), ORG, OPENING, later(30_000))!;
    expect(readFormToken(env(), ORG, OPENING, t, NOW)).toMatchObject({ fill: "too_fast", fill_ms: 0 });
  });

  it("a server that cannot seal issues none and measures nothing — never flags for it", () => {
    const plain = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(issueFormToken(plain, ORG, OPENING, NOW)).toBeNull();
    expect(readFormToken(plain, ORG, OPENING, null, NOW)).toMatchObject({ fill: "not_measured", fill_ms: null });
  });
});

describe("Turnstile, checked on the server", () => {
  const answering = (status: number, body: unknown) => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: status < 400, status, json: async () => body };
    };
    return { fetchImpl, calls };
  };
  const ok = { success: true, hostname: "360.example.test", action: "apply", "error-codes": [] };

  it("posts the secret, the token, the address and the form's id to siteverify; success for our host and action passes", async () => {
    const f = answering(200, ok);
    expect(await verifyTurnstile(env(KEYS), "tok", "203.0.113.9", "11111111-1111-4111-8111-111111111111", f.fetchImpl)).toEqual({ outcome: "passed", errors: [] });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(TURNSTILE_VERIFY_URL);
    expect(Object.fromEntries(f.calls[0]!.body)).toEqual({
      secret: "0x4AAAAAAAsecret", response: "tok", remoteip: "203.0.113.9", idempotency_key: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("success for another host, or for another action, fails: Cloudflare's own advice", async () => {
    expect((await verifyTurnstile(env(KEYS), "tok", null, "k", answering(200, { ...ok, hostname: "evil.example" }).fetchImpl)).outcome).toBe("failed");
    expect((await verifyTurnstile(env(KEYS), "tok", null, "k", answering(200, { ...ok, action: "login" }).fetchImpl)).outcome).toBe("failed");
  });

  it("a server with a careers host expects THAT host (D-AP9): the office app's own host then fails", async () => {
    const careers = env({ ...KEYS, CAREERS_URL: "https://careers.example.test" });
    expect((await verifyTurnstile(careers, "tok", null, "k", answering(200, { ...ok, hostname: "careers.example.test" }).fetchImpl)).outcome).toBe("passed");
    expect((await verifyTurnstile(careers, "tok", null, "k", answering(200, ok).fetchImpl)).outcome).toBe("failed");
  });

  it("Cloudflare's no fails with its codes; a spent token fails", async () => {
    expect(await verifyTurnstile(env(KEYS), "tok", null, "k", answering(200, { success: false, "error-codes": ["invalid-input-response"] }).fetchImpl))
      .toEqual({ outcome: "failed", errors: ["invalid-input-response"] });
    expect((await verifyTurnstile(env(KEYS), "tok", null, "k", answering(200, { success: false, "error-codes": ["timeout-or-duplicate"] }).fetchImpl)).outcome).toBe("failed");
  });

  it("our own fault (a wrong secret), their 5xx, or no answer at all is unavailable: not the person's, so not a flag", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await verifyTurnstile(env(KEYS), "tok", null, "k", answering(200, { success: false, "error-codes": ["invalid-input-secret"] }).fetchImpl)).outcome).toBe("unavailable");
      expect((await verifyTurnstile(env(KEYS), "tok", null, "k", answering(200, { success: false, "error-codes": ["internal-error"] }).fetchImpl)).outcome).toBe("unavailable");
      expect((await verifyTurnstile(env(KEYS), "tok", null, "k", answering(503, {}).fetchImpl)).outcome).toBe("unavailable");
      const down: FetchLike = async () => { throw new Error("ECONNRESET"); };
      expect((await verifyTurnstile(env(KEYS), "tok", null, "k", down)).outcome).toBe("unavailable");
    } finally {
      quiet.mockRestore();
    }
  });

  it("no token is missing, and Cloudflare is not asked; no keys is not configured, and nothing is asked", async () => {
    const f = answering(200, ok);
    expect((await verifyTurnstile(env(KEYS), null, null, "k", f.fetchImpl)).outcome).toBe("missing");
    expect((await verifyTurnstile(env(), "tok", null, "k", f.fetchImpl)).outcome).toBe("not_configured");
    expect(f.calls).toHaveLength(0);
  });
});

describe("how busy the address and the number are", () => {
  it("counts this carrier's apply-page leads from the address in the last hour and for the number in the last day", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        recruiting_leads: (q: RecordedQuery) => {
          const byIp = q.filters().some((f) => f.col === "raw->client->>ip");
          return { data: null, count: byIp ? 4 : 2 };
        },
      },
    });
    expect(await busyCounts(rec.client as never, ORG, "203.0.113.9", "+17082365732", NOW)).toEqual({ address_last_hour: 4, number_last_day: 2 });
    const [ip, num] = [rec.forTable("recruiting_leads").find((q) => q.filters().some((f) => f.col === "raw->client->>ip"))!, rec.forTable("recruiting_leads").find((q) => q.filters().some((f) => f.col === "phone_e164"))!];
    const since = (q: RecordedQuery) => q.ops.find((o) => o.method === "gte" && o.args[0] === "received_at")?.args[1];
    for (const q of [ip, num]) expect(q.filters()).toEqual(expect.arrayContaining([{ col: "channel", val: "apply_page" }]));
    expect(since(ip)).toBe("2026-11-20T14:00:00.000Z");
    expect(since(num)).toBe("2026-11-19T15:00:00.000Z");
    expect(ip.filters().find((f) => f.col === "raw->client->>ip")).toMatchObject({ val: "203.0.113.9" });
    expect(num.filters().find((f) => f.col === "phone_e164")).toMatchObject({ val: "+17082365732" });
    expectOrgScoped(rec, ORG);
  });

  it("a count that fails reads as 0, and nothing is asked for an address or number we do not have", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = createSupabaseRecorder({ tables: { recruiting_leads: () => ({ data: null, error: { message: "down" } }) } });
      expect(await busyCounts(failing.client as never, ORG, "203.0.113.9", "+17082365732", NOW)).toEqual({ address_last_hour: 0, number_last_day: 0 });
      const none = createSupabaseRecorder({ tables: { recruiting_leads: [] } });
      expect(await busyCounts(none.client as never, ORG, null, null, NOW)).toEqual({ address_last_hour: 0, number_last_day: 0 });
      expect(none.forTable("recruiting_leads")).toHaveLength(0);
    } finally {
      quiet.mockRestore();
    }
  });
});
