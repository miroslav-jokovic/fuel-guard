import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tokenDaysLeft, type AdsTokenExpiry } from "@silvicom/shared";
import { loadEnv } from "../../../env.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { appAccessToken, readTokenExpiry } from "../platforms/meta/tokenExpiry.js";
import { metaTokenPurpose } from "../platforms/registry.js";
import { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { watchTokenExpiry } from "./tokenWatch.js";

/**
 * Audit 2026-11-18 A-8: a Meta token's expiry is read from `debug_token` with OUR app's token, written on the
 * connection, and admins are told once a day from 14 days before it lapses. Run against FakeMeta, whose
 * `debug_token` answers what the Graph reference page lists (and, for "never expires", OUR reading of 0).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CONN = "00000000-0000-4000-8000-00000000c001";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const TOKEN = "EAAGsystemusertokenAAAA1111222233334444";
const APP_ID = "1234567890123";
const APP_SECRET = "app-secret-0d9e8f7a6b5c4d3e2f1a";
const NOW = new Date("2026-11-18T15:00:00Z");
const base = { NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), META_APP_SECRET: APP_SECRET } as Record<string, string>;
const envWith = (appId: string | null) => loadEnv({ ...base, ...(appId ? { META_APP_ID: appId } : {}) } as NodeJS.ProcessEnv);
const env = envWith(APP_ID);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let meta: FakeMeta;
let url = "";
async function startMeta(tokenExpiresAt: number) {
  meta = new FakeMeta({ token: TOKEN, appId: APP_ID, appSecret: APP_SECRET, tokenExpiresAt, accounts: [{ id: "1001", spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }] });
  url = await meta.start();
}
beforeEach(() => resetGraphThrottles());
afterEach(async () => { await meta?.stop(); });

function world(over: Record<string, unknown> = {}) {
  const row = { id: CONN, org_id: ORG, provider: "meta", is_sandbox: false, status: "connected", token_sealed: seal(env, TOKEN, secretAad(ORG, metaTokenPurpose(false))), last_test: { ok: true, checks: [] }, ...over };
  return createSupabaseRecorder({
    tables: {
      ads_platform_connections: (q: RecordedQuery) => (q.write ? [] : [row]),
      memberships: [{ user_id: ADMIN, role: "admin" }],
      ads_settings_versions: [],
      organization_notification_settings: [],
    },
    rpc: () => "bell-1",
  });
}
const deps = (rec: ReturnType<typeof world>, e = env) => ({ admin: rec.client, env: e, now: () => NOW, metaGraphBase: url });
const written = (rec: ReturnType<typeof world>) => rec.forTable("ads_platform_connections").find((q) => q.write)?.write?.payload as { token_expires_on: string | null; last_test?: { token_expiry: AdsTokenExpiry } } | undefined;
const bells = (rec: ReturnType<typeof world>) => rec.rpcs().filter((r) => r.fn === "emit_notification").map((r) => r.args as Record<string, unknown>);

describe("watchTokenExpiry — the daily look (A-8)", () => {
  it("writes the expiry day and the reading, and tells the admins once that day, 9 days before it lapses", async () => {
    await startMeta(unix(inDays(9)));
    const rec = world();
    const out = await watchTokenExpiry(deps(rec), ORG, CONN);
    expect(out).toMatchObject({ kind: "read", days_left: 9, alerted: true });
    expect(written(rec)).toMatchObject({ token_expires_on: inDays(9).toISOString().slice(0, 10), last_test: { ok: true, token_expiry: { read: true, valid: true, never_expires: false } } });
    expect(bells(rec)).toEqual([expect.objectContaining({ p_user: ADMIN, p_category: "ads_token_expiring", p_severity: "warning", p_dedupe_key: `ads_token_expiring:${CONN}:2026-11-18` })]);
    expectOrgScoped(rec, ORG);
  });

  it("stays quiet further out, and for a token issued never to expire", async () => {
    await startMeta(unix(inDays(40)));
    const far = world();
    expect(await watchTokenExpiry(deps(far), ORG, CONN)).toMatchObject({ days_left: 40, alerted: false });
    await meta.stop();
    await startMeta(0);
    const never = world();
    const out = await watchTokenExpiry(deps(never), ORG, CONN);
    expect(out).toMatchObject({ kind: "read", days_left: null, alerted: false, expiry: { read: true, never_expires: true, expires_at: null } });
    expect(written(never)!.token_expires_on).toBeNull();
    expect(bells(far)).toEqual([]);
    expect(bells(never)).toEqual([]);
  });

  it("is critical when Meta says the token is no longer valid", async () => {
    await startMeta(0);
    meta.revokeToken();
    const rec = world();
    expect(await watchTokenExpiry(deps(rec), ORG, CONN)).toMatchObject({ alerted: true, expiry: { read: true, valid: false } });
    expect(bells(rec)[0]).toMatchObject({ p_severity: "critical", p_title: "An ad account connection's token has lapsed" });
  });

  it("says it did not read, and why, with no app id — and tells nobody", async () => {
    await startMeta(unix(inDays(2)));
    const rec = world();
    const out = await watchTokenExpiry(deps(rec, envWith(null)), ORG, CONN);
    expect(out).toMatchObject({ kind: "read", alerted: false, expiry: { read: false, why: "no_app_id" } });
    expect(bells(rec)).toEqual([]);
  });

  it("leaves a simulator or disconnected connection alone", async () => {
    await startMeta(0);
    expect(await watchTokenExpiry(deps(world({ provider: "simulator", token_sealed: null })), ORG, CONN)).toMatchObject({ kind: "skipped" });
    expect(await watchTokenExpiry(deps(world({ status: "disconnected" })), ORG, CONN)).toEqual({ kind: "skipped", why: "disconnected" });
  });
});

describe("readTokenExpiry and the app token", () => {
  it("asks with our app's token, not the user's, and no token reaches FakeMeta's request log", async () => {
    await startMeta(unix(inDays(9)));
    const { MetaGraph } = await import("../platforms/meta/graphClient.js");
    const graph = new MetaGraph({ token: TOKEN, throttleKey: "t", baseUrl: url });
    expect(await readTokenExpiry(graph, "999|wrong", NOW)).toMatchObject({ read: false, why: "graph_error", error_code: "token_invalid" });
    expect(await readTokenExpiry(graph, appAccessToken(env), NOW)).toMatchObject({ read: true, valid: true });
    expect(JSON.stringify(meta.requests)).not.toContain(TOKEN);
    expect(appAccessToken(envWith(null))).toBeNull();
  });

  it("counts whole days, and none for a token that never expires or was not read", () => {
    const read = (at: Date): AdsTokenExpiry => ({ read: true, valid: true, expires_at: at.toISOString(), never_expires: false, data_access_expires_at: null, checked_at: NOW.toISOString() });
    expect(tokenDaysLeft(read(inDays(14.5)), NOW)).toBe(14);
    expect(tokenDaysLeft(read(inDays(-1)), NOW)).toBe(-1);
    expect(tokenDaysLeft({ read: false, why: "no_app_id", error_code: null, checked_at: "" }, NOW)).toBeNull();
    expect(tokenDaysLeft(undefined, NOW)).toBeNull();
  });
});
