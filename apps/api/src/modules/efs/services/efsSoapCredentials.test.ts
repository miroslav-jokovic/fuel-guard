import { afterEach, describe, expect, it } from "vitest";
import { getPolicyCached, __resetPolicyCache } from "../lib/efsPolicyCache.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import {
  __resetEfsSessions,
  efsSessionDiagnostics,
  withEfsSession,
} from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import {
  disableEfsSoapCredentials,
  getEfsSoapCredentials,
  recordFeedFailure,
  recordFeedSuccess,
  upsertEfsSoapCredentials,
  type EfsSoapCredentials,
} from "./efsSoapCredentials.js";
import { getEfsSoapStatus } from "./efsSoapStatus.js";
import { testEnv } from "../../../testing/testEnv.js";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const env = testEnv({
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  EFS_POLICY_CACHE_MS: 60_000,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
});

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

/**
 * Step 5.7. `updated_at` answers "when was this credential last CHANGED" — the question asked after
 * a security incident. A poller bumping it every hour destroyed that answer, so polls must not touch
 * it. These assert the application half; migration 0196 carries the other half, because 0091's
 * `before update` trigger re-stamped the column unconditionally and would have made these pass while
 * the database kept doing the wrong thing. Both halves are needed and neither is sufficient.
 */
describe("EFS credential updated_at means a configuration change, not a poll", () => {
  it.each(["posted", "rejected"] as const)("a successful %s poll does not patch updated_at", async (feed) => {
    const db = createSupabaseRecorder({ tables: { efs_soap_credentials: [credentialRow("", "sealed")] } });

    await recordFeedSuccess(db.client, ORG, feed, "2026-08-15T00:00:00Z");

    const written = db.writtenRows("efs_soap_credentials")[0]!;
    expect(written).not.toHaveProperty("updated_at");
    // …and it still records the poll where poll timing belongs.
    expect(written).toHaveProperty(`${feed}_last_success_at`);
    expect(written).toHaveProperty(`${feed}_last_polled_at`);
  });

  it.each(["posted", "rejected"] as const)("a failed %s poll does not patch updated_at", async (feed) => {
    const db = createSupabaseRecorder({ tables: { efs_soap_credentials: [credentialRow("", "sealed")] } });

    await recordFeedFailure(db.client, ORG, feed, "connection reset");

    const written = db.writtenRows("efs_soap_credentials")[0]!;
    expect(written).not.toHaveProperty("updated_at");
    expect(written).toHaveProperty(`${feed}_last_error`);
  });

  it("a credential rotation does patch updated_at", async () => {
    const db = createSupabaseRecorder();

    await upsertEfsSoapCredentials(db.client, env, ORG, input);

    expect(db.writtenRows("efs_soap_credentials")[0]).toHaveProperty("updated_at");
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

  it("resets write entitlement when the endpoint is repointed", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_soap_credentials: [credentialRow("", "sealed")],
        efs_card_control_settings: {
          data: { org_id: ORG, enabled: true, write_entitlement: "confirmed" },
        },
      },
    });

    await upsertEfsSoapCredentials(db.client, env, ORG, {
      ...input,
      endpointUrl: "https://qa2.efsllc.com/axis2/services/CardManagementWS/",
    }, "actor-1");

    expect(db.writtenRows("efs_card_control_settings")).toContainEqual({
      write_entitlement: "unknown",
      enabled: false,
    });
    expect(db.writtenRows("audit_logs").at(-1)).toMatchObject({
      action: "integration.efs_soap.credentials_changed",
      meta: { changedFields: ["endpoint_url"] },
    });
  });

  it("does not reset write entitlement on a password rotation", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_soap_credentials: [credentialRow("", "sealed")],
        efs_card_control_settings: {
          data: { org_id: ORG, enabled: true, write_entitlement: "confirmed" },
        },
      },
    });

    await upsertEfsSoapCredentials(db.client, env, ORG, input);

    expect(db.writtenRows("efs_card_control_settings")).toHaveLength(0);
    expect(db.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses credentials claiming production against a non-production host", async () => {
    const db = createSupabaseRecorder();

    await expect(upsertEfsSoapCredentials(db.client, env, ORG, {
      ...input,
      environment: "production",
    })).rejects.toThrow(/production endpoint host/i);
    await expect(upsertEfsSoapCredentials(db.client, env, ORG, {
      ...input,
      endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
    })).rejects.toThrow(/production endpoint host/i);
    expect(db.writtenRows("efs_soap_credentials")).toHaveLength(0);
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

/**
 * Q6b's second half (migration 0354 added the terminal `abandoned` status; this is its surface).
 *
 * The ceiling stops a run that can never finish. On its own that trades a LOUD failure for a SILENT
 * one: `getEfsSoapStatus` used to select `pending`/`running`/`failed`, so an abandoned run simply
 * drops out of the query and the operator watches the count fall to zero — indistinguishable from
 * work that completed. The three runs the ceiling was written for were invisible for 25 days while
 * being 48.9% of all scoring, and a fix whose only visible effect is a number going down would have
 * preserved exactly that.
 *
 * The fixture HONOURS the `.in("status", …)` filter rather than returning a flat array, so these
 * assertions fail if the query stops asking for `abandoned` — which a flat array could never catch.
 */
describe("EFS processing status — an abandoned run must not go quiet", () => {
  const runRow = (status: string, lastError: string | null = null) => ({
    org_id: ORG,
    feed: "posted" as const,
    status,
    last_error: lastError,
  });

  /** Returns only the rows whose status the query actually asked for. */
  const runsHonouringFilter = (rows: ReturnType<typeof runRow>[]) => (q: { filters(): Array<{ col: string; val: unknown }> }) => {
    const wanted = q.filters().find((f) => f.col === "status")?.val;
    const list = Array.isArray(wanted) ? (wanted as string[]) : null;
    return list ? rows.filter((r) => list.includes(r.status)) : rows;
  };

  const statusFor = async (rows: ReturnType<typeof runRow>[]) => {
    const db = createSupabaseRecorder({
      tables: {
        efs_soap_credentials: [credentialRow("plain-password", null)],
        efs_processing_runs: runsHonouringFilter(rows),
      },
    });
    return getEfsSoapStatus(db.client, env, ORG);
  };

  it("counts an abandoned run separately and does not call it pending", async () => {
    const status = await statusFor([
      runRow("pending"),
      runRow("running"),
      runRow("abandoned", "abandoned after 235 attempts without completing (attempt ceiling, migration 0354)"),
    ]);

    expect(status.posted.processingAbandoned).toBe(1);
    // Two genuinely in flight. Counting the abandoned one here would report work in progress that
    // nothing will ever pick up.
    expect(status.posted.processingPending).toBe(2);
  });

  it("surfaces the abandoned run's error ahead of a retrying one's", async () => {
    const status = await statusFor([
      runRow("failed", "EFS SOAP 503 — retrying"),
      runRow("abandoned", "abandoned after 235 attempts without completing (attempt ceiling, migration 0354)"),
    ]);

    // A `failed` run is mid-ladder and its error may be transient; an abandoned run's error is the
    // final word on that import, and it is the one an operator has to act on.
    expect(status.posted.processingLastError).toContain("attempt ceiling");
  });

  it("reports nothing abandoned when nothing is, and leaves the pending count alone", async () => {
    const status = await statusFor([runRow("pending"), runRow("failed", "transient")]);

    expect(status.posted.processingAbandoned).toBe(0);
    expect(status.posted.processingPending).toBe(2);
    expect(status.posted.processingLastError).toBe("transient");
  });
});
