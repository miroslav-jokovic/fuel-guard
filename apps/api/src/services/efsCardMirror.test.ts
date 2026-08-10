import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { cardRefHmac, linkFuelCards, syncEfsCards } from "./efsCardMirror.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * Two things this suite exists to prove, both of which the type system cannot.
 *
 * 1. NO PLAINTEXT CARD NUMBER REACHES THE DATABASE. getCardSummaries returns the whole fleet's PANs in
 *    one response; every one of them passes through this service. The scan at the bottom is the
 *    mechanical proof, and it looks at what was actually written rather than at what we intended.
 * 2. EVERY QUERY IS ORG-SCOPED. getSupabaseAdmin is the SERVICE ROLE and bypasses RLS, so a dropped
 *    `.eq("org_id", …)` has no second line of defence. expectOrgScoped is the only thing that catches it.
 */

const ORG = "org-1";
const OTHER_ORG = "org-2";

const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  // 32 bytes, base64 — a test key, never a deploy key.
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as Env;

const creds: EfsSoapCredentials = {
  orgId: ORG,
  environment: "production",
  endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user", soapPassword: "pass", accountId: null,
  postedLastCursor: null, rejectedLastCursor: null,
  postedLastPolledAt: null, rejectedLastPolledAt: null,
  postedLastSuccessAt: null, rejectedLastSuccessAt: null,
  postedLastError: null, rejectedLastError: null,
  enabled: true, fromEnvFallback: false, tls: null,
};

const PAN_A = "70830000000000001";
const PAN_B = "70830000000000002";

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>sess-1</result></loginResponse>");
const cardDetail = readFileSync(
  fileURLToPath(new URL("../lib/__fixtures__/efs/getCardV2.full.xml", import.meta.url)), "utf8",
);

const summaries = soap(`<getCardSummariesV2Response><result>
  <value><cardNumber>${PAN_A}</cardNumber><policyNumber>14</policyNumber><unitNumber>3182</unitNumber>
    <driverId>D-4471</driverId><status>Active</status><override>0</override></value>
  <value><cardNumber>${PAN_B}</cardNumber><policyNumber>3</policyNumber><status>Hold</status><override>1</override></value>
</result></getCardSummariesV2Response>`);

function stub(...responses: string[]): typeof fetch {
  let i = 0;
  return (async () => new Response(responses[i++] ?? cardDetail, { status: 200 })) as typeof fetch;
}

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("syncEfsCards", () => {
  it("mirrors the roster and then deepens it with a per-card read", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, {
      fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail),
    });

    expect(result.cardsSeen).toBe(2);
    expect(result.upserted).toBe(2);
    expect(result.detailed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("NEVER writes a plaintext card number", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    const written = JSON.stringify(rec.writtenRows("efs_cards"));
    expect(written).not.toContain(PAN_A);
    expect(written).not.toContain(PAN_B);
    // The mechanical form of the same assertion: nothing card-number-shaped, whatever the column.
    expect(written).not.toMatch(/\d{12,}/);
  });

  it("stores the number sealed AND as a keyed lookup handle", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    const row = rec.writtenRows("efs_cards")[0]!;
    expect(String(row.card_number_sealed)).toMatch(/^v1\./); // secretBox envelope
    expect(String(row.card_ref_hmac)).toMatch(/^[0-9a-f]{64}$/);
    expect(row.card_last4).toBe("0001");
  });

  it("scopes every query to the org", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });
    expectOrgScoped(rec, ORG);
  });

  it("never writes to fuel_cards — attribution is not this service's job", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    // Two writers on one row is how both end up wrong; syncCardAssignments owns fuel_cards and its
    // manual rows are authoritative.
    expect(rec.forTable("fuel_cards").filter((q) => q.write !== null)).toHaveLength(0);
  });

  it("refuses to store anything when the sealing key is absent", async () => {
    // Matches saveSamsaraToken: refuse to persist rather than silently fall back to plaintext.
    const rec = createSupabaseRecorder({ tables: { efs_cards: [] } });
    const result = await syncEfsCards(rec.client, { ...env, SECRETS_ENCRYPTION_KEY: undefined } as Env, creds, {
      fetchImpl: stub(loginOk, summaries),
    });

    expect(result.errors[0]).toMatch(/SECRETS_ENCRYPTION_KEY/);
    expect(rec.writtenRows("efs_cards")).toHaveLength(0);
  });

  it("carries on when one card's detail read fails, and records why on that row", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, {
      fetchImpl: stub(loginOk, summaries, soap("<soap:Fault><faultstring>InvalidParameterNameID</faultstring></soap:Fault>"), cardDetail),
    });

    // One unreadable card must not abandon the other 399.
    expect(result.detailed).toBe(1);
    expect(result.failed).toBe(1);
    const errored = rec.forTable("efs_cards").find((q) => (q.write?.payload as { sync_error?: string })?.sync_error);
    expect(errored).toBeTruthy();
  });

  it("keeps card numbers out of its error messages", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: { writeError: { message: `card ${PAN_A} rejected` } }, fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    expect(result.errors.join(" ")).not.toContain(PAN_A);
    expect(result.errors.join(" ")).toMatch(/••••/);
  });

  it("stores a status EFS reports even when the getCard enum omits it", async () => {
    // 'Fraud' is only the `U` search code in getCardSummaries (p44). Coercing it to something familiar
    // would hide the single most important fact about that card.
    const fraud = soap(`<r><result><value><cardNumber>${PAN_A}</cardNumber><status>Fraud</status></value></result></r>`);
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, fraud, cardDetail) });

    expect(rec.writtenRows("efs_cards")[0]!.status).toBe("Fraud");
  });
});

