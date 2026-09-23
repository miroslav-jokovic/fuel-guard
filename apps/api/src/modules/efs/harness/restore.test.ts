import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import { capabilityRegistry } from "../registry.js";
import { restoreFromLedger, type RestoreRow } from "./restore.js";

/**
 * Restoring a card from a proof's ledger row, through the real registry and orchestrator.
 *
 * The case that motivated it is proof `efe2b98a` on ••••6122 (2026-09-23): the prompts flip landed,
 * the revert failed, and the card's earlier UNIT prompt existed only in `before_document`.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const USER = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const CARD = "70830000000000000";

const env = testEnv({
  EFS_SOAP_MAX_RPS: 100, EFS_SOAP_INTERACTIVE_RPS: 100, EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90, EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  EFS_SOAP_INTERACTIVE_TIMEOUT_MS: 10_000, EFS_CARD_WRITE_TIMEOUT_MS: 25_000,
  EFS_CARD_MAX_MUTATIONS_PER_HOUR: 50, EFS_CARD_VERIFY_RETRY_MS: 0,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
});

const creds: EfsSoapCredentials = {
  orgId: ORG, environment: "sandbox",
  endpointUrl: "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/",
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

const ACTIVE = readFileSync(
  fileURLToPath(new URL("../lib/__fixtures__/efs/getCardV2.full.xml", import.meta.url)), "utf8",
);
const HELD = ACTIVE.replace("<status>Active</status>", "<status>HOLD</status>");
/** ••••6122's shape: UNIT flipped from EXACT_MATCH "3182" to REPORT_ONLY with the value blanked. */
const UNIT_EXACT = "<infoId>UNIT</infoId>\n          <lengthCheck>false</lengthCheck>\n          <matchValue>3182</matchValue>";
const FLIPPED = ACTIVE
  .replace(UNIT_EXACT, UNIT_EXACT.replace("<matchValue>3182</matchValue>", "<matchValue></matchValue>"))
  .replace(/(<infoId>UNIT<\/infoId>[\s\S]*?<validationType>)EXACT_MATCH/, "$1REPORT_ONLY");
const SOMEONE_ELSE = ACTIVE.replace("<status>Active</status>", "<status>INACTIVE</status>");

const doc = (xml: string) => parseCardDocument(xml);

