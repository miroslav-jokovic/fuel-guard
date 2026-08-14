import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardUnlockContract } from "@fuelguard/shared";
import type { Env } from "../../env.js";
import { parseCardDocument } from "../../lib/efsCardXml.js";
import { __resetEfsSessions } from "../../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../../lib/soapClient.js";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";
import { executeCapability } from "../../services/efsCardControl.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { resolveCapability } from "../orchestrator/resolve.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import { FRAUD_STEP_UP, cardUnlockBehaviour } from "./cardUnlock.behaviour.js";

/**
 * The fraud step-up, which had NO test before Step 3.6 moved it.
 *
 * That is the reason this file exists rather than a note in a commit message. The hand-written
 * handler asked twice — once against the mirror, once against the fresh document — and neither ask
 * was covered by anything. Migrating the gate meant deleting one of the two asks, and deleting an
 * uncovered guard on the strength of reading it is exactly the move that has gone wrong in this
 * workstream before.
 *
 * Every case here drives the REAL behaviour through the real orchestrator against a scripted vendor,
 * so what is asserted is what a request would do.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const USER = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const CARD = "70830000000000000";

const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  EFS_SOAP_INTERACTIVE_TIMEOUT_MS: 10_000,
  EFS_CARD_WRITE_TIMEOUT_MS: 25_000,
  EFS_CARD_MAX_MUTATIONS_PER_HOUR: 50,
  EFS_CARD_VERIFY_RETRY_MS: 0,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
} as unknown as Env;

const creds: EfsSoapCredentials = {
  orgId: ORG, environment: "production",
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
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

const ACTIVE = fixture("getCardV2.full.xml");
const HELD = ACTIVE.replace("<status>Active</status>", "<status>Hold</status>");
/**
 * UPPER-CASE, deliberately. This account reports `FRAUD`, and an `===` comparison waved the unlock
 * straight past the gate — the same casing fault as the 2026-08-12 lock incident, on the field that
 * decides whether a password is demanded.
 */
const FRAUD = ACTIVE.replace("<status>Active</status>", "<status>FRAUD</status>");

const versionOf = (xml: string) => parseCardDocument(xml).version;

function stub(...responses: string[]): typeof fetch {
  let i = 0;
  return (async () => {
    const next = responses[i++];
    if (next === undefined) throw new Error("the stub ran out of scripted responses");
    return new Response(next, { status: 200 });
  }) as typeof fetch;
}

const recorder = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      efs_card_mutations: (query) =>
        query.write?.method === "insert"
          ? { data: { id: "mutation-1" }, error: null }
          : { data: [], error: null, count: 0 },
      efs_cards: { data: { id: CARD_ID }, error: null },
    },
  });

const ctxFor = (rec: SupabaseRecorder, fetchImpl: typeof fetch, xml: string, stepUp: boolean): CardMutationContext => ({
  admin: rec.client, env, creds, orgId: ORG, fetchImpl,
  efsCardId: CARD_ID, cardNumber: CARD, userId: USER,
  reason: "Card recovered",
  expectedVersion: versionOf(xml),
  idempotencyKey: null,
  stepUp,
});

const unlock = (xml: string, stepUp: boolean, rec: SupabaseRecorder) =>
  executeCapability(
    ctxFor(rec, stub(loginOk, xml, soap(""), ACTIVE), xml, stepUp),
    resolveCapability(cardUnlockContract, cardUnlockBehaviour, { expectedVersion: versionOf(xml), reason: "Card recovered" }),
  );

const inserted = (rec: SupabaseRecorder) =>
  rec.forTable("efs_card_mutations").filter((q) => q.write?.method === "insert");

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

describe("unlocking a card EFS has flagged for fraud", () => {
  it("refuses without a fresh sign-in, in the account's own casing, before any row exists", async () => {
    const rec = recorder();
    const error = await unlock(FRAUD, false, rec).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ActionRefusalError);
    expect((error as ActionRefusalError).code).toBe("step_up_required");
    expect((error as ActionRefusalError).message).toBe(FRAUD_STEP_UP);
    // Refused after the fresh read and BEFORE the ledger opened: no row, no dispatch, no
    // half-finished record of a change that never happened.
    expect(inserted(rec)).toHaveLength(0);
  });

  it("lets the same card through once the caller has re-authenticated", async () => {
    const rec = recorder();
    const outcome = await unlock(FRAUD, true, rec);

    // The pair matters. Without it, a `planStepUp` that refused unconditionally — or one the
    // orchestrator never called — would satisfy the case above for the wrong reason.
    expect(outcome.status).toBe("succeeded");
    expect(inserted(rec)).toHaveLength(1);
  });

  it("does not demand a password to unlock an ordinary held card", async () => {
    const rec = recorder();
    const outcome = await unlock(HELD, false, rec);

    // The gate is narrow on purpose. Unlocking is the other half of the 2am sequence, and friction
    // on the ordinary path has a cost measured in a driver waiting at a pump.
    expect(outcome.status).toBe("succeeded");
  });

  it("records the fraud release in the audit meta, read from the document EFS returned", async () => {
    const rec = recorder();
    await unlock(FRAUD, true, rec);

    // Sourced from the same document the gate judged, so the audit row cannot disagree with the
    // decision that let the write through — the mirror the old handler also consulted is gone.
    expect(rec.writtenRows("audit_logs").at(-1)?.meta).toMatchObject({
      unlockedFromFraud: true,
      statusBefore: "FRAUD",
    });
  });
});
