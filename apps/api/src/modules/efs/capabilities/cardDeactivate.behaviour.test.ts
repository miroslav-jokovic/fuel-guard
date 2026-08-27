import type { EditsCtx } from "../types.js";
import { EFS_EDITABLE_INFO_IDS } from "@silvicom/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITIES_WITH_STEP_UP_GATE, cardDeactivateContract } from "@silvicom/shared";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { executeCapability } from "../services/efsCardControl.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { resolveCapability } from "../orchestrator/resolve.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import { cardDeactivateBehaviour } from "./cardDeactivate.behaviour.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * The status capabilities ignore the editable prompt set entirely — their proofs are about
 * `status` — so any value serves. Passing the DRID/UNIT fallback rather than an empty list keeps it
 * honest: that is what an org whose vocabulary has never been read actually resolves to.
 */
const PROOF_CTX: EditsCtx = { editableInfoIds: [...EFS_EDITABLE_INFO_IDS] };


/**
 * Retiring a card, driven through the real orchestrator against a scripted vendor.
 *
 * ── The case Step 8.1 exists to prove ───────────────────────────────────────────────────────────
 * *"a held card can be deactivated without first being unlocked."* The claim is about the WIRE, not
 * about the UI: one `setCardv2`, carrying `INACTIVE`, with no `ACTIVE` anywhere in the exchange. A
 * drawer assertion can show one button press; only the dispatched bytes show that the card was never
 * momentarily spendable, which is the property the step is actually about (standing rule 6).
 *
 * ── Why the casing is asserted rather than the enum value ───────────────────────────────────────
 * This account stores `INACTIVE` upper-cased. A write spelled `Inactive` from the guide is accepted
 * with a void success and silently NOT APPLIED (H1, incident 2026-08-12) — so an assertion on the
 * status we MEANT to send would pass on exactly the bug that started this workstream.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const USER = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const CARD = "70830000000000000";

const env = testEnv({
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
});

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

const ACTIVE = fixture("getCardV2.full.xml");
/** UPPER-CASE throughout, because that is what this account actually returns (incident 2026-08-12). */
const HELD = ACTIVE.replace("<status>Active</status>", "<status>HOLD</status>");
const INACTIVE = ACTIVE.replace("<status>Active</status>", "<status>INACTIVE</status>");

const versionOf = (xml: string) => parseCardDocument(xml).version;

