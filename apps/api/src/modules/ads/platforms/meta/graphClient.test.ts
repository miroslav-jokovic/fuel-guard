import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../../../testing/fakeClock.js";
import { FAKE_META_VERSION, FakeMeta } from "../simulator/fakeMeta.js";
import { classify, META_GRAPH_VERSION, MetaGraph, readUsage, resetGraphThrottles } from "./graphClient.js";

/**
 * The Meta Graph client's contract (B1a), against FakeMeta over real HTTP. Each rule in the client's
 * header is asserted here: the version, the token's place, which failures are retried and which never
 * are, a create whose outcome is unknown, and a throttle obeyed without asking Meta again.
 */
const TOKEN = "EAAB-system-user-token-0123456789";
let meta: FakeMeta;
let base: string;
let clock: FakeClock;
let sleeps: number[];

beforeEach(async () => {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: "1001", spend_cap_cents: 500_000, amount_spent_cents: 12_345, account_status: 1, currency: "USD" }] });
  base = await meta.start();
  clock = new FakeClock();
  sleeps = [];
});
afterEach(() => meta.stop());

const client = (patch: Partial<ConstructorParameters<typeof MetaGraph>[0]> = {}) =>
  new MetaGraph({ token: TOKEN, throttleKey: "conn-1", baseUrl: base, now: clock.now, sleep: async (ms) => void sleeps.push(ms), timeoutMs: 300, ...patch });

const createBody = { name: "S360|test", objective: "OUTCOME_LEADS", status: "PAUSED", special_ad_categories: ["EMPLOYMENT"], spend_cap: 50_000 };

describe("MetaGraph — the shapes and the token", () => {
  it("calls the one Graph version FakeMeta answers, which is the version production calls", async () => {
    expect(FAKE_META_VERSION).toBe(META_GRAPH_VERSION);
    expect(base.endsWith(`/${META_GRAPH_VERSION}`)).toBe(true);
    const r = await client().get<{ spend_cap: string }>("act_1001", { fields: "spend_cap" });
    expect(r).toMatchObject({ ok: true, data: { id: "act_1001", spend_cap: "500000" } });
  });

  it("sends the token as a Bearer header, never in the URL or the body", async () => {
    await client().get("act_1001", { fields: "currency" });
    await client().post("act_1001/campaigns", createBody, { idempotent: false });
    for (const r of meta.requests) {
      expect(r.path).not.toContain(TOKEN);
      expect(r.body).not.toHaveProperty("access_token");
    }
  });

  it("sends arrays and objects as JSON, as Graph's form parameters take them", async () => {
    const r = await client().post<{ id: string }>("act_1001/campaigns", createBody, { idempotent: false });
    expect(r.ok).toBe(true);
    const made = meta.campaigns.get((r as { data: { id: string } }).data.id)!;
    expect(made).toMatchObject({ special_ad_categories: ["EMPLOYMENT"], status: "PAUSED", spend_cap: "50000" });
  });

  it("never carries the token in a failure, even when the message would", async () => {
    const echo = vi.fn(async () => new Response(JSON.stringify({ error: { code: 100, message: `bad token ${TOKEN}`, fbtrace_id: "x" } }), { status: 400 }));
    const r = await client({ fetch: echo as unknown as typeof fetch }).get("act_1001");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(r).toMatchObject({ ok: false, error: { message: "bad token [token]" } });
  });
});

