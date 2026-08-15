import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { seal, secretAad } from "../lib/secretBox.js";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";
import { resolveUnresolvedMutations } from "./efsCardUnresolved.js";

/**
 * Settling the rows nobody could settle live — and the class of row that could never be settled.
 *
 * Before Step 3.9 this pass skipped any row with an empty edit list, which is EVERY `direct`
 * mutation: a dedicated vendor op writes no edits, so `deleteOverride` rows sat on the operator's
 * "Unverified" list forever with the answer one read away. The module had no test file at all,
 * which is why the gap survived being read several times.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const PAN = "70830000000000000";

const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_BACKFILL_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  EFS_CARD_SYNC_HOURS: 24,
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
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
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

/** `<override>0</override>` — the exception is gone, so a clear DID land. */
const CARD_CLEARED = fixture("getCardV2.full.xml");
/** The exception is still outstanding, so it did NOT. */
const CARD_STILL_OVERRIDDEN = CARD_CLEARED.replace("<override>0</override>", "<override>2</override>");

/** Two days old: past both the live in-flight window and a full EFS_CARD_SYNC_HOURS cycle. */
const OLD = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

interface RowOverrides {
  capability_key?: string | null;
  edits?: unknown[];
  request_body?: unknown;
}

const sentRow = (over: RowOverrides = {}) => ({
  id: "mutation-1",
  efs_card_id: CARD_ID,
  status: "sent",
  created_at: OLD,
  edits: over.edits ?? [],
  capability_key: over.capability_key === undefined ? "delete_override" : over.capability_key,
  request_body: over.request_body ?? { expectedVersion: "x".repeat(16), reason: "done" },
});

function recorder(row: Record<string, unknown>): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      efs_card_mutations: (query) =>
        query.write ? { data: null, error: null } : { data: [row], error: null },
      efs_cards: { data: { id: CARD_ID, card_number_sealed: seal(env, PAN, secretAad(ORG, "efs_card_pan")) }, error: null },
    },
  });
}

function stub(...responses: string[]): { fetchImpl: typeof fetch; bodies: string[] } {
  let i = 0;
  const bodies: string[] = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    const next = responses[i++];
    if (next === undefined) throw new Error("the stub ran out of scripted responses");
    return new Response(next, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

const settled = (rec: SupabaseRecorder) => rec.writtenRows("efs_card_mutations").at(-1) ?? {};

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

describe("an unverified direct op is reconciled through its own predicate", () => {
  it("settles an unverified deleteOverride as succeeded when the exception is gone", async () => {
    const rec = recorder(sentRow());
    const s = stub(loginOk, CARD_CLEARED);

    const result = await resolveUnresolvedMutations(rec.client, env, creds, { fetchImpl: s.fetchImpl });

    // The row this pass could never touch before 3.9: no edits, so nothing to hand `editsLanded`.
    expect(result.reconciledSucceeded).toBe(1);
    expect(settled(rec)).toMatchObject({ status: "succeeded" });
    expect(rec.writtenRows("audit_logs").at(-1)?.meta)
      .toMatchObject({ outcome: "succeeded", judgedBy: "delete_override" });
  });

  it("settles it failed when the exception is still outstanding", async () => {
    const rec = recorder(sentRow());
    const s = stub(loginOk, CARD_STILL_OVERRIDDEN);

    const result = await resolveUnresolvedMutations(rec.client, env, creds, { fetchImpl: s.fetchImpl });

    // The pair matters: a predicate that always answered "landed" would satisfy the case above.
    expect(result.reconciledFailed).toBe(1);
    expect(settled(rec)).toMatchObject({ status: "failed", efs_fault_code: "no_change" });
  });

  it("reads through the capability's OWN snapshot", async () => {
    const rec = recorder(sentRow());
    const s = stub(loginOk, CARD_CLEARED);

    await resolveUnresolvedMutations(rec.client, env, creds, { fetchImpl: s.fetchImpl });

    // Asserted on the wire. `delete_override`'s snapshot is a getCardv2 today, so this pins the
    // mechanism rather than the op: the read comes from the descriptor, which is what will let a
    // capability whose state lives outside the card document be reconciled without a second code
    // path in the sweep (docs/27 §3.3).
    expect(s.bodies.at(-1)).toContain("CardManagementEP_getCardv2");
  });
});

describe("rows the sweep must leave alone", () => {
  it("skips a row whose capability_key names nothing this build declares", async () => {
    const rec = recorder(sentRow({ capability_key: "capability_that_was_deleted" }));
    const s = stub(loginOk, CARD_CLEARED);

    const result = await resolveUnresolvedMutations(rec.client, env, creds, { fetchImpl: s.fetchImpl });

    // Settling it with some other capability's predicate would answer a question this code can no
    // longer ask. Leaving it visible is the honest outcome.
    expect(result.reconciledSucceeded + result.reconciledFailed).toBe(0);
    expect(rec.writtenRows("efs_card_mutations")).toHaveLength(0);
  });

  it("still reconciles a pre-registry echo row, which has no capability_key at all", async () => {
    const rec = recorder(sentRow({
      capability_key: null,
      edits: [{ op: "setField", name: "status", value: "Active" }],
    }));
    const s = stub(loginOk, CARD_CLEARED);

    const result = await resolveUnresolvedMutations(rec.client, env, creds, { fetchImpl: s.fetchImpl });

    // Every row written before Step 3.5 has a null capability_key. Those keep the behaviour they
    // were written under — `editsLanded` against the card as it stands.
    expect(result.reconciledSucceeded).toBe(1);
    expect(rec.writtenRows("audit_logs").at(-1)?.meta).toMatchObject({ judgedBy: "edits_landed" });
  });
});
