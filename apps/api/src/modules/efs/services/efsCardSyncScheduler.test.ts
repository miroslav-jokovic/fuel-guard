import { describe, expect, it } from "vitest";
import { isEfsCardSyncDue, orgsForStatusPoll } from "./efsCardSyncScheduler.js";
import { efsSoapOrgs, orgsWithEfsSoap } from "./efsSoapCredentials.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("isEfsCardSyncDue", () => {
  it("runs when there is no successful mirror sweep yet", () => {
    expect(isEfsCardSyncDue(null, NOW, DAY)).toBe(true);
  });

  it("skips a successful sweep within the configured cadence", () => {
    expect(isEfsCardSyncDue("2026-08-10T12:01:00.000Z", NOW, DAY)).toBe(false);
    expect(isEfsCardSyncDue("2026-08-10T12:00:00.000Z", NOW, DAY)).toBe(true);
  });

  it("runs when the stored timestamp is invalid so a bad ledger value cannot disable refresh forever", () => {
    expect(isEfsCardSyncDue("not-a-timestamp", NOW, DAY)).toBe(true);
  });
});

const PROD_ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";
const QA_ORG = "07fe4058-cc72-4a69-b3e9-29b4cf1c6a44";
const ENV_ORG = "11111111-2222-4333-8444-555555555555";

/** Env with a complete single-tenant fallback bound to `ENV_ORG` in the given environment. */
const fallbackEnv = (environment: "sandbox" | "production") =>
  testEnv({
    EFS_SOAP_ENABLED: true,
    EFS_SOAP_ORG_ID: ENV_ORG,
    EFS_SOAP_ENDPOINT_URL: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
    EFS_SOAP_USERNAME: "user",
    EFS_SOAP_PASSWORD: "secret",
    EFS_SOAP_ENVIRONMENT: environment,
  });
const noFallbackEnv = testEnv({ EFS_SOAP_ENABLED: true, EFS_SOAP_ORG_ID: undefined });

/**
 * The credentials table answered by the filters the query applied, never a flat array — the recorder
 * does not filter, so a flat fixture would answer a per-org lookup with every org's row.
 */
const credentials = (rows: Array<{ org_id: string; enabled: boolean; environment: string | null }>) =>
  createSupabaseRecorder({
    tables: {
      efs_soap_credentials: (q: RecordedQuery) => {
        const f = q.filters();
        const enabled = f.find((x) => x.col === "enabled");
        const org = f.find((x) => x.col === "org_id");
        return rows.filter(
          (r) => (enabled == null || r.enabled === enabled.val) && (org == null || r.org_id === org.val),
        );
      },
    },
  });

describe("orgsForStatusPoll", () => {
  /**
   * Measured 2026-10-07: 466 of 466 status-poll failures in a week were the QA org on EFS's sandbox;
   * the production fleet had none. The few-minute poll covers production only.
   */
  it("polls production orgs and leaves sandbox orgs out", () => {
    expect(
      orgsForStatusPoll([
        { orgId: PROD_ORG, environment: "production" },
        { orgId: QA_ORG, environment: "sandbox" },
      ]),
    ).toEqual([PROD_ORG]);
  });

  it("polls nobody when every org is on the sandbox", () => {
    expect(orgsForStatusPoll([{ orgId: QA_ORG, environment: "sandbox" }])).toEqual([]);
  });
});

describe("efsSoapOrgs — each configured org and the EFS it talks to", () => {
  it("reads each enabled row's environment, treating anything but production as the sandbox", async () => {
    const rec = credentials([
      { org_id: PROD_ORG, enabled: true, environment: "production" },
      { org_id: QA_ORG, enabled: true, environment: "sandbox" },
      { org_id: ENV_ORG, enabled: true, environment: null },
    ]);
    expect(await efsSoapOrgs(rec.client, noFallbackEnv)).toEqual([
      { orgId: PROD_ORG, environment: "production" },
      { orgId: QA_ORG, environment: "sandbox" },
      { orgId: ENV_ORG, environment: "sandbox" },
    ]);
  });

  it("leaves a disabled row out, exactly as before", async () => {
    const rec = credentials([
      { org_id: PROD_ORG, enabled: true, environment: "production" },
      { org_id: QA_ORG, enabled: false, environment: "sandbox" },
    ]);
    expect(await orgsWithEfsSoap(rec.client, noFallbackEnv)).toEqual([PROD_ORG]);
  });

  it("takes the env-bound org's environment from the deploy variable when it has no row", async () => {
    const rec = credentials([]);
    expect(await efsSoapOrgs(rec.client, fallbackEnv("production"))).toEqual([
      { orgId: ENV_ORG, environment: "production" },
    ]);
    expect(await efsSoapOrgs(credentials([]).client, fallbackEnv("sandbox"))).toEqual([
      { orgId: ENV_ORG, environment: "sandbox" },
    ]);
  });

  it("lets the env-bound org's own ROW name its environment, as getEfsSoapCredentials does", async () => {
    // A disabled sandbox row still wins over a production deploy variable: it is the row
    // getEfsSoapCredentials returns, so it is the EFS a poll for this org would actually reach.
    const rec = credentials([{ org_id: ENV_ORG, enabled: false, environment: "sandbox" }]);
    expect(await efsSoapOrgs(rec.client, fallbackEnv("production"))).toEqual([
      { orgId: ENV_ORG, environment: "sandbox" },
    ]);
  });

  it("adds no org from an unbound fallback", async () => {
    const env = { ...fallbackEnv("production"), EFS_SOAP_ORG_ID: undefined };
    expect(await efsSoapOrgs(credentials([]).client, env)).toEqual([]);
  });
});
