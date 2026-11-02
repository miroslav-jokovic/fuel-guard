import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeMeta } from "./fakeMeta.js";

/**
 * FakeMeta's own contract: the shapes and faults the Meta adapter (B1–B3) will be tested against. If
 * one of these is wrong, every adapter test built on it is wrong with it — so each documented rule the
 * fake claims to hold is asserted here, against the fake over real HTTP.
 */
const TOKEN = "system-user-token";
let meta: FakeMeta;
let base: string;

beforeEach(async () => {
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: "1001", spend_cap_cents: 500_000, amount_spent_cents: 12_345, account_status: 1, currency: "USD" }] });
  base = await meta.start();
});
afterEach(() => meta.stop());

/** Graph's answer as these tests read it: an object, or Meta's error envelope. */
interface GraphBody {
  [field: string]: unknown;
  id?: string;
  status?: string;
  error?: { code: number; error_subcode?: number; type: string; message: string; fbtrace_id: string };
}

async function graph(method: "GET" | "POST", path: string, params: Record<string, string> = {}, opts: { token?: string; signal?: AbortSignal } = {}) {
  const p = new URLSearchParams({ ...params, access_token: opts.token ?? TOKEN });
  const res = method === "GET"
    ? await fetch(`${base}/${path}?${p}`, { signal: opts.signal })
    : await fetch(`${base}/${path}`, { method, body: p, headers: { "content-type": "application/x-www-form-urlencoded" }, signal: opts.signal });
  return { status: res.status, headers: res.headers, body: (await res.json()) as GraphBody };
}

const create = (patch: Record<string, string> = {}) =>
  graph("POST", "act_1001/campaigns", { name: "S360|test", objective: "OUTCOME_LEADS", status: "PAUSED", special_ad_categories: '["EMPLOYMENT"]', spend_cap: "50000", ...patch });

describe("FakeMeta — the documented shapes", () => {
  it("reads the ad account: cents as numeric strings, the requested fields plus the defaults", async () => {
    const r = await graph("GET", "act_1001", { fields: "spend_cap,amount_spent,account_status,currency" });
    expect(r).toMatchObject({ status: 200, body: { id: "act_1001", account_id: "1001", spend_cap: "500000", amount_spent: "12345", account_status: 1, currency: "USD" } });
    expect(Object.keys((await graph("GET", "act_1001")).body).sort()).toEqual(["account_id", "id"]);
  });

  it("creates a campaign paused and answers { id, success }; reads it back field for field", async () => {
    const made = await create();
    expect(made.status).toBe(200);
    expect(made.body).toEqual({ id: expect.stringMatching(/^\d+$/), success: true });
    const read = await graph("GET", made.body.id!, { fields: "name,status,effective_status,spend_cap,special_ad_categories" });
    expect(read.body).toEqual({ id: made.body.id!, name: "S360|test", status: "PAUSED", effective_status: "PAUSED", spend_cap: "50000", special_ad_categories: ["EMPLOYMENT"] });
  });

  it("refuses what Meta refuses at creation: no special_ad_categories, a status other than ACTIVE/PAUSED, a spend cap under $100", async () => {
    for (const bad of [{ special_ad_categories: undefined }, { special_ad_categories: '["JOBS"]' }, { status: "ARCHIVED" }, { spend_cap: "9999" }]) {
      const params = Object.fromEntries(Object.entries({ name: "x", status: "PAUSED", special_ad_categories: '["EMPLOYMENT"]', ...bad }).filter(([, v]) => v !== undefined)) as Record<string, string>;
      const r = await graph("POST", "act_1001/campaigns", params);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error).toMatchObject({ code: 100, type: "OAuthException", fbtrace_id: expect.any(String) });
    }
    expect(meta.campaigns.size).toBe(0);
  });

  it("updates status with { success }, accepting all four statuses and refusing anything else", async () => {
    const { body } = await create();
    for (const status of ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]) {
      expect((await graph("POST", body.id!, { status })).body).toEqual({ success: true });
      expect(meta.campaigns.get(body.id!)!.status).toBe(status);
    }
    expect((await graph("POST", body.id!, { status: "LIVE" })).body.error!.code).toBe(100);
  });

  it("an unknown object is code 100 subcode 33; an unsupported version is refused", async () => {
    expect((await graph("GET", "999")).body.error).toMatchObject({ code: 100, error_subcode: 33 });
    const r = await fetch(`${base.replace(/v\d+\.\d+$/, "v1.0")}/act_1001?access_token=${TOKEN}`);
    expect(r.status).toBe(400);
  });

  it("records every request with the token redacted", async () => {
    await graph("GET", "act_1001");
    expect(meta.requests[0]!.body.access_token).toBe("[redacted]");
    expect(JSON.stringify(meta.requests)).not.toContain(TOKEN);
  });
});

