import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { CardControlError, executeCardMutation, type CardMutationContext } from "./efsCardControl.js";
import { lockEdits } from "./efsCardEdits.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * The reconciliation matrix — the part of card control that decides what we tell a human happened.
 *
 * Every outcome is asserted on the LEDGER ROW, not on the return value alone: the return value is
 * gone the moment the response is sent, and the row is what somebody reads next week when they ask
 * why a card was locked. A mutation that returns "succeeded" without leaving a settled row would pass
 * a weaker version of these tests and be worthless in the only situation that matters.
 */

// Hex uuids with letters in every group, deliberately. An all-digit uuid like
// "11111111-1111-1111-1111-111111111111" ends in a twelve-digit run, which the PAN scan below reads
// as a card number — a false failure caused entirely by the test's own fixtures.
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const USER = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const CARD = "70830000000000000";

const env = {
  EFS_SOAP_MAX_RPS: 100,
  // The interactive lane defaults to 1 rps. Left at the default these suites spend most of their
  // wall clock inside the pacer proving nothing.
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  EFS_SOAP_INTERACTIVE_TIMEOUT_MS: 10_000,
  EFS_CARD_WRITE_TIMEOUT_MS: 25_000,
  EFS_CARD_MAX_MUTATIONS_PER_HOUR: 50,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
} as unknown as Env;

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
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

const CARD_ACTIVE = fixture("getCardV2.full.xml");
const CARD_HELD = CARD_ACTIVE.replace("<status>Active</status>", "<status>Hold</status>");
/** Held, and somebody in the WEX portal also moved the policy — the drift case. */
const CARD_HELD_AND_DRIFTED = CARD_HELD.replace("<policyNumber>14</policyNumber>", "<policyNumber>27</policyNumber>");

const versionOf = (xml: string) => parseCardDocument(xml).version;

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

/** A recorder whose ledger insert returns an id, and whose hourly-cap count is zero. */
function recorder(overrides: Record<string, unknown> = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      efs_card_mutations: (query) =>
        query.write?.method === "insert"
          ? { data: { id: "mutation-1" }, error: null }
          : { data: [], error: null, count: 0 },
      efs_cards: { data: { id: CARD_ID }, error: null },
      ...overrides,
    },
  });
}

const ctxFor = (rec: SupabaseRecorder, fetchImpl: typeof fetch, expectedVersion: string): CardMutationContext => ({
  admin: rec.client, env, creds, orgId: ORG, fetchImpl,
  efsCardId: CARD_ID, cardNumber: CARD, userId: USER,
  reason: "Truck broken into overnight",
  expectedVersion,
  idempotencyKey: null,
  stepUp: false,
});

const spec = {
  intent: "lock" as const,
  auditAction: "card.locked",
  buildEdits: () => lockEdits("Hold"),
};

/** The ledger row as it was finally settled. */
const settled = (rec: SupabaseRecorder) =>
  rec.writtenRows("efs_card_mutations").at(-1) ?? {};

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

describe("a mutation that lands", () => {
  it("writes pending, then succeeded, and audits the intent", async () => {
    const rec = recorder();
    // login → fresh read → setCardV2 → verifying re-read → mirror refresh read
    const s = stub(loginOk, CARD_ACTIVE, soap(""), CARD_HELD, CARD_HELD);
    const outcome = await executeCardMutation(
      { ...ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), reason: "Truck broken into overnight" },
      spec,
    );

    expect(outcome.status).toBe("succeeded");
    const rows = rec.writtenRows("efs_card_mutations");
    // The FIRST write is the pending row, before anything was dispatched. That ordering is the whole
    // reason a crash mid-write leaves evidence instead of silence.
    expect(rows[0]).toMatchObject({ status: "pending", intent: "lock", reason: "Truck broken into overnight" });
    expect(settled(rec)).toMatchObject({ status: "succeeded" });
    expect(rec.writtenRows("audit_logs").map((r) => r.action)).toContain("card.locked");
  });

  it("keeps every query and write inside the org", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE, soap(""), CARD_HELD, CARD_HELD);
    await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);
    expectOrgScoped(rec, ORG);
  });

  it("never writes a card number into the ledger", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE, soap(""), CARD_HELD, CARD_HELD);
    await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);
    // Mechanical proof rather than a code-review habit: scan EVERY recorded payload for a card
    // number. The ledger row stores a full card echo as XML, so this is the test that would have
    // caught a missing redactCardXml call.
    //
    // The pattern is `\b\d{12,}\b` — the SAME definition redactCardXml uses — rather than a bare
    // `\d{12,}`. Card versions and HMACs are hex, so a bare run happily matches twelve digits that
    // happen to sit inside a hash and the test fails for a reason that has nothing to do with PANs.
    // Word boundaries are what make this assert "a card number is present", which is the claim.
    const serialized = JSON.stringify(rec.queries.map((q) => q.write?.payload ?? null));
    expect(serialized).not.toMatch(/\b\d{12,}\b/);
  });
});

