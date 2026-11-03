import { afterEach, describe, expect, it } from "vitest";
import { FakeMeta, type FakeMetaOptions } from "../simulator/fakeMeta.js";
import { CONNECTION_CHECKS, META_SCOPES, testMetaConnection } from "./connectionTest.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";

/**
 * The Meta connection test (B1b), against FakeMeta over HTTP. Every check fails for its own reason and
 * says so, and the Page token travels beside the report — never in it.
 */
const TOKEN = "EAAB-system-user-token-connection-test";
const PAGE_TOKEN = "EAAB-page-token-derived-0001";
const PAGE = { id: "200100", name: "Silvicom Trucking", access_token: PAGE_TOKEN, tasks: ["ADVERTISE", "ANALYZE", "MODERATE"] };
const ACCOUNT = { id: "1001", spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" };
let meta: FakeMeta | null = null;

afterEach(async () => {
  await meta?.stop();
  meta = null;
});

async function run(opts: Partial<FakeMetaOptions> = {}, target = { accountId: "act_1001", pageId: PAGE.id }) {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [ACCOUNT], pages: [PAGE], ...opts });
  const base = await meta.start();
  return testMetaConnection(new MetaGraph({ token: TOKEN, throttleKey: "t", baseUrl: base, retries: 0 }), target);
}

const check = (r: Awaited<ReturnType<typeof run>>, key: string) => r.report.checks.find((c) => c.key === key)!;

describe("testMetaConnection — a ready connection", () => {
  it("passes every check, in order, and hands the Page token beside the report", async () => {
    const r = await run();
    expect(r.report.ok).toBe(true);
    expect(r.report.checks.map((c) => [c.key, c.ok])).toEqual(CONNECTION_CHECKS.map((k) => [k, true]));
    expect(r.pageToken).toBe(PAGE_TOKEN);
    expect(r.report).toMatchObject({ account: { id: "1001", currency: "USD", spend_cap_cents: 300_000 }, page: { id: PAGE.id, tasks: ["ADVERTISE", "ANALYZE", "MODERATE"] }, error_code: null });
    expect(r.report.scopes_granted).toEqual([...META_SCOPES].sort());
  });

  it("the report holds no token — neither the system user's nor the Page's — so it can be stored and shown as it is", async () => {
    const r = await run();
    const text = JSON.stringify(r.report);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(PAGE_TOKEN);
  });
});

describe("testMetaConnection — each check fails for its own reason", () => {
  it("a revoked token stops the test: refused, nothing else asked, every other check not reached", async () => {
    meta = null;
    resetGraphThrottles();
    meta = new FakeMeta({ token: TOKEN, accounts: [ACCOUNT], pages: [PAGE] });
    const base = await meta.start();
    meta.revokeToken();
    const r = await testMetaConnection(new MetaGraph({ token: TOKEN, throttleKey: "t", baseUrl: base, retries: 0 }), { accountId: "1001", pageId: PAGE.id });
    expect(r.tokenRefused).toBe(true);
    expect(check(r, "token")).toMatchObject({ ok: false });
    expect(r.report.checks.filter((c) => c.key !== "token").every((c) => c.ok === null)).toBe(true);
    expect(r.report.error_code).toBe("token_invalid");
    expect(meta.requests).toHaveLength(1);
  });

  it("a missing scope fails, naming it; an extra scope is reported and does not fail", async () => {
    const granted = Object.fromEntries(META_SCOPES.map((s) => [s, "granted" as const]));
    const missing = await run({ permissions: { ...granted, leads_retrieval: "declined" } });
    expect(check(missing, "permissions")).toMatchObject({ ok: false, detail: expect.stringContaining("leads_retrieval") });
    expect(missing.report.error_code).toBe("permissions_missing");
    const extra = await run({ permissions: { ...granted, business_management: "granted" } });
    expect(check(extra, "permissions")).toMatchObject({ ok: true, detail: expect.stringContaining("business_management") });
    expect(extra.report.scopes_extra).toEqual(["business_management"]);
    expect(extra.report.ok).toBe(true);
  });

  it("no account spending limit in Meta fails: every launch would be refused (D-AD3 fence 3)", async () => {
    const r = await run({ accounts: [{ ...ACCOUNT, spend_cap_cents: 0 }] });
    expect(check(r, "spending_limit")).toMatchObject({ ok: false });
    expect(r.report.account!.spend_cap_cents).toBeNull();
    expect(r.report.ok).toBe(false);
  });

  it("an account billing in another currency, or not active, fails", async () => {
    expect(check(await run({ accounts: [{ ...ACCOUNT, currency: "CAD" }] }), "currency")).toMatchObject({ ok: false, detail: expect.stringContaining("CAD") });
    expect(check(await run({ accounts: [{ ...ACCOUNT, account_status: 2 }] }), "ad_account")).toMatchObject({ ok: false });
  });

  it("an account Meta does not know fails the account check with Meta's own answer", async () => {
    const r = await run({}, { accountId: "999999", pageId: PAGE.id });
    expect(check(r, "ad_account")).toMatchObject({ ok: false });
    expect(r.report.error_code).toBe("meta_100");
  });

  it("a Page the token cannot act for, or may not advertise on, fails — and no Page token is kept from it", async () => {
    const other = await run({}, { accountId: "1001", pageId: "777777" });
    expect(check(other, "page")).toMatchObject({ ok: false, detail: expect.stringContaining("777777") });
    expect(other.pageToken).toBeNull();
    const noAds = await run({ pages: [{ ...PAGE, tasks: ["ANALYZE"] }] });
    expect(check(noAds, "page")).toMatchObject({ ok: false, detail: expect.stringContaining("ADVERTISE") });
    expect(noAds.pageToken).toBeNull();
  });
});

describe("testMetaConnection — the Page's leadgen subscription (B4b)", () => {
  it("subscribes the Page to leadgen with the Page token, never the system user's", async () => {
    const r = await run();
    expect(check(r, "leadgen")).toMatchObject({ ok: true });
    expect([...meta!.webhooks.subscriptions.get(PAGE.id)!]).toEqual(["leadgen"]);
    const sub = meta!.requests.find((q) => q.path.endsWith(`/${PAGE.id}/subscribed_apps`))!;
    expect(sub).toMatchObject({ method: "POST", body: { subscribed_fields: "leadgen" } });
  });

  it("a system user with no content or moderation task on the Page fails the check and is told which task to give", async () => {
    const r = await run({ pages: [{ ...PAGE, tasks: ["ADVERTISE", "ANALYZE"] }] });
    expect(check(r, "page")).toMatchObject({ ok: true });
    expect(check(r, "leadgen")).toMatchObject({ ok: false, detail: expect.stringContaining("Moderate") });
    expect(r.report.ok).toBe(false);
    expect(meta!.webhooks.subscriptions.size).toBe(0);
  });

  it("is not asked for a Page that failed its own check", async () => {
    const r = await run({}, { accountId: "1001", pageId: "777777" });
    expect(check(r, "leadgen")).toMatchObject({ ok: null });
    expect(meta!.requests.some((q) => q.path.includes("subscribed_apps"))).toBe(false);
  });
});
