import { describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { STEP_UP_TOKEN_TTL_SEC, mintStepUpToken, verifyStepUpToken } from "./stepUpToken.js";

/**
 * Audit P0-4 tripwires. The property that matters: possession of a valid token is the ONLY thing
 * that verifies, and it verifies for exactly one user, one org, one window — nothing the browser
 * can do to its Supabase session (refreshSession() included) can mint one.
 */

const KEY = Buffer.alloc(32, 7).toString("base64");
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: KEY } as NodeJS.ProcessEnv);
const bare = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

describe("stepUpToken", () => {
  it("round-trips for the same user+org inside the window", () => {
    const minted = mintStepUpToken(env, "u1", "org1");
    expect(minted).not.toBeNull();
    expect(verifyStepUpToken(env, minted!.token, "u1", "org1")).toBe(true);
  });

  it("refuses a different user and a different org — the binding is the point", () => {
    const minted = mintStepUpToken(env, "u1", "org1")!;
    expect(verifyStepUpToken(env, minted.token, "u2", "org1")).toBe(false);
    expect(verifyStepUpToken(env, minted.token, "u1", "org2")).toBe(false);
  });

  it("expires: a token minted TTL+1s ago no longer verifies", () => {
    const past = Date.now() - (STEP_UP_TOKEN_TTL_SEC + 1) * 1000;
    const minted = mintStepUpToken(env, "u1", "org1", past)!;
    expect(verifyStepUpToken(env, minted.token, "u1", "org1")).toBe(false);
    // …and it verified at mint time, so the failure above is expiry, not construction.
    expect(verifyStepUpToken(env, minted.token, "u1", "org1", past + 1000)).toBe(true);
  });

  it("refuses tampering: version, expiry and signature are all load-bearing", () => {
    const minted = mintStepUpToken(env, "u1", "org1")!;
    const [v, exp, sig] = minted.token.split(".") as [string, string, string];
    expect(verifyStepUpToken(env, `v2.${exp}.${sig}`, "u1", "org1")).toBe(false);
    expect(verifyStepUpToken(env, `${v}.${Number(exp) + 60}.${sig}`, "u1", "org1")).toBe(false);
    expect(verifyStepUpToken(env, `${v}.${exp}.${"0".repeat(sig.length)}`, "u1", "org1")).toBe(false);
    expect(verifyStepUpToken(env, "garbage", "u1", "org1")).toBe(false);
  });

  it("fails CLOSED with no signing key: nothing mints, nothing verifies", () => {
    expect(mintStepUpToken(bare, "u1", "org1")).toBeNull();
    const minted = mintStepUpToken(env, "u1", "org1")!;
    expect(verifyStepUpToken(bare, minted.token, "u1", "org1")).toBe(false);
  });
});

describe("strict key decoding (audit hardening)", () => {
  it("fails closed on a key that does not decode to 32 bytes", () => {
    // A truncated key must NOT silently derive a short subkey — the old inline heuristic could.
    const shortKey = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: "abcd" } as NodeJS.ProcessEnv);
    expect(mintStepUpToken(shortKey, "u1", "org1")).toBeNull();
    const good = mintStepUpToken(env, "u1", "org1")!;
    expect(verifyStepUpToken(shortKey, good.token, "u1", "org1")).toBe(false);
  });
});