/** Records every request body, so the assertions can be made on the bytes rather than on a mock. */
function recordingStub(...responses: string[]): { fetchImpl: typeof fetch; sent: string[] } {
  const sent: string[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    const next = responses[i++];
    if (next === undefined) throw new Error("the stub ran out of scripted responses");
    return new Response(next, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
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

const deactivate = (xml: string, after: string, rec: SupabaseRecorder) => {
  const { fetchImpl, sent } = recordingStub(loginOk, xml, soap(""), after);
  const ctx: CardMutationContext = {
    admin: rec.client, env, creds, orgId: ORG, fetchImpl,
    efsCardId: CARD_ID, cardNumber: CARD, userId: USER,
    expectedVersion: versionOf(xml),
    idempotencyKey: null,
    // FALSE, deliberately: this capability has no step-up gate, and a context that asserted one
    // would hide a gate accidentally added later.
    stepUp: false,
  };
  return {
    sent,
    run: executeCapability(
      ctx,
      resolveCapability(cardDeactivateContract, cardDeactivateBehaviour, { expectedVersion: versionOf(xml) }),
    ),
  };
};

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

describe("a held card can be deactivated without first being unlocked (Step 8.1's Verify)", () => {
  it("sends ONE write, carrying INACTIVE, with no ACTIVE anywhere in the exchange", async () => {
    const rec = recorder();
    const { sent, run } = deactivate(HELD, INACTIVE, rec);
    const outcome = await run;

    expect(outcome.status).toBe("succeeded");

    const writes = sent.filter((body) => body.includes("setCardv2") || body.includes("setCardV2"));
    // ONE. The path this replaces was unlock-then-deactivate, and the whole objection to it is that
    // the first of its two writes made a stolen card spendable again.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("<status>INACTIVE</status>");
    // The negative half, and the one that actually encodes "without first being unlocked". Asserted
    // across EVERY request, not just the write, so a stray activating call anywhere would fail it.
    for (const body of sent) expect(body).not.toContain("<status>ACTIVE</status>");
  });

  it("borrows the account's casing rather than the guide's — the H1 tripwire", async () => {
    const rec = recorder();
    const { sent, run } = deactivate(HELD, INACTIVE, rec);
    await run;

    const write = sent.find((b) => b.toLowerCase().includes("setcardv2"))!;
    // `Inactive` from the guide (p134) is accepted with a void success and silently ignored by this
    // account. An assertion on the enum value we meant to send would pass on exactly that bug.
    expect(write).toContain("<status>INACTIVE</status>");
    expect(write).not.toContain("<status>Inactive</status>");
  });

  it("records what it was deactivated FROM, read from the document EFS returned", async () => {
    const rec = recorder();
    await deactivate(HELD, INACTIVE, rec).run;

    // Sourced from the same document the write was spelled from, so the audit row cannot disagree
    // with the bytes. `deactivatedFromHold` is the case Step 8.1 was written for, recorded as a fact
    // rather than inferred later from two adjacent rows.
    expect(rec.writtenRows("audit_logs").at(-1)?.meta).toMatchObject({
      statusBefore: "HOLD",
      deactivatedFromHold: true,
    });
  });

  it("records an ordinary retirement as NOT from hold", async () => {
    const rec = recorder();
    await deactivate(ACTIVE, INACTIVE, rec).run;

    // The pair. Without it, an `auditMeta` hardcoding `true` would satisfy the case above.
    expect(rec.writtenRows("audit_logs").at(-1)?.meta).toMatchObject({
      statusBefore: "Active",
      deactivatedFromHold: false,
    });
  });

  /**
   * One card per case, because the SOAP session is cached across a run: a second exchange inside one
   * `it` skips the login it was scripted for and reads the login response as the card.
   */
  it("asks for no password to retire a HELD card", async () => {
    // `stepUp: false` in the context above is what makes this meaningful: if a gate were ever added
    // to this behaviour, this would refuse with `step_up_required` instead of succeeding.
    expect(CAPABILITIES_WITH_STEP_UP_GATE).not.toContain("card_deactivate");
    expect((await deactivate(HELD, INACTIVE, recorder()).run).status).toBe("succeeded");
  });

  it("asks for no password to retire an ACTIVE card either", async () => {
    // Locking's reasoning applies unchanged — this is the fuel-STOPPING direction, and friction on
    // it has a cost measured in stolen fuel.
    expect((await deactivate(ACTIVE, INACTIVE, recorder()).run).status).toBe("succeeded");
  });
});

describe("the proof plan for a retirement", () => {
  const snapAt = (status: string) => ({ doc: { card: { status } } }) as never;

  it("voids on a card already INACTIVE — a write the vendor ignores would report success", () => {
    // OEG-3. This account spells it upper-case, so `efsStatusEquals` and not `===`: an exact
    // comparison would run the proof, see `INACTIVE` on re-read and call it landed.
    expect(cardDeactivateBehaviour.proof?.precondition(snapAt("INACTIVE"), PROOF_CTX)).toBe(false);
    expect(cardDeactivateBehaviour.proof?.precondition(snapAt("HOLD"), PROOF_CTX)).toBe(true);
    expect(cardDeactivateBehaviour.proof?.precondition(snapAt("ACTIVE"), PROOF_CTX)).toBe(true);
  });

  it("refuses a card no capability could put back", () => {
    // Fraud and Deleted are neither Inactive nor revertible; running here would retire a real card
    // with no way home (standing rule 14).
    expect(cardDeactivateBehaviour.proof?.precondition(snapAt("FRAUD"), PROOF_CTX)).toBe(false);
    expect(cardDeactivateBehaviour.proof?.precondition(snapAt("Deleted"), PROOF_CTX)).toBe(false);
  });

  it("reverts through whichever capability owns the status it found", () => {
    expect(cardDeactivateBehaviour.proof?.revert(snapAt("HOLD"), PROOF_CTX)).toMatchObject({
      capability: "card_lock", body: { status: "Hold" },
    });
    // Canonical `Hold`, not the observed `HOLD`: `card_lock`'s schema is a case-sensitive enum and
    // the account's own casing is re-applied at `buildEdits`. See `statusRevert.ts`.
    expect(cardDeactivateBehaviour.proof?.revert(snapAt("ACTIVE"), PROOF_CTX)).toMatchObject({
      capability: "card_unlock",
    });
  });
});
