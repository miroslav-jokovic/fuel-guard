import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { __resetEfsSessions } from "./efsSoapSession.js";
import { __resetSoapPacing } from "./soapClient.js";
import { __resetPolicyCache, getPolicyCached } from "./efsPolicyCache.js";

/**
 * The property (audit P1-1, second half): one vendor round-trip serves every card page that asks
 * for the same policy inside the TTL — including the pages asking about a policy the account is
 * NOT entitled to read, which used to re-dial (with retries) on every single view.
 */

const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  EFS_POLICY_CACHE_MS: 60_000,
} as unknown as Env;

const creds: EfsSoapCredentials = {
  orgId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  environment: "production",
  endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user", soapPassword: "pass", accountId: null,
  postedLastCursor: null, rejectedLastCursor: null,
  postedLastPolledAt: null, rejectedLastPolledAt: null,
  postedLastSuccessAt: null, rejectedLastSuccessAt: null,
  postedLastError: null, rejectedLastError: null,
  enabled: true, fromEnvFallback: false, tls: null,
};

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>sess-1</result></loginResponse>");
const policyOk = soap(
  "<getPolicyResponse><result><description>Linehaul</description><handEnter>false</handEnter></result></getPolicyResponse>",
);
const fault = soap(
  "<soap:Fault xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'><faultstring>Not Allowed 109491436176</faultstring></soap:Fault>",
);

function stub(...responses: string[]): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async () => {
    const body = responses[Math.min(calls, responses.length - 1)]!;
    calls += 1;
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

afterEach(() => {
  __resetPolicyCache();
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("getPolicyCached", () => {
  it("serves the second ask from cache — one login + one getPolicy total", async () => {
    const s = stub(loginOk, policyOk);
    const first = await getPolicyCached(env, creds, 14, { fetchImpl: s.fetchImpl });
    expect(first.policy?.description).toBe("Linehaul");
    const callsAfterFirst = s.calls();

    const second = await getPolicyCached(env, creds, 14, { fetchImpl: s.fetchImpl });
    expect(second.policy?.description).toBe("Linehaul");
    expect(s.calls()).toBe(callsAfterFirst); // nothing dialed
  });

  it("caches a refusal too — a permanent Not Allowed stops costing a vendor call per page view", async () => {
    const s = stub(loginOk, fault);
    const first = await getPolicyCached(env, creds, 14, { fetchImpl: s.fetchImpl });
    expect(first.policy).toBeNull();
    expect(first.policyError).toContain("firewall"); // the classified NotAllowed message
    const callsAfterFirst = s.calls();

    const second = await getPolicyCached(env, creds, 14, { fetchImpl: s.fetchImpl });
    expect(second.policy).toBeNull();
    expect(s.calls()).toBe(callsAfterFirst);
  });

  it("keys per policy — policy 15 is its own vendor call, not policy 14's cache entry", async () => {
    const s = stub(loginOk, policyOk, policyOk);
    await getPolicyCached(env, creds, 14, { fetchImpl: s.fetchImpl });
    const callsAfterFirst = s.calls();
    await getPolicyCached(env, creds, 15, { fetchImpl: s.fetchImpl });
    expect(s.calls()).toBe(callsAfterFirst + 1);
  });
});