describe("cardRefHmac", () => {
  it("is deterministic for one org and one card", () => {
    expect(cardRefHmac(env, ORG, PAN_A)).toBe(cardRefHmac(env, ORG, PAN_A));
  });

  it("does not correlate the same physical card across tenants", () => {
    // The org id is inside the MAC precisely so a shared card cannot be matched between customers.
    expect(cardRefHmac(env, ORG, PAN_A)).not.toBe(cardRefHmac(env, OTHER_ORG, PAN_A));
  });

  it("distinguishes two cards in one org", () => {
    expect(cardRefHmac(env, ORG, PAN_A)).not.toBe(cardRefHmac(env, ORG, PAN_B));
  });

  it("does not leak the card number into the handle", () => {
    expect(cardRefHmac(env, ORG, PAN_A)).not.toContain(PAN_A.slice(0, 8));
  });

  it("refuses to run without a key rather than falling back to an unkeyed digest", () => {
    // An unkeyed SHA-256 of a card number with a known BIN and known last four is a few million
    // guesses — that is not a lookup handle, it is the PAN with extra steps.
    expect(() => cardRefHmac({ ...env, SECRETS_ENCRYPTION_KEY: undefined } as Env, ORG, PAN_A)).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });
});

describe("linkFuelCards", () => {
  it("links when exactly one candidate matches", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", driver_id_prompt: "D-1" }],
        fuel_cards: [{ id: "fc-1", card_ref: "70830000000007521", card_last4: "7521" }],
      },
    });
    expect(await linkFuelCards(rec.client, ORG)).toBe(1);
    expect(rec.writtenRows("efs_cards")[0]).toMatchObject({ fuel_card_id: "fc-1" });
  });

  it("refuses to guess when two candidates share the last four", async () => {
    // WP3c documented the false "card assigned to a different truck" alerts a loose match produced.
    // A missing link reads as "not linked"; a wrong one attributes fuel to the wrong truck.
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", driver_id_prompt: null }],
        fuel_cards: [
          { id: "fc-1", card_ref: "70830000000007521", card_last4: "7521" },
          { id: "fc-2", card_ref: "70839999999997521", card_last4: "7521" },
        ],
      },
    });
    expect(await linkFuelCards(rec.client, ORG)).toBe(0);
    expect(rec.writtenRows("efs_cards")[0]).toMatchObject({ sync_error: "ambiguous_fuel_card_link" });
  });

  it("leaves a card with no candidate unlinked and silent", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "0000", driver_id_prompt: null }],
        fuel_cards: [{ id: "fc-1", card_ref: "70830000000007521", card_last4: "7521" }],
      },
    });
    expect(await linkFuelCards(rec.client, ORG)).toBe(0);
    expect(rec.writtenRows("efs_cards")).toHaveLength(0);
  });

  it("scopes its reads and its writes to the org", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ id: "efs-1", card_last4: "7521", driver_id_prompt: null }],
        fuel_cards: [{ id: "fc-1", card_ref: "70830000000007521", card_last4: "7521" }],
      },
    });
    await linkFuelCards(rec.client, ORG);
    expectOrgScoped(rec, ORG);
  });
});