describe("MetaGraph — what is retried, and what never is", () => {
  it("a read that meets a temporary error is retried, with backoff, and succeeds", async () => {
    meta.inject("GET", /^act_1001$/, { kind: "temporary" });
    const r = await client().get("act_1001");
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(sleeps).toEqual([1_000]);
  });

  it("a read that keeps failing gives up after its retries, saying transient", async () => {
    meta.inject("GET", /^act_1001$/, { kind: "temporary", code: 1 }, 10);
    const r = await client().get("act_1001");
    expect(r).toMatchObject({ ok: false, error: { kind: "transient", error_code: "transient", code: 1, attempts: 3, outcome_unknown: false } });
    expect(meta.requests).toHaveLength(3);
  });

  it("a status update is idempotent: retried after a temporary error", async () => {
    const made = await client().post<{ id: string }>("act_1001/campaigns", createBody, { idempotent: false });
    const id = (made as { data: { id: string } }).data.id;
    meta.inject("POST", new RegExp(`^${id}$`), { kind: "temporary" });
    const r = await client().post(id, { status: "ACTIVE" }, { idempotent: true });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(meta.campaigns.get(id)!.status).toBe("ACTIVE");
  });

  it("a create that met a server error is NEVER re-sent, and says its outcome is unknown — it may have happened", async () => {
    meta.inject("POST", /^act_1001\/campaigns$/, { kind: "applied_then_temporary" });
    const r = await client().post("act_1001/campaigns", createBody, { idempotent: false });
    expect(r).toMatchObject({ ok: false, error: { kind: "transient", outcome_unknown: true, attempts: 1 } });
    expect(meta.requests.filter((q) => q.method === "POST")).toHaveLength(1);
    expect(meta.campaigns.size).toBe(1); // it did happen: the publisher must read before it creates again
  });

  it("a create that timed out is not re-sent either; a read that timed out is retried", async () => {
    meta.inject("POST", /^act_1001\/campaigns$/, { kind: "hang" });
    const w = await client().post("act_1001/campaigns", createBody, { idempotent: false });
    expect(w).toMatchObject({ ok: false, error: { kind: "timeout", outcome_unknown: true, attempts: 1 } });
    meta.inject("GET", /^act_1001$/, { kind: "hang" });
    const r = await client().get("act_1001");
    expect(r).toMatchObject({ ok: true, attempts: 2 });
  });

  it("Meta's refusal of a create is a known outcome, not retried: special_ad_categories missing is meta_100", async () => {
    const r = await client().post("act_1001/campaigns", { ...createBody, special_ad_categories: undefined }, { idempotent: false });
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid_request", error_code: "meta_100", code: 100, outcome_unknown: false, attempts: 1 } });
    expect(meta.campaigns.size).toBe(0);
  });

  it("an expired or revoked token is token_invalid and is not retried", async () => {
    meta.revokeToken();
    const r = await client().get("act_1001");
    expect(r).toMatchObject({ ok: false, error: { kind: "token_invalid", code: 190, subcode: 463, attempts: 1 } });
    expect(meta.requests).toHaveLength(1);
  });

  it("a 5xx with no Graph body (a proxy's page) is transient; a 4xx with none is ours", async () => {
    const html = (status: number) => vi.fn(async () => new Response("<html>bad gateway</html>", { status }));
    expect(await client({ fetch: html(502) as unknown as typeof fetch, retries: 0 }).get("x")).toMatchObject({ ok: false, error: { kind: "transient", error_code: "http_502" } });
    expect(await client({ fetch: html(404) as unknown as typeof fetch }).get("x")).toMatchObject({ ok: false, error: { kind: "invalid_request", error_code: "http_404", attempts: 1 } });
  });
});

describe("MetaGraph — the throttle is obeyed, on Meta's clock", () => {
  it("a throttle is rate_limited with Meta's regain time, not retried, and later calls are refused without asking Meta", async () => {
    meta.inject("GET", /^act_1001$/, { kind: "throttle", regainMinutes: 7 });
    const first = await client().get("act_1001");
    expect(first).toMatchObject({ ok: false, error: { kind: "rate_limited", code: 80004, subcode: 2446079, retry_after_ms: 420_000, attempts: 1 } });
    const asked = meta.requests.length;
    // A NEW client for the same connection — the block is the connection's, not one object's.
    const second = await client().get("act_1001");
    expect(second).toMatchObject({ ok: false, error: { kind: "rate_limited", attempts: 0 } });
    expect(meta.requests).toHaveLength(asked);
    // Another carrier's connection is not blocked by it.
    expect(await client({ throttleKey: "conn-2" }).get("act_1001")).toMatchObject({ ok: true });
    clock.advance({ minutes: 7 });
    expect(await client().get("act_1001")).toMatchObject({ ok: true });
  });

  it("a usage header at 100 % blocks the next call even when this answer succeeded", async () => {
    const full = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "x-business-use-case-usage": JSON.stringify({ "1": [{ type: "ads_management", call_count: 100, total_cputime: 20, total_time: 20, estimated_time_to_regain_access: 3 }] }) },
    }));
    expect(await client({ fetch: full as unknown as typeof fetch }).get("x")).toMatchObject({ ok: true, usage: { peak_pct: 100, regain_minutes: 3 } });
    expect(await client({ fetch: full as unknown as typeof fetch }).get("x")).toMatchObject({ ok: false, error: { kind: "rate_limited", retry_after_ms: 180_000 } });
    expect(full).toHaveBeenCalledTimes(1);
  });
});

describe("classify and readUsage — Meta's tables, as pure functions", () => {
  it("files every code the error-handling page lists where the page says it belongs", () => {
    const table: Array<[number | null, string]> = [
      [1, "transient"], [2, "transient"], [4, "rate_limited"], [17, "rate_limited"], [341, "rate_limited"], [613, "rate_limited"],
      [80_004, "rate_limited"], [80_000, "rate_limited"], [80_014, "rate_limited"], [80_015, "invalid_request"],
      [190, "token_invalid"], [102, "token_invalid"], [3, "permission_denied"], [10, "permission_denied"], [200, "permission_denied"],
      [299, "permission_denied"], [300, "invalid_request"], [368, "policy_blocked"], [100, "invalid_request"], [2635, "invalid_request"], [null, "invalid_request"],
    ];
    expect(table.map(([c]) => [c, classify(c)])).toEqual(table);
  });

  it("reads the highest usage and regain time across every entry, and nothing from a malformed header", () => {
    expect(readUsage(JSON.stringify({ a: [{ call_count: 20, total_cputime: 61, total_time: 5, estimated_time_to_regain_access: 0 }], b: [{ call_count: 90, estimated_time_to_regain_access: 2 }] }))).toEqual({ peak_pct: 90, regain_minutes: 2 });
    expect(readUsage("not json")).toBeNull();
    expect(readUsage(null)).toBeNull();
  });
});
