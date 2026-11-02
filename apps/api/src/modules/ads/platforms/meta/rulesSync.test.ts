import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, adRuleName, type AdsSettings } from "@silvicom/shared";
import { loadEnv } from "../../../../env.js";
import { CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "../../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { syncOrgRules } from "../../settings/rulesSyncJob.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../registry.js";
import { FakeMeta } from "../simulator/fakeMeta.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";
import { syncAutomatedRules, type RulesSyncInput } from "./rulesSync.js";

/** B3b: Meta's Automated Rules follow the settings in force — a diff, scoped to our rules only. */
const TOKEN = "EAAB-rules-token-0123456789";
const ACCOUNT = "5001";
const AUTO: AdsSettings["auto_pause"] = { cpl_max_cents: 4_200, cpl_min_leads: 3, no_lead_spend_cents: 7_500, frequency_max: 4, pause_at_daily_cap: true, pause_when_filled: true };
let meta: FakeMeta;
let base: string;
let w: AdsWorld;

beforeEach(async () => {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: ACCOUNT, spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }] });
  base = await meta.start();
  w = createAdsWorld({ campaigns: [] });
});
afterEach(() => meta.stop());
afterAll(() => stopSimulatorForTests());

const input = (auto: Partial<AdsSettings["auto_pause"]> = {}, version = 3): RulesSyncInput => ({
  orgId: ORG, connectionId: CONN, accountId: ACCOUNT, code: "META", settingsVersion: version,
  settings: { ...ADS_SETTINGS_UNSET, auto_pause: { ...AUTO, ...auto } },
});
const sync = (i: RulesSyncInput) => syncAutomatedRules({ admin: w.admin, graph: new MetaGraph({ token: TOKEN, throttleKey: "conn-rules", baseUrl: base, timeoutMs: 300, sleep: async () => {} }), now: w.now }, i);
const posts = () => meta.requests.filter((r) => r.method === "POST").length;
const rule = (key: string) => [...meta.rules.rules.values()].filter((r) => r.name === adRuleName(key as never, "META"));

describe("Automated Rules sync (B3b)", () => {
  it("writes every rule the settings want on an empty account, recorded as one succeeded rules_sync row", async () => {
    const r = await sync(input());
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => [x.key, x.outcome])).toEqual([["cpl_max", "created"], ["no_lead_spend", "created"], ["frequency_max", "created"], ["daily_cap", "created"]]);
    expect(meta.rules.rules.size).toBe(4);
    expect(w.actions.filter((a) => a.kind === "rules_sync").map((a) => a.status)).toEqual(["succeeded"]);
    expectOrgScoped(w.rec, ORG);
  });

  it("running it again changes nothing on Meta: every rule unchanged, no write sent", async () => {
    await sync(input());
    const before = posts();
    const r = await sync(input());
    expect(r.results.every((x) => x.outcome === "unchanged")).toBe(true);
    expect(posts()).toBe(before);
  });

  it("a changed threshold rewrites its rule in place — the same rule, never a second", async () => {
    await sync(input());
    const id = rule("cpl_max")[0]!.id;
    const r = await sync(input({ cpl_max_cents: 3_000 }, 4));
    expect(r.results.find((x) => x.key === "cpl_max")).toEqual({ key: "cpl_max", outcome: "updated", rule_id: id });
    expect(rule("cpl_max")).toHaveLength(1);
    expect(JSON.stringify(rule("cpl_max")[0]!.evaluation_spec)).toContain('"value":3000');
  });

  it("a threshold turned off disables our rule, and a rule someone else made is never touched", async () => {
    await sync(input());
    meta.rules.rules.set("999", { id: "999", account_id: ACCOUNT, name: "Owner's own rule", status: "ENABLED", evaluation_spec: {}, execution_spec: {}, schedule_spec: {} });
    const r = await sync(input({ frequency_max: null }, 4));
    expect(r.results.find((x) => x.key === "frequency_max")).toMatchObject({ outcome: "disabled" });
    expect(rule("frequency_max")[0]!.status).toBe("DISABLED");
    expect(meta.rules.rules.get("999")!.status).toBe("ENABLED");
    // Turned back on: the same rule is re-enabled, not a new one made.
    await sync(input({}, 5));
    expect(rule("frequency_max").map((x) => x.status)).toEqual(["ENABLED"]);
  });

  it("Meta refusing the spend rule (2703, U2) is recorded refused; the other rules still land and the sync is not a failure", async () => {
    meta.rules.refuseSpendPause = true;
    const r = await sync(input());
    expect(r.ok).toBe(true);
    expect(r.results.find((x) => x.key === "no_lead_spend")).toEqual({ key: "no_lead_spend", outcome: "refused", error_code: "meta_2703" });
    expect(meta.rules.rules.size).toBe(3);
  });

  it("a revoked token fails the sync with one failed row and no write", async () => {
    meta.revokeToken();
    expect(await sync(input())).toEqual({ ok: false, results: [] });
    expect(w.actions.filter((a) => a.kind === "rules_sync").map((a) => [a.status, a.error_code])).toEqual([["failed", "token_invalid"]]);
    expect(posts()).toBe(0);
  });

  it("two rules carrying our name are refused as duplicate_rule and left as they are", async () => {
    for (const id of ["801", "802"]) meta.rules.rules.set(id, { id, account_id: ACCOUNT, name: adRuleName("cpl_max", "META"), status: "ENABLED", evaluation_spec: {}, execution_spec: {}, schedule_spec: {} });
    const r = await sync(input());
    expect(r.ok).toBe(false);
    expect(r.results.find((x) => x.key === "cpl_max")).toEqual({ key: "cpl_max", outcome: "failed", error_code: "duplicate_rule" });
    expect(rule("cpl_max")).toHaveLength(2);
  });

  it("the org job syncs each connected account: the simulator's rules are SIM's, scoped to SIM ad sets", async () => {
    const sim = await simulatorFakeForTests();
    const world = createAdsWorld({
      campaigns: [], settings: { ...LIVE_SETTINGS, auto_pause: AUTO },
      connections: [{ id: CONN, org_id: ORG, provider: "simulator", is_sandbox: false, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" }],
    });
    const r = await syncOrgRules({ admin: world.admin, env: loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv), now: world.now }, ORG);
    expect(r.connections).toEqual([expect.objectContaining({ connection_id: CONN, ok: true })]);
    const names = [...sim.rules.rules.values()].map((x) => x.name);
    expect(names).toContain(adRuleName("cpl_max", "SIM"));
    expect(JSON.stringify([...sim.rules.rules.values()][0]!.evaluation_spec)).toContain("S360|SIM|adset|");
    expectOrgScoped(world.rec, ORG);
  });
});
