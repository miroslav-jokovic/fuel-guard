import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { getPolicyCached, __resetPolicyCache } from "../lib/efsPolicyCache.js";
import { seal, secretAad } from "../lib/secretBox.js";
import {
  __resetEfsSessions,
  efsSessionDiagnostics,
  withEfsSession,
} from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import {
  disableEfsSoapCredentials,
  getEfsSoapCredentials,
  upsertEfsSoapCredentials,
  type EfsSoapCredentials,
} from "./efsSoapCredentials.js";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  EFS_POLICY_CACHE_MS: 60_000,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
} as unknown as Env;

const creds = (orgId = ORG): EfsSoapCredentials => ({
  orgId,
  environment: "sandbox",
  endpointUrl: "https://qa.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user",
  soapPassword: "pass",
  accountId: null,
  postedLastCursor: null,
  rejectedLastCursor: null,
  postedLastPolledAt: null,
  rejectedLastPolledAt: null,
  postedLastSuccessAt: null,
  rejectedLastSuccessAt: null,
  postedLastError: null,
  rejectedLastError: null,
  enabled: true,
  fromEnvFallback: false,
  tls: null,
});

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>session-1</result></loginResponse>");
const policyOk = soap("<getPolicyResponse><result><description>Linehaul</description><handEnter>false</handEnter></result></getPolicyResponse>");

function sequence(...responses: string[]): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  return {
    fetchImpl: (async () => new Response(responses[calls++] ?? responses.at(-1), { status: 200 })) as typeof fetch,
    calls: () => calls,
  };
}

const input = {
  environment: "sandbox" as const,
  endpointUrl: creds().endpointUrl,
  soapUsername: "user",
  soapPassword: "rotated",
  accountId: null,
  enabled: true,
};

afterEach(() => {
  __resetPolicyCache();
  __resetEfsSessions();
  __resetSoapPacing();
});

const credentialRow = (legacyPassword: string, sealedPassword: string | null) => ({
  org_id: ORG,
  environment: "sandbox",
  endpoint_url: creds().endpointUrl,
  soap_username: "user",
  soap_password: legacyPassword,
  soap_password_sealed: sealedPassword,
  account_id: null,
  posted_last_cursor: null,
  rejected_last_cursor: null,
  posted_last_polled_at: null,
  rejected_last_polled_at: null,
  posted_last_success_at: null,
  rejected_last_success_at: null,
  posted_last_error: null,
  rejected_last_error: null,
  enabled: true,
});

describe("EFS credential password sealing", () => {
  it("round-trips a sealed password", async () => {
    const sealed = seal(env, "sealed-password", secretAad(ORG, "efs_soap_password.v1"));
    const db = createSupabaseRecorder({ tables: { efs_soap_credentials: [credentialRow("", sealed)] } });
    const loaded = await getEfsSoapCredentials(db.client, env, ORG);
    expect(loaded?.soapPassword).toBe("sealed-password");
  });

  it("still reads an unsealed legacy password during migration", async () => {
    const db = createSupabaseRecorder({ tables: { efs_soap_credentials: [credentialRow("legacy-password", null)] } });
    const loaded = await getEfsSoapCredentials(db.client, env, ORG);
    expect(loaded?.soapPassword).toBe("legacy-password");
  });
});

describe("EFS credential rotation", () => {
  it("upserting credentials clears every cached session for that org", async () => {
    const rec = sequence(loginOk, loginOk);
    await withEfsSession(env, creds(ORG), "live", async () => 1, { fetchImpl: rec.fetchImpl });
    await withEfsSession(env, creds(OTHER_ORG), "live", async () => 1, { fetchImpl: rec.fetchImpl });

    const db = createSupabaseRecorder();
    await upsertEfsSoapCredentials(db.client, env, ORG, input);
    const written = db.writtenRows("efs_soap_credentials")[0]!;
    expect(written.soap_password).toBe("");
    expect(String(written.soap_password_sealed)).toMatch(/^v1\./);

    expect(efsSessionDiagnostics(creds(ORG)).hasSession).toBe(false);
    expect(efsSessionDiagnostics(creds(OTHER_ORG)).hasSession).toBe(true);
  });

  it("disabling credentials clears the session and the policy cache", async () => {
    const rec = sequence(loginOk, policyOk, loginOk, policyOk);
    const orgCreds = creds(ORG);
    const first = await getPolicyCached(env, orgCreds, 14, { fetchImpl: rec.fetchImpl });
    expect(first.policy?.description).toBe("Linehaul");
    expect(efsSessionDiagnostics(orgCreds).hasSession).toBe(true);

    const db = createSupabaseRecorder();
    await disableEfsSoapCredentials(db.client, ORG);
    expect(efsSessionDiagnostics(orgCreds).hasSession).toBe(false);

    const second = await getPolicyCached(env, orgCreds, 14, { fetchImpl: rec.fetchImpl });
    expect(second.policy?.description).toBe("Linehaul");
    expect(rec.calls()).toBe(4);
  });
});