describe("a mutation that does not land", () => {
  it("records failed with the vendor's own fault text, and still learns the true state", async () => {
    const rec = recorder();
    const fault = soap(
      "<soap:Fault xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'><faultstring>Not Allowed 109491436176</faultstring></soap:Fault>",
    );
    // login → read → REFUSED write → re-read (still Active) → mirror
    const s = stub(loginOk, CARD_ACTIVE, fault, CARD_ACTIVE, CARD_ACTIVE);
    const outcome = await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);

    expect(outcome.status).toBe("failed");
    expect(outcome.faultCode).toBe("not_allowed");
    expect(settled(rec)).toMatchObject({ status: "failed", efs_fault_code: "not_allowed" });
    // The reference number WEX support asks for survives into the ledger.
    expect(String(settled(rec).efs_fault_message)).toContain("109491436176");
    expect(rec.writtenRows("audit_logs").map((r) => r.action)).toContain("card.mutation_failed");
  });

  it("records drift when the card moved in ways no edit named", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE, soap(""), CARD_HELD_AND_DRIFTED, CARD_HELD_AND_DRIFTED);
    const outcome = await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);

    // The lock landed. Something else moved too — EFS wins, the mirror follows, and we say so.
    expect(outcome.status).toBe("drift_detected");
    expect(outcome.driftFields).toContain("/policyNumber");
    expect(rec.writtenRows("audit_logs").map((r) => r.action)).toContain("card.drift_detected");
  });

  it("records 'sent' — not failed — when the verifying re-read itself fails", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE, soap(""), "not xml at all");
    const outcome = await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);

    // The write went out and we cannot say what became of it. Calling that "failed" would tell an
    // operator the card is unchanged when it may be locked.
    expect(outcome.status).toBe("sent");
    expect(settled(rec)).toMatchObject({ status: "sent" });
    expect(rec.writtenRows("audit_logs").map((r) => r.action)).toContain("card.mutation_unverified");
  });
});

describe("concurrency and caps", () => {
  it("refuses on a stale expectedVersion BEFORE anything is sent", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE);
    await expect(
      executeCardMutation(ctxFor(rec, s.fetchImpl, "stale-version-from-an-old-screen"), spec),
    ).rejects.toMatchObject({ code: "card_state_changed" });

    // Asserted on the STUB, not just on the thrown error: two calls means login + the read, and no
    // third call means no setCardV2 reached EFS.
    expect(s.bodies.length).toBe(2);
    // And no ledger row: nothing happened, so nothing is recorded as having happened.
    expect(rec.writtenRows("efs_card_mutations")).toHaveLength(0);
  });

  it("refuses once the org has spent its hourly budget", async () => {
    const rec = recorder({ efs_card_mutations: { data: [], error: null, count: 50 } });
    const s = stub(loginOk, CARD_ACTIVE);
    await expect(
      executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec),
    ).rejects.toMatchObject({ code: "org_hourly_cap_reached" });
    // Refused before the vendor was dialled at all.
    expect(s.bodies.length).toBe(0);
  });

  it("fails CLOSED when the ledger cannot be counted", async () => {
    const rec = recorder({ efs_card_mutations: { data: null, error: { message: "connection reset" } } });
    const s = stub(loginOk, CARD_ACTIVE);
    const error = await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec).catch((e) => e);
    // This is the last cap between a compromised account and a fleet. An unreadable ledger is a
    // reason to stop, not a reason to proceed unmetered.
    expect(error).toBeInstanceOf(CardControlError);
    expect(error.status).toBe(503);
  });
});

describe("the vendor writes our value back in its own casing", () => {
  /**
   * Measured against real mirror data before the first live write: this account's EFS stores statuses
   * upper-cased (ACTIVE / INACTIVE / HOLD) while the guide documents Active / Inactive / Hold (p35).
   * We send `Hold`; the card comes back `HOLD`.
   */
  const CARD_HELD_UPPERCASE = CARD_ACTIVE.replace("<status>Active</status>", "<status>HOLD</status>");

  it("counts a lock as SUCCEEDED when the card comes back HOLD", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE, soap(""), CARD_HELD_UPPERCASE, CARD_HELD_UPPERCASE);
    const outcome = await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);

    // Without the casing tolerance this was `failed`: the operator was told "EFS accepted the request
    // but the card is unchanged" about a card that was, in fact, locked — and invited to retry.
    expect(outcome.status).toBe("succeeded");
    expect(settled(rec)).toMatchObject({ status: "succeeded" });
    // And the ledger still records what EFS actually holds, not what we sent.
    expect((settled(rec).after_document as { status: string }).status).toBe("HOLD");
  });

  it("still calls it FAILED when the status is a genuinely different state", async () => {
    // The tolerance is case ONLY. A card that came back Active after a lock is a real failure.
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE, soap(""), CARD_ACTIVE, CARD_ACTIVE);
    const outcome = await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);
    expect(outcome.status).toBe("failed");
  });

  it("does not let the tolerance swallow real drift on a field nobody edited", async () => {
    const drifted = CARD_HELD_UPPERCASE.replace("<policyNumber>14</policyNumber>", "<policyNumber>27</policyNumber>");
    const rec = recorder();
    const s = stub(loginOk, CARD_ACTIVE, soap(""), drifted, drifted);
    const outcome = await executeCardMutation(ctxFor(rec, s.fetchImpl, versionOf(CARD_ACTIVE)), spec);
    expect(outcome.status).toBe("drift_detected");
    expect(outcome.driftFields).toContain("/policyNumber");
  });
});
