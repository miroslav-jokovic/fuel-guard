import { afterEach, describe, expect, it } from "vitest";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { cardRefHmac } from "./efsCardMirror.js";
import { pollEfsCardStatus } from "./efsCardStatusPoll.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";
import { staleAfterMinutes } from "../routes/read.js";

/**
 * The status poll (EFS audit, 2026-09-30). What it must prove, beyond the mirror's own suite:
 *  • a status that did not change writes no audit row and keeps the stored spelling (`HOLD` vs `Hold`);
 *  • a status that changed without us is re-read and gets an audit row naming both states;
 *  • a change our own write explains is not attributed to anyone else;
 *  • a poll where a large share of the fleet "changes" at once is held back, not written;
 *  • every query is org-scoped and no PAN is written in the clear.
 */

const ORG = "org-1";
const env = testEnv({
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
});
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

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>sess-1</result></loginResponse>");
const pan = (n: number) => `708300000000${String(n).padStart(5, "0")}`;
const roster = (cards: { n: number; status: string }[]) =>
  soap(`<getCardSummariesV2Response><result>${cards
    .map((c) => `<value><cardNumber>${pan(c.n)}</cardNumber><policyNumber>1</policyNumber><status>${c.status}</status><override>0</override></value>`)
    .join("")}</result></getCardSummariesV2Response>`);
const cardDetail = soap(
  "<getCardv2Response><result><header><status>Hold</status><policyNumber>1</policyNumber><handEnter>POLICY</handEnter>" +
    "<infoSource>POLICY</infoSource><limitSource>POLICY</limitSource><payrollStatus>Inactive</payrollStatus></header></result></getCardv2Response>",
);