/** Scripted responses, and every request body, so a test can say what was — and was not — sent. */
function vendor(...responses: string[]) {
  const sent: string[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    const next = responses[i++];
    if (next === undefined) throw new Error(`the stub ran out of scripted responses after ${i - 1}`);
    return new Response(next, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, sent, writes: () => sent.filter((b) => b.includes("setCardv2")) };
}

function ctxWith(fetchImpl: typeof fetch): CardMutationContext {
  const rec = createSupabaseRecorder({
    tables: {
      efs_card_mutations: (q) =>
        q.write?.method === "insert" ? { data: { id: "restore-1" }, error: null } : { data: [], error: null, count: 0 },
      efs_cards: { data: { id: CARD_ID }, error: null },
    },
  });
  return {
    admin: rec.client, env, creds, orgId: ORG, fetchImpl,
    efsCardId: CARD_ID, cardNumber: CARD, userId: USER, expectedVersion: "", idempotencyKey: null, stepUp: true,
  };
}

/** A proof's own apply row, as the ledger holds it: the card view before, and both versions. */
const proofRow = (capability: string, beforeXml: string, afterXml: string, over: Partial<RestoreRow> = {}): RestoreRow => ({
  id: "mutation-1",
  capabilityKey: capability,
  proofRunId: "proof-1",
  proofCapabilityKey: capability,
  beforeVersion: doc(beforeXml).version,
  afterVersion: doc(afterXml).version,
  beforeCard: doc(beforeXml).card,
  ...over,
});

const capabilities = capabilityRegistry();

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("restoreFromLedger puts a proof's card back", () => {
  it("restores a flipped prompt with its value, through prompts_set (the ••••6122 case)", async () => {
    // restore read · plan read · pre-write re-read · write · verify · final read
    const v = vendor(loginOk, FLIPPED, FLIPPED, FLIPPED, soap(""), ACTIVE, ACTIVE);
    const result = await restoreFromLedger(ctxWith(v.fetchImpl), proofRow("prompts_set", ACTIVE, FLIPPED), capabilities);

    expect(result).toMatchObject({ outcome: "restored", mutationStatus: "succeeded", matchesBefore: true });
    expect(v.writes()).toHaveLength(1);
    // The value came from the LEDGER: the card being written carried no "3182" at all.
    expect(v.writes()[0]).toMatch(/<infoId>UNIT<\/infoId>[\s\S]*?<matchValue>3182<\/matchValue>[\s\S]*?<validationType>EXACT_MATCH/);
  });

  it("restores a status through the capability's own undo", async () => {
    const v = vendor(loginOk, HELD, HELD, HELD, soap(""), ACTIVE, ACTIVE);
    const result = await restoreFromLedger(ctxWith(v.fetchImpl), proofRow("card_lock", ACTIVE, HELD), capabilities);

    expect(result.outcome).toBe("restored");
    expect(v.writes()[0]).toMatch(/<status>ACTIVE<\/status>|<status>Active<\/status>/);
  });

  it("says so, and sends nothing, when the card already reads as before", async () => {
    const v = vendor(loginOk, ACTIVE);
    const result = await restoreFromLedger(ctxWith(v.fetchImpl), proofRow("prompts_set", ACTIVE, FLIPPED), capabilities);

    expect(result.outcome).toBe("already_restored");
    expect(v.writes()).toEqual([]);
  });

  it("reports a restore whose write did not bring the card all the way back", async () => {
    // The write lands but the final read shows another field moved too: not "restored".
    const v = vendor(loginOk, FLIPPED, FLIPPED, FLIPPED, soap(""), ACTIVE, SOMEONE_ELSE);
    const result = await restoreFromLedger(ctxWith(v.fetchImpl), proofRow("prompts_set", ACTIVE, FLIPPED), capabilities);

    expect(result).toMatchObject({ outcome: "not_restored", matchesBefore: false });
    expect(result.detail).toMatch(/Check the card in the WEX portal/);
  });
});

describe("restoreFromLedger refuses what it must not write", () => {
  it("never writes over a card that changed after the proof", async () => {
    const v = vendor(loginOk, SOMEONE_ELSE);
    const result = await restoreFromLedger(ctxWith(v.fetchImpl), proofRow("prompts_set", ACTIVE, FLIPPED), capabilities);

    expect(result.outcome).toBe("refused");
    expect(result.detail).toMatch(/has changed since that write[\s\S]*Nothing was sent/);
    expect(v.writes()).toEqual([]);
  });

  it("refuses an operator's change: this is proof cleanup, not a second write path", async () => {
    const v = vendor();
    const result = await restoreFromLedger(
      ctxWith(v.fetchImpl), proofRow("card_lock", ACTIVE, HELD, { proofRunId: null, proofCapabilityKey: null }), capabilities,
    );

    expect(result.outcome).toBe("refused");
    // The reason matters: the revert-row refusal would also fire here, and it would send an operator
    // looking for a proof that never existed.
    expect(result.detail).toMatch(/Only a capability proof's own write/);
    expect(v.sent).toEqual([]);
  });

  it("refuses the proof's REVERT row, which would re-apply the proof's change", async () => {
    // A card_lock proof's revert is a card_unlock row under the same proof id.
    const v = vendor();
    const result = await restoreFromLedger(
      ctxWith(v.fetchImpl), proofRow("card_unlock", HELD, ACTIVE, { proofCapabilityKey: "card_lock" }), capabilities,
    );

    expect(result.outcome).toBe("refused");
    expect(result.detail).toMatch(/most likely the proof's revert/);
    expect(v.sent).toEqual([]);
  });

  it("refuses a row that does not record where the card was", async () => {
    const v = vendor();
    const result = await restoreFromLedger(
      ctxWith(v.fetchImpl), proofRow("prompts_set", ACTIVE, FLIPPED, { afterVersion: null }), capabilities,
    );

    expect(result.outcome).toBe("refused");
    expect(v.sent).toEqual([]);
  });
});
