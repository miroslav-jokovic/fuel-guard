/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadSamsaraToken,
  saveSamsaraToken,
  clearSamsaraToken,
  sealPlaintextSamsaraTokens,
  SAMSARA_TOKEN_PURPOSE,
} from "./samsaraToken.js";
import { seal, secretAad, SecretBoxError } from "./secretBox.js";
import type { Env } from "../env.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const env = { SECRETS_ENCRYPTION_KEY: KEY } as Env;
const envNoKey = {} as Env;
const envWithFallback = { SECRETS_ENCRYPTION_KEY: KEY, SAMSARA_API_TOKEN: "env-fallback" } as Env;

/** Chainable fake: awaiting any chain resolves the table fixture; upsert/update are captured. */
function makeAdmin(fixture: { data: unknown }) {
  const writes: { kind: "upsert" | "update"; row: Record<string, unknown> }[] = [];
  function node(): any {
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ ...fixture, error: null });
        if (prop === "upsert" || prop === "update")
          return (row: Record<string, unknown>) => {
            writes.push({ kind: prop as "upsert" | "update", row });
            return prop === "update" ? proxy : Promise.resolve({ error: null });
          };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return { admin: { from: () => node() } as unknown as SupabaseClient, writes };
}

describe("saveSamsaraToken / loadSamsaraToken", () => {
  it("stores a sealed envelope (never the raw token) and reads it back", async () => {
    const { admin, writes } = makeAdmin({ data: null });
    await saveSamsaraToken(admin, env, "org1", "samsara_secret_token_12345");
    const stored = writes[0]!.row.samsara_api_token as string;
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("samsara_secret_token_12345");

    const { admin: reader } = makeAdmin({ data: { samsara_api_token: stored, enabled: true } });
    await expect(loadSamsaraToken(reader, env, "org1")).resolves.toBe("samsara_secret_token_12345");
  });

  it("still reads a legacy plaintext token as-is", async () => {
    const { admin } = makeAdmin({ data: { samsara_api_token: "legacy-plain", enabled: true } });
    await expect(loadSamsaraToken(admin, env, "org1")).resolves.toBe("legacy-plain");
  });

  it("falls back to the env token when disabled or when a sealed value cannot be opened", async () => {
    const { admin: disabled } = makeAdmin({ data: { samsara_api_token: "x", enabled: false } });
    await expect(loadSamsaraToken(disabled, envWithFallback, "org1")).resolves.toBe("env-fallback");

    // Sealed for a DIFFERENT org → AAD mismatch → logged + env fallback, never a crash.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const foreign = seal(env, "tok", secretAad("other-org", SAMSARA_TOKEN_PURPOSE));
    const { admin: tampered } = makeAdmin({ data: { samsara_api_token: foreign, enabled: true } });
    await expect(loadSamsaraToken(tampered, envWithFallback, "org1")).resolves.toBe("env-fallback");
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it("fails CLOSED on save when no sealing key is configured", async () => {
    const { admin, writes } = makeAdmin({ data: null });
    await expect(saveSamsaraToken(admin, envNoKey, "org1", "tok-123456789012345678")).rejects.toThrow(
      SecretBoxError,
    );
    expect(writes).toHaveLength(0); // nothing persisted
  });

  it("clearSamsaraToken nulls the stored token", async () => {
    const { admin, writes } = makeAdmin({ data: null });
    await clearSamsaraToken(admin, "org1");
    expect(writes[0]!.row.samsara_api_token).toBeNull();
  });
});

describe("sealPlaintextSamsaraTokens (boot sweep)", () => {
  it("seals plaintext rows in place and leaves sealed rows untouched", async () => {
    const alreadySealed = seal(env, "tok-a", secretAad("orgA", SAMSARA_TOKEN_PURPOSE));
    const { admin, writes } = makeAdmin({
      data: [
        { org_id: "orgA", samsara_api_token: alreadySealed },
        { org_id: "orgB", samsara_api_token: "plain-token-b" },
      ],
    });
    const res = await sealPlaintextSamsaraTokens(admin, env);
    expect(res.sealed).toBe(1);
    expect(writes).toHaveLength(1);
    expect((writes[0]!.row.samsara_api_token as string).startsWith("v1.")).toBe(true);
  });

  it("only warns (writes nothing) when the sealing key is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, writes } = makeAdmin({
      data: [{ org_id: "orgB", samsara_api_token: "plain-token-b" }],
    });
    const res = await sealPlaintextSamsaraTokens(admin, envNoKey);
    expect(res.sealed).toBe(0);
    expect(writes).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
