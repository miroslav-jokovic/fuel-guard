import { describe, expect, it } from "vitest";
import { loadEnv } from "../../env.js";
import { HttpError } from "../../lib/http.js";
import { cardRefHmac } from "../../services/efsCardMirror.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { assertOrgOwnsCard, assertProbeAllowed, resolveProbeCredentials, resolveReadOnlyScanCredentials } from "./probeGuards.js";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const PAN = "70830000000000001";
const KEY = Buffer.alloc(32, 7).toString("base64");
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: KEY } as NodeJS.ProcessEnv);

const creds = (overrides: Partial<EfsSoapCredentials> = {}): EfsSoapCredentials => ({
  orgId: ORG,
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
  ...overrides,
});

describe("assertOrgOwnsCard", () => {
  it("refuses a PAN that is not in the org with a 404", async () => {
    const db = createSupabaseRecorder({ tables: { efs_cards: [] } });
    await expect(assertOrgOwnsCard(db.client, env, ORG, PAN)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("accepts a PAN in the org's mirror", async () => {
    const db = createSupabaseRecorder({
      tables: { efs_cards: [{ id: "card-1", org_id: ORG, card_ref_hmac: cardRefHmac(env, ORG, PAN) }] },
    });
    await expect(assertOrgOwnsCard(db.client, env, ORG, PAN)).resolves.toBeUndefined();
    expect(db.queries[0]?.filters()).toEqual([
      { col: "card_ref_hmac", val: cardRefHmac(env, ORG, PAN) },
      { col: "org_id", val: ORG },
    ]);
  });

  it("fails closed when the secrets key is missing", async () => {
    const db = createSupabaseRecorder({ tables: { efs_cards: [] } });
    const missingKeyEnv = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    await expect(assertOrgOwnsCard(db.client, missingKeyEnv, ORG, PAN)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(db.queries).toHaveLength(0);
  });

  it("does not accept a card handle from another org", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_cards: (query: RecordedQuery) => query.filters().some(({ col, val }) => col === "org_id" && val === ORG)
          ? []
          : [{ id: "card-1", org_id: OTHER_ORG, card_ref_hmac: cardRefHmac(env, OTHER_ORG, PAN) }],
      },
    });
    await expect(assertOrgOwnsCard(db.client, env, ORG, PAN)).rejects.toBeInstanceOf(HttpError);
  });
});

describe("assertProbeAllowed", () => {
  it("refuses production credentials by default", () => {
    expect(() => assertProbeAllowed(env, creds({ environment: "production" }))).toThrow(HttpError);
  });

  it("refuses the production endpoint even when credentials say sandbox", () => {
    expect(() => assertProbeAllowed(env, creds({ endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/" }))).toThrow(HttpError);
  });

  it("allows production credentials only with the explicit true override", () => {
    const overrideEnv = loadEnv({
      NODE_ENV: "test",
      SECRETS_ENCRYPTION_KEY: KEY,
      EFS_ALLOW_PRODUCTION_PROBE: "true",
    } as NodeJS.ProcessEnv);
    expect(() => assertProbeAllowed(overrideEnv, creds({ environment: "production" }))).not.toThrow();
  });
});

describe("resolveProbeCredentials", () => {
  // The ORDER is the security property, not an implementation detail: a PAN that this org does not
  // own must be refused before the credentials table is touched, so a fishing expedition cannot use
  // the 404-vs-409 difference to learn whether another company has EFS connected.
  it("refuses an unowned card without ever reading the credentials table", async () => {
    const db = createSupabaseRecorder({ tables: { efs_cards: [], efs_soap_credentials: [] } });
    await expect(resolveProbeCredentials(db.client, env, ORG, PAN)).rejects.toMatchObject({ status: 404 });
    expect(db.queries.map((q) => q.table)).toEqual(["efs_cards"]);
  });

  it("answers 409 when the org owns the card but EFS is switched off", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "card-1", org_id: ORG, card_ref_hmac: cardRefHmac(env, ORG, PAN) }],
        efs_soap_credentials: [],
      },
    });
    await expect(resolveProbeCredentials(db.client, env, ORG, PAN)).rejects.toMatchObject({
      status: 409,
      code: "efs_not_configured",
    });
  });

  it("skips the ownership read when no card is named", async () => {
    const db = createSupabaseRecorder({ tables: { efs_cards: [], efs_soap_credentials: [] } });
    await expect(resolveProbeCredentials(db.client, env, ORG)).rejects.toMatchObject({ status: 409 });
    expect(db.queries.some((q) => q.table === "efs_cards")).toBe(false);
  });
});

describe("resolveReadOnlyScanCredentials", () => {
  /**
   * The difference between the two resolvers, and the bug it fixes.
   *
   * The echo scan cannot write and its whole purpose is a sweep of the PRODUCTION account — Phase
   * 2's exit gate is "echo scan green across all 199 production cards". Routing it through
   * `resolveProbeCredentials` meant a 403 on that exact org, runnable only by setting a flag that
   * also unlocks two write probes against production.
   */
  const productionRow = {
    org_id: ORG,
    environment: "production",
    endpoint_url: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
    soap_username: "user",
    soap_password: "legacy-password",
    soap_password_sealed: null,
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
  };

  it("returns production credentials with no EFS_ALLOW_PRODUCTION_PROBE set", async () => {
    const db = createSupabaseRecorder({ tables: { efs_soap_credentials: [productionRow] } });
    await expect(resolveReadOnlyScanCredentials(db.client, env, ORG)).resolves.toMatchObject({
      environment: "production",
    });
  });

  it("is the ONLY difference — the gated resolver still refuses the same row", async () => {
    // Same row, same env, both resolvers. One 403s and one does not; nothing else varies. Without
    // this pairing the test above would pass just as well against a broken production gate.
    const db = createSupabaseRecorder({ tables: { efs_soap_credentials: [productionRow] } });
    await expect(resolveProbeCredentials(db.client, env, ORG)).rejects.toMatchObject({
      status: 403,
      code: "production_probe_forbidden",
    });
  });

  it("still refuses when EFS is not connected for the company", async () => {
    const db = createSupabaseRecorder({ tables: { efs_soap_credentials: [] } });
    await expect(resolveReadOnlyScanCredentials(db.client, env, ORG)).rejects.toMatchObject({
      status: 409,
      code: "efs_not_configured",
    });
  });
});
