import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { cardLockContract } from "@fuelguard/shared";
import { executeCapability, type CardMutationContext } from "./efsCardControl.js";
import { cardLockBehaviour } from "../efs/capabilities/cardLock.behaviour.js";
import { resolveCapability } from "../efs/orchestrator/resolve.js";

const ORG = "org-1";
const CARD_ID = "card-1";
const CARD = "70830000000000000";
const CARD_ACTIVE = readFileSync(
  fileURLToPath(new URL("../lib/__fixtures__/efs/getCardV2.full.xml", import.meta.url)),
  "utf8",
);
const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>session-1</result></loginResponse>");
const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_INTERACTIVE_TIMEOUT_MS: 10_000,
  EFS_CARD_WRITE_TIMEOUT_MS: 100,
  EFS_CARD_VERIFY_RETRY_MS: 0,
  EFS_CARD_MAX_MUTATIONS_PER_HOUR: 50,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
} as unknown as Env;
const creds = {
  orgId: ORG,
  environment: "sandbox" as const,
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
};

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("card mutation orchestration deadline", () => {
  it("aborts a stalled write and settles the ledger unverified", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_card_mutations: (query) =>
          query.write?.method === "insert"
            ? { data: { id: "mutation-1" }, error: null }
            : { data: [], error: null, count: 0 },
      },
    });
    let calls = 0;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response(loginOk, { status: 200 });
      if (calls === 2) return new Response(CARD_ACTIVE, { status: 200 });
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        const abort = () => reject(new Error("stalled request aborted"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }) as typeof fetch;
    const before = parseCardDocument(CARD_ACTIVE);
    const ctx: CardMutationContext = {
      admin: db.client,
      env,
      creds,
      orgId: ORG,
      efsCardId: CARD_ID,
      cardNumber: CARD,
      userId: "user-1",
      reason: "test",
      expectedVersion: before.version,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      fetchImpl,
    };

    // The shipped lock capability. Step 3.7 deleted CardMutationIntentSpec, and pointing this at
    // the real descriptor means the deadline is proven against the write that actually ships.
    const outcome = await executeCapability(ctx, resolveCapability(cardLockContract, cardLockBehaviour, {
      expectedVersion: ctx.expectedVersion, reason: ctx.reason, status: "Hold" as const,
    }));

    expect(outcome.status).toBe("sent");
    expect(db.writtenRows("efs_card_mutations").at(-1)).toMatchObject({ status: "sent" });
    expect(calls).toBe(3);
  });
});
