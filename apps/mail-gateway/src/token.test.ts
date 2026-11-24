import { describe, expect, it } from "vitest";
import { ENTRA_AUDIENCE, federatedTokens, TokenFailed } from "./token.js";

const now = { t: Date.parse("2026-11-24T16:00:00Z") };
const deps = (status: number, body: unknown, seen: { aws: unknown[]; post: URLSearchParams[] }) => ({
  tenantId: "tenant", clientId: "client", now: () => new Date(now.t),
  awsToken: async (req: unknown) => { seen.aws.push(req); return "aws.jwt.sig"; },
  post: async (_url: string, b: URLSearchParams) => { seen.post.push(b); return { status, json: async () => body }; },
});

describe("federated tokens (no secret, V7)", () => {
  it("asks AWS for RS256, Entra's audience, 300 s — and sends Entra no secret", async () => {
    const seen = { aws: [] as unknown[], post: [] as URLSearchParams[] };
    const t = federatedTokens(deps(200, { access_token: "graph", expires_in: 3600 }, seen));
    expect(await t.get()).toBe("graph");
    expect(seen.aws[0]).toEqual({ audience: ENTRA_AUDIENCE, signingAlgorithm: "RS256", durationSeconds: 300 });
    const form = Object.fromEntries(seen.post[0]!);
    expect(form).toMatchObject({ client_assertion: "aws.jwt.sig", grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" });
    expect(Object.keys(form)).not.toContain("client_secret");
  });

  it("reuses the token until five minutes before expiry, and renews on demand", async () => {
    const seen = { aws: [] as unknown[], post: [] as URLSearchParams[] };
    const t = federatedTokens(deps(200, { access_token: "graph", expires_in: 3600 }, seen));
    await t.get(); await t.get();
    expect(seen.post.length).toBe(1);
    now.t += 56 * 60_000;
    await t.get();
    expect(seen.post.length).toBe(2);
    await t.get(true);
    expect(seen.post.length).toBe(3);
  });

  it("a refusal says the AADSTS number only", async () => {
    const t = federatedTokens(deps(400, { error: "invalid_client", error_codes: [70021], error_description: "AADSTS70021: … ids …" }, { aws: [], post: [] }));
    await expect(t.get()).rejects.toThrow(TokenFailed);
    await expect(t.get()).rejects.toThrow(/AADSTS70021/);
    await expect(t.get()).rejects.not.toThrow(/ids/);
  });
});
