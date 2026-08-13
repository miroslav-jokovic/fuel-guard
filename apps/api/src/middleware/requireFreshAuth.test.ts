import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../env.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../lib/stepUpToken.js";
import { DEFAULT_STEP_UP_MAX_AGE_SEC, hasFreshAuth, requireFreshAuth } from "./requireFreshAuth.js";

/**
 * Step-up re-authentication. The whole mechanism is one number off a verified JWT, so the only way
 * to get it wrong is to be permissive in a case nobody thought about — which is what each of these
 * cases is.
 */

const nowSec = () => Math.floor(Date.now() / 1000);
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

function request(issuedAt: number | null | undefined, stepUpToken?: string, orgId = "o") {
  return {
    auth: { userId: "u", email: null, orgId, role: "admin", issuedAt },
    header: vi.fn((name: string) => (name === STEP_UP_TOKEN_HEADER ? stepUpToken : undefined)),
    app: { locals: { env } },
  } as unknown as Request;
}

function call(issuedAt: number | null | undefined, maxAgeSec?: number, stepUpToken?: string, orgId?: string) {
  const req = request(issuedAt, stepUpToken, orgId);
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  requireFreshAuth(maxAgeSec)(req, res, next);
  return { res, json, next, req };
}

describe("requireFreshAuth", () => {
  it("passes a token minted moments ago", () => {
    const { next, res } = call(nowSec() - 10);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("refuses a token older than the window, and says how fresh it needs to be", () => {
    const { next, res, json } = call(nowSec() - DEFAULT_STEP_UP_MAX_AGE_SEC - 1);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0]![0]).toMatchObject({
      error: { code: "step_up_required" },
      // Echoed so the browser prompt can say "in the last 5 minutes" without hardcoding a number the
      // server owns.
      maxAgeSec: DEFAULT_STEP_UP_MAX_AGE_SEC,
    });
  });

  it("FAILS CLOSED when the token carries no iat at all", () => {
    // A gate that waves through what it cannot verify is decoration. Both shapes of "absent".
    expect((call(undefined).next as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((call(null).next as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("tolerates small clock skew but refuses a token from the future", () => {
    // Thirty seconds of skew between Supabase and this process is normal and harmless.
    expect(call(nowSec() + 30).next).toHaveBeenCalled();
    // Ten minutes into the future is not skew; it is a broken clock or a forged claim, and neither is
    // a reason to lower a security bar.
    expect(call(nowSec() + 600).next).not.toHaveBeenCalled();
  });

  it("honours a caller-supplied window", () => {
    expect(call(nowSec() - 45, 60).next).toHaveBeenCalled();
    expect(call(nowSec() - 90, 60).next).not.toHaveBeenCalled();
  });

  it("a valid step-up token passes with no iat at all", () => {
    const token = mintStepUpToken(env, "u", "o")!.token;
    const { next, res } = call(undefined, undefined, token);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("a step-up token minted for a different org does not pass", () => {
    const token = mintStepUpToken(env, "u", "other-org")!.token;
    const { next, res } = call(undefined, undefined, token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("hasFreshAuth — the predicate for conditional step-up", () => {
  it("agrees with the middleware", () => {
    const fresh = request(nowSec() - 5);
    const stale = request(nowSec() - 10_000);
    const missing = request(undefined);
    expect(hasFreshAuth(fresh)).toBe(true);
    expect(hasFreshAuth(stale)).toBe(false);
    expect(hasFreshAuth(missing)).toBe(false);
  });
});