/** A vendor stub that counts per-card reads, so a test can say how many `getCardv2`s the poll spent. */
function vendor(first: string[]) {
  let i = 0;
  const calls = { detail: 0 };
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = String(init?.body ?? "");
    if (/getCardv2/i.test(body) && !/Summar/i.test(body)) calls.detail++;
    return new Response(first[i++] ?? cardDetail, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const mirrorRow = (n: number, status: string) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  card_ref_hmac: cardRefHmac(env, ORG, pan(n)),
  status,
});

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("pollEfsCardStatus", () => {
  it("an unchanged status spelled differently is no change: no audit, no detail read, stored spelling kept", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [mirrorRow(1, "ACTIVE"), mirrorRow(2, "HOLD")], efs_card_mutations: [], audit_logs: [] } });
    const v = vendor([loginOk, roster([{ n: 1, status: "Active" }, { n: 2, status: "Hold" }])]);
    const result = await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expect(result).toMatchObject({ cardsSeen: 2, statusChanges: 0, externalChanges: 0, newCards: 0, detailed: 0, refused: false });
    expect(v.calls.detail).toBe(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
    expect(rec.writtenRows("efs_cards").map((r) => r.status)).toEqual(["ACTIVE", "HOLD"]);
    // The roster clock still moved — that is the whole point of polling.
    expect(rec.writtenRows("efs_cards").every((r) => typeof r.synced_at === "string")).toBe(true);
  });

  it("a status changed outside Silvicom 360 is written, re-read once, and audited with both states", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [mirrorRow(1, "ACTIVE"), mirrorRow(2, "ACTIVE")], efs_card_mutations: [], audit_logs: [] } });
    const v = vendor([loginOk, roster([{ n: 1, status: "ACTIVE" }, { n: 2, status: "HOLD" }])]);
    const result = await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expect(result).toMatchObject({ statusChanges: 1, externalChanges: 1, detailed: 1, refused: false });
    expect(v.calls.detail).toBe(1);
    const audits = rec.writtenRows("audit_logs");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      org_id: ORG,
      actor_id: null,
      action: "card.status_changed_externally",
      entity: "efs_cards",
      entity_id: mirrorRow(2, "").id,
      meta: { from: "ACTIVE", to: "HOLD", last4: "0002", via: "efs_status_poll" },
    });
    expect(rec.writtenRows("efs_cards").some((r) => r.status === "HOLD")).toBe(true);
  });

  it("a change on a card we wrote to in the last fifteen minutes is ours, and nobody else is named for it", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [mirrorRow(1, "ACTIVE"), mirrorRow(2, "ACTIVE")],
        efs_card_mutations: [{ efs_card_id: mirrorRow(2, "").id }],
        audit_logs: [],
      },
    });
    const v = vendor([loginOk, roster([{ n: 1, status: "ACTIVE" }, { n: 2, status: "HOLD" }])]);
    const result = await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expect(result).toMatchObject({ statusChanges: 1, externalChanges: 0 });
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
    // The ledger read asks about THIS org's recent writes on the changed cards, and nothing wider.
    const ledger = rec.forTable("efs_card_mutations")[0]!;
    expect(ledger.filters()).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG },
      { col: "efs_card_id", val: [mirrorRow(2, "").id] },
    ]));
    expect(ledger.ops.some((o) => o.method === "gte" && o.args[0] === "created_at")).toBe(true);
  });

  it("a new card is mirrored and read once, and is not an external change", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [mirrorRow(1, "ACTIVE")], efs_card_mutations: [], audit_logs: [] } });
    const v = vendor([loginOk, roster([{ n: 1, status: "ACTIVE" }, { n: 2, status: "INACTIVE" }])]);
    const result = await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expect(result).toMatchObject({ newCards: 1, statusChanges: 0, externalChanges: 0, detailed: 1 });
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("a fleet-wide 'change' in one poll is held back: stored statuses kept, no audit, no detail reads", async () => {
    const cards = Array.from({ length: 10 }, (_, k) => k + 1);
    const rec = createSupabaseRecorder({ tables: { efs_cards: cards.map((n) => mirrorRow(n, "ACTIVE")), efs_card_mutations: [], audit_logs: [] } });
    // The shape of the failure the guard is for: the roster spelling a state the detail read does not.
    const v = vendor([loginOk, roster(cards.map((n) => ({ n, status: "A" })))]);
    const result = await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expect(result).toMatchObject({ statusChanges: 10, refused: true, externalChanges: 0, detailed: 0 });
    expect(v.calls.detail).toBe(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
    expect(new Set(rec.writtenRows("efs_cards").map((r) => r.status))).toEqual(new Set(["ACTIVE"]));
  });

  it("up to five changes pass the guard on a small fleet — two cards locked at once is ordinary", async () => {
    const cards = Array.from({ length: 10 }, (_, k) => k + 1);
    const rec = createSupabaseRecorder({ tables: { efs_cards: cards.map((n) => mirrorRow(n, "ACTIVE")), efs_card_mutations: [], audit_logs: [] } });
    const v = vendor([loginOk, roster(cards.map((n) => ({ n, status: n <= 5 ? "HOLD" : "ACTIVE" })))]);
    const result = await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expect(result).toMatchObject({ statusChanges: 5, refused: false, externalChanges: 5 });
  });

  it("an empty roster writes nothing — a vendor blip is not a fleet with no cards", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [mirrorRow(1, "ACTIVE")], efs_card_mutations: [], audit_logs: [] } });
    const v = vendor([loginOk, roster([])]);
    const result = await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expect(result.cardsSeen).toBe(0);
    expect(rec.writtenRows("efs_cards")).toHaveLength(0);
  });

  it("scopes every query to the org and never writes a card number in the clear", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [mirrorRow(1, "ACTIVE")], efs_card_mutations: [], audit_logs: [] } });
    const v = vendor([loginOk, roster([{ n: 1, status: "HOLD" }, { n: 2, status: "ACTIVE" }])]);
    await pollEfsCardStatus(rec.client, env, creds, { fetchImpl: v.fetchImpl });
    expectOrgScoped(rec, ORG);
    const written = JSON.stringify([...rec.writtenRows("efs_cards"), ...rec.writtenRows("audit_logs")]);
    expect(written).not.toContain(pan(1));
    expect(written).not.toContain(pan(2));
  });
});

describe("staleAfterMinutes (the roster clock)", () => {
  it("is three missed polls, never under fifteen minutes", () => {
    expect(staleAfterMinutes({ EFS_CARD_SYNC_HOURS: 24, EFS_CARD_STATUS_POLL_MINUTES: 5 })).toBe(15);
    expect(staleAfterMinutes({ EFS_CARD_SYNC_HOURS: 24, EFS_CARD_STATUS_POLL_MINUTES: 1 })).toBe(15);
    expect(staleAfterMinutes({ EFS_CARD_SYNC_HOURS: 24, EFS_CARD_STATUS_POLL_MINUTES: 10 })).toBe(30);
  });

  it("with the poll off, falls back to the daily sweep plus two hours", () => {
    expect(staleAfterMinutes({ EFS_CARD_SYNC_HOURS: 24, EFS_CARD_STATUS_POLL_MINUTES: 0 })).toBe(24 * 60 + 120);
  });
});
