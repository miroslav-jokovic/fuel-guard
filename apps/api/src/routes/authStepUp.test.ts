import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { stepUpBootWarning, stepUpMissing, stepUpReadiness } from "../envAuth.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * Whether "Confirm it's you" can work on a deploy (Q-AD41 (b), 2026-11-06): one definition (`stepUpMissing`,
 * envAuth.ts), read by the route, `/api/version`, `verify:live`, deploy-verify and the boot log. Staging ran two weeks
 * without SUPABASE_ANON_KEY, every step-up answering 503 while the prompt blamed the password, and nobody was told.
 */
const KEY = randomBytes(32).toString("base64");
const env = (over: Record<string, string | undefined>) =>
  loadEnv({ NODE_ENV: "test", SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon-key-value", SECRETS_ENCRYPTION_KEY: KEY, ...over } as NodeJS.ProcessEnv);

describe("step-up readiness", () => {
  it("is ready when the password grant and the minting key are both configured", () => {
    expect(stepUpMissing(env({}))).toEqual([]);
    expect(stepUpReadiness(env({}))).toBe("ready");
    expect(stepUpBootWarning(env({}))).toBeNull();
  });

  it("names each missing setting, and only by name", () => {
    expect(stepUpMissing(env({ SUPABASE_URL: undefined }))).toEqual(["SUPABASE_URL"]);
    expect(stepUpMissing(env({ SUPABASE_ANON_KEY: undefined }))).toEqual(["SUPABASE_ANON_KEY"]);
    expect(stepUpMissing(env({ SECRETS_ENCRYPTION_KEY: undefined }))).toEqual(["SECRETS_ENCRYPTION_KEY"]);
    const readiness = stepUpReadiness(env({ SUPABASE_ANON_KEY: undefined, SECRETS_ENCRYPTION_KEY: undefined }));
    expect(readiness).toBe("missing:SUPABASE_ANON_KEY,SECRETS_ENCRYPTION_KEY");
    expect(readiness).not.toContain(KEY);
    expect(readiness).not.toContain("p.supabase.co");
  });

  it("counts a minting key that is set but cannot be used as missing, as minting does", () => {
    expect(stepUpMissing(env({ SECRETS_ENCRYPTION_KEY: "too-short" }))).toEqual(["SECRETS_ENCRYPTION_KEY"]);
  });

  it("takes the web build's anon key as the API's, as the env loader does", () => {
    expect(stepUpMissing(env({ SUPABASE_ANON_KEY: undefined, VITE_SUPABASE_ANON_KEY: "anon" }))).toEqual([]);
  });

  it("says it once at boot, naming what is missing and what it stops, never a value", () => {
    const warning = stepUpBootWarning(env({ SUPABASE_ANON_KEY: undefined }))!;
    expect(warning).toContain("SUPABASE_ANON_KEY not set");
    expect(warning).toContain(`"Confirm it's you" answers 503`);
    expect(warning).not.toContain(KEY);
  });
});

describe("POST /api/auth/step-up on a deploy that cannot do it", () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const [missing, over] of [["the anon key", { SUPABASE_ANON_KEY: undefined }], ["the minting key", { SECRETS_ENCRYPTION_KEY: undefined }]] as const) {
    it(`without ${missing}: 503 step_up_unavailable, Supabase never asked about the password, no setting named`, async () => {
      const grant = vi.fn(async () => new Response("{}", { status: 200 }));
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
        String(input instanceof Request ? input.url : input).includes("/auth/v1/token") ? grant() : realFetch(input, init));
      const app = createApp(env(over));
      app.locals.verifyToken = async () => ({ userId: "u-1", email: "a@x.test", orgId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", role: "admin" });
      const server = app.listen(0);
      await new Promise((r) => server.once("listening", r));
      try {
        const res = await realFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/step-up`, {
          method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify({ password: "hunter2" }),
        });
        const body = await res.text();
        expect(res.status).toBe(503);
        expect(body).toContain("step_up_unavailable");
        expect(body).not.toMatch(/SUPABASE_|SECRETS_/);
        expect(grant).not.toHaveBeenCalled();
      } finally {
        await closeTestServer(server);
      }
    });
  }
});
