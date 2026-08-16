import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetEfsSessions } from "../../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../../lib/soapClient.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import { capabilityRegistry } from "../registry.js";
import { proveCapability, type ProofOutcome } from "./prove.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * Step 4.5's three named cases, and each is a way the harness could lie.
 *
 * A prover that reports success for a write nobody made, or green for a card it left changed, is
 * worse than no prover: Step 4.6 promotes on its word, and a promotion is what lets a capability
 * touch production fuel cards.
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
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

const ACTIVE = fixture("getCardV2.full.xml");
const HELD = ACTIVE.replace("<status>Active</status>", "<status>HOLD</status>");

/** Feeds scripted responses in order, and says so loudly when a run asks for one more than expected. */
function stub(...responses: string[]): typeof fetch {
  let i = 0;
  return (async () => {
    const next = responses[i++];
    if (next === undefined) throw new Error(`the stub ran out of scripted responses after ${i - 1}`);
    return new Response(next, { status: 200 });
  }) as typeof fetch;
}

/** The REAL registry — the prover must resolve capabilities the same way production does. */
const capabilities = capabilityRegistry();

function harness(fetchImpl: typeof fetch) {
  const rec = createSupabaseRecorder({
    tables: {
      efs_card_mutations: (q) =>
        q.write?.method === "insert" ? { data: { id: "mutation-1" }, error: null } : { data: [], error: null, count: 0 },
      efs_cards: { data: { id: CARD_ID }, error: null },
    },
  });
  const states: string[] = [];
  let settled: ProofOutcome | null = null;
  const ctx: CardMutationContext = {
    admin: rec.client, env, creds, orgId: ORG, fetchImpl,
    efsCardId: CARD_ID, cardNumber: CARD, userId: USER,
    reason: "Capability proof run", expectedVersion: "", idempotencyKey: null, stepUp: false,
  };
  const deps = {
    capabilities,
    openProof: async () => "proof-1",
    settleProof: async (_id: string, r: ProofOutcome) => { settled = r; },
    setPromotionState: async (_k: string, state: string) => { states.push(state); },
  };
  return { ctx, deps, states, rec, settledResult: () => settled };
}

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

describe("a proof that would prove nothing", () => {
  it("is VOID when the before-state already equals what the capability would write", async () => {
    // The card is already HOLD and `card_lock`'s sample writes Hold. Dispatching would re-read, see
    // Hold, and report success — for a write the vendor may have ignored entirely. That is the H1
    // failure wearing a green badge, and OEG-3 exists to refuse it.
    const h = harness(stub(loginOk, HELD));
    const result = await proveCapability(h.ctx, "card_lock", h.deps);

    expect(result.outcome).toBe("void");
    expect(result.detail).toMatch(/already in the state/i);
    // Void, not denied: nothing was learned either way, and every gate stays null rather than false.
    expect(result.oeg3ChangeLanded).toBeNull();
    expect(result.oeg5RevertLanded).toBeNull();
  });

  it("never moves the promotion past `proving` on a void run", async () => {
    const h = harness(stub(loginOk, HELD));
    await proveCapability(h.ctx, "card_lock", h.deps);

    // A void run must not leave a verdict behind. `denied` would be as wrong as `proven` — it says
    // the capability was tested and failed, and it was not tested.
    expect(h.states).toEqual(["proving"]);
  });
});

describe("a revert that does not land", () => {
  it("denies the proof and says the card is still changed", async () => {
    // apply: plan-read, write, verify(HELD) → landed. oeg4 read. revert: plan-read, write,
    // verify — which comes back HELD again, so the revert did NOT land.
    const h = harness(stub(
      loginOk, ACTIVE,
      ACTIVE, soap(""), HELD,
      HELD,
      HELD, soap(""), HELD,
    ));
    const result = await proveCapability(h.ctx, "card_lock", h.deps);

    expect(result.oeg3ChangeLanded).toBe(true);
    expect(result.oeg5RevertLanded).toBe(false);
    // The sentence an operator has to act on. A prover that leaves a card locked and says nothing is
    // the failure this product exists to prevent, committed by the tool meant to prove it does not.
    expect(result.cardStillChanged).toBe(true);
    expect(result.detail).toMatch(/THE CARD IS STILL CHANGED/);
    expect(result.outcome).toBe("denied");
    expect(h.states).toEqual(["proving", "denied"]);
  });
});

describe("OEG-4, the H1 gate", () => {
  it("records oeg4 false when the vendor spells a vocabulary value differently from us", async () => {
    // `prompts_set` sends `validationType` verbatim and declares NO casing adapter, so a vendor
    // answering `report_only` where we sent `REPORT_ONLY` is a genuine mis-spelling — the H1 class,
    // on a field where nothing corrects it at write time.
    // `EXACT_MATCH`, because that is what this fixture actually carries — a first draft mis-cased
    // REPORT_ONLY, which the fixture does not contain, so the "miscased" document was byte-identical
    // and the gate passed for the wrong reason. A test whose setup is a no-op asserts nothing.
    const miscased = ACTIVE.replace(/<validationType>EXACT_MATCH<\/validationType>/g, "<validationType>exact_match</validationType>");
    const h = harness(stub(
      loginOk, ACTIVE,
      ACTIVE, soap(""), miscased,
      miscased,
      miscased, soap(""), ACTIVE,
    ));
    const result = await proveCapability(h.ctx, "prompts_set", h.deps);

    expect(result.oeg4Vocabulary).toBe(false);
    expect(result.vocabulary.validationType).toContain("exact_match");
    // A mis-spelled vocabulary is disqualifying on its own, whatever the other gates said.
    expect(result.outcome).toBe("denied");
  });

  it("does not fail OEG-4 merely because one card cannot carry every emittable value", async () => {
    // A single card shows one spelling per field. `unobserved` across a one-document corpus is the
    // normal case and says nothing about the account — only the fleet-wide scan (Step 4.4) can, and
    // treating it as a failure here would deny every proof that ever ran.
    const h = harness(stub(
      loginOk, ACTIVE,
      ACTIVE, soap(""), HELD,
      HELD,
      HELD, soap(""), ACTIVE,
    ));
    const result = await proveCapability(h.ctx, "card_lock", h.deps);

    expect(result.oeg4Vocabulary).toBe(true);
    expect(result.oeg5RevertLanded).toBe(true);
    expect(result.outcome).toBe("proven");
  });
});

describe("what the harness may and may not decide", () => {
  it("cannot promote — `enabled` is not a state it can write", async () => {
    const h = harness(stub(
      loginOk, ACTIVE,
      ACTIVE, soap(""), HELD,
      HELD,
      HELD, soap(""), ACTIVE,
    ));
    await proveCapability(h.ctx, "card_lock", h.deps);

    // Evidence that can promote itself is not evidence. Only Step 4.6, driven by a person, writes
    // `enabled`; the type on `setPromotionState` says so and this asserts the runtime agrees.
    expect(h.states).not.toContain("enabled");
    expect(h.states).toEqual(["proving", "proven"]);
  });

  it("refuses a capability with no proof plan instead of inventing one", async () => {
    const h = harness(stub(loginOk));
    const noPlan = { ...capabilities, card_lock: { ...capabilities.card_lock!, proof: null } };

    await expect(proveCapability(h.ctx, "card_lock", { ...h.deps, capabilities: noPlan }))
      .rejects.toThrow(/no proof plan/);
  });
});