describe("FakeMeta — its own failures are loud", () => {
  it("a bug inside the fake answers 500 naming it, never an unanswered request that looks like a hang", async () => {
    (meta as unknown as { route: () => never }).route = () => {
      throw new Error("boom");
    };
    expect(await graph("GET", "act_1001", {}, { signal: AbortSignal.timeout(2000) })).toMatchObject({ status: 500, body: { fake_meta_bug: "boom" } });
  });
});

describe("FakeMeta — injected faults", () => {
  it("throttle: 80004 / 2446079 with the business-use-case usage header at 100 %", async () => {
    meta.inject("POST", /^act_\d+\/campaigns$/, { kind: "throttle", regainMinutes: 7 });
    const r = await create();
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 80004, error_subcode: 2446079 });
    const usage = JSON.parse(r.headers.get("x-business-use-case-usage")!);
    expect(Object.values(usage)[0]).toEqual([expect.objectContaining({ type: "ads_management", call_count: 100, estimated_time_to_regain_access: 7 })]);
    expect(meta.campaigns.size).toBe(0);
    expect((await create()).status).toBe(200); // consumed once
  });

  it("temporary: code 1 or 2, HTTP 500, nothing created", async () => {
    meta.inject("POST", /campaigns$/, { kind: "temporary", code: 1 });
    expect(await create()).toMatchObject({ status: 500, body: { error: { code: 1 } } });
    expect(meta.campaigns.size).toBe(0);
  });

  it("applied then temporary: the campaign EXISTS though the answer was an error — the half-created object", async () => {
    meta.inject("POST", /campaigns$/, { kind: "applied_then_temporary" });
    expect((await create()).status).toBe(500);
    expect([...meta.campaigns.values()].map((c) => c.name)).toEqual(["S360|test"]);
  });

  it("token expired, and a revoked token stays refused: 190 / 463", async () => {
    meta.inject("GET", /^act_/, { kind: "token_expired" });
    expect((await graph("GET", "act_1001")).body.error).toMatchObject({ code: 190, error_subcode: 463 });
    meta.revokeToken();
    for (const _ of [1, 2]) expect((await graph("GET", "act_1001")).body.error).toMatchObject({ code: 190, error_subcode: 463 });
    expect((await graph("GET", "act_1001", {}, { token: "someone-else" })).body.error!.code).toBe(190);
  });

  it("hang: the request is never answered, so the caller's own timeout is what decides", async () => {
    meta.inject("GET", /^act_/, { kind: "hang" });
    await expect(graph("GET", "act_1001", {}, { signal: AbortSignal.timeout(150) })).rejects.toThrow();
    expect((await graph("GET", "act_1001")).status).toBe(200);
  });

  it("an Ads Manager edit is a status change nobody asked for (D-AD4)", async () => {
    const { body } = await create();
    meta.externalStatusChange(body.id!, "ACTIVE");
    expect((await graph("GET", body.id!, { fields: "status" })).body.status).toBe("ACTIVE");
    expect(meta.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });
});
