import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCardV2 } from "../lib/efsCardOps.js";
import { deleteOverrideOp } from "../lib/efsCardWrite.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { ActionRefusalError, CardControlError } from "../services/efsCardControlErrors.js";
import { OVERRIDE_FIELDS, lockEdits, overrideClearedLanded } from "../services/efsCardEdits.js";
import { executeCapability } from "../services/efsCardControl.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import type { CardMutationContext, ResolvedCapability, ResolvedStep } from "./types.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * What Step 3.4 added, and nothing that existed before it.
 *
 * The five shipped routes are covered twice over — `efsCardControl.test.ts` on the reconciliation
 * matrix, `fuelCardsControl.characterisation.test.ts` on the dispatched bytes — and both pass
 * unchanged, which is the evidence that the rewrite preserved them. This file is for the parts those
 * two cannot reach, because no capability that exists today is a sequence, declares a governance
 * gate, or names a target the ledger cannot key a row on.
 *
 * Every case drives `executeCapability` through the real `setCardV2` / `deleteOverride` /
 * `getCardv2` path against a scripted vendor, so a step that claims to have dispatched really put
 * bytes on the wire. The one exception is deliberately marked.
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
  // 0 = no second verifying look, so each case scripts exactly the calls it means to make. The
  // second look has its own coverage in efsCardControl.test.ts.
  EFS_CARD_VERIFY_RETRY_MS: 0,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
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
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

/** Active, with an override of two uses outstanding — a card both steps have something to do to. */
const CARD_START = fixture("getCardV2.full.xml").replace("<override>0</override>", "<override>2</override>");
/** Step 0 landed: Hold, override untouched. */
const CARD_HELD_OVERRIDDEN = CARD_START.replace("<status>Active</status>", "<status>Hold</status>");
/** Step 1 landed too. */
const CARD_HELD_CLEARED = CARD_HELD_OVERRIDDEN.replace("<override>2</override>", "<override>0</override>");

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
  expectedVersion,
  idempotencyKey: null,
  stepUp: false,
});

// ─── The capability under test ─────────────────────────────────────────────────────────────────

/** Step 0: the echo lock. The same recipe the live `/lock` route uses. */
const holdStep: ResolvedStep<void> = {
  label: "Put the card on Hold",
  mutation: { kind: "echo", buildEdits: (doc) => lockEdits("Hold", doc.card.status) },
  verify: cardEchoVerify<void>(),
};

/** Step 1: a `direct` op, so the loop is exercised across BOTH mutation kinds and not just echo. */
const clearOverrideStep: ResolvedStep<void> = {
  label: "Clear the outstanding override",
  mutation: { kind: "direct", dispatch: (ctx) => deleteOverrideOp(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) },
  verify: {
    snapshot: async (ctx) => ({ doc: await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) }),
    judge: (_before, after) => {
      if (!after.doc) return "indeterminate";
      return overrideClearedLanded(after.doc) ? "landed" : "not_landed";
    },
  },
};

const capability = (over: Partial<ResolvedCapability<void>> = {}): ResolvedCapability<void> => ({
  intent: "lock",
  capabilityKey: "test_capability",
  requestBody: null,
  auditAction: "card.locked",
  target: { kind: "card" },
  mutation: { kind: "echo", buildEdits: (doc) => lockEdits("Hold", doc.card.status) },
  verify: cardEchoVerify<void>(),
  governance: {},
  vendorMovesFields: [],
  body: undefined,
  ...over,
});

/**
 * `vendorMovesFields` is not optional here, and finding that out is what the first run of this file
 * did: `deleteOverride` moves the three override header fields, no ECHO edit names them, and the
 * drift classifier correctly reported a perfectly successful sequence as `drift_detected`. A
 * capability with a `direct` step must declare that step's footprint, exactly as the `/override`
 * DELETE route already does (`OVERRIDE_FIELDS`, fix plan D1).
 *
 * Capability-level rather than step-level on purpose: drift is judged ONCE, across the whole
 * mutation, from the document the plan opened to the one the last step left.
 */
const sequenced = (...steps: ResolvedStep<void>[]): ResolvedCapability<void> =>
  capability({ mutation: { kind: "sequence", steps }, vendorMovesFields: OVERRIDE_FIELDS });

/** The capability's own words. The orchestrator must surface them, not a sentence of its own. */
const STEP_UP_SENTENCE = "Confirm your password to make this particular change.";

const settled = (rec: SupabaseRecorder) => rec.writtenRows("efs_card_mutations").at(-1) ?? {};
const inserted = (rec: SupabaseRecorder) =>
  rec.forTable("efs_card_mutations").filter((q) => q.write?.method === "insert");

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

describe("a sequence", () => {
  it("dispatches every step in order and settles succeeded once the last one lands", async () => {
    const rec = recorder();
    // login → plan read → step0 setCardv2 → step0 re-read → step1 deleteOverride → step1 re-read.
    const s = stub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN, soap(""), CARD_HELD_CLEARED);

    const outcome = await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      sequenced(holdStep, clearOverrideStep),
    );

    expect(outcome.status).toBe("succeeded");
    // ONE ledger row for the whole sequence, not one per step (docs/27 §5.1): a second row would
    // fight `uq_efs_card_mutations_one_pending` and split the audit identity in half.
    expect(inserted(rec)).toHaveLength(1);
    // Order asserted on the wire, not on a call counter: a loop that ran the steps backwards would
    // still make two writes.
    const writes = s.bodies.filter((b) => b.includes("setCardv2") || b.includes("deleteOverride"));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain("CardManagementEP_setCardv2");
    expect(writes[1]).toContain("CardManagementEP_deleteOverride");
  });

  it("writes step_index as it goes, so a crash mid-sequence leaves the step number behind", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN, soap(""), CARD_HELD_CLEARED);

    await executeCapability(ctxFor(rec, s.fetchImpl, versionOf(CARD_START)), sequenced(holdStep, clearOverrideStep));

    const stepIndexes = rec
      .writtenRows("efs_card_mutations")
      .filter((row) => row.status === "sent")
      .map((row) => row.step_index);
    expect(stepIndexes).toEqual([0, 1]);
  });

  it("reports a direct step's own footprint as DRIFT when the capability does not declare it", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN, soap(""), CARD_HELD_CLEARED);

    // Same successful sequence as above, with `vendorMovesFields` emptied. Both steps land and the
    // mutation is still reported as having moved something nobody asked for — because no echo edit
    // named `/override` and the classifier only trusts what was declared. Keeping this case is what
    // stops the requirement being rediscovered on a live card.
    const outcome = await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      capability({ mutation: { kind: "sequence", steps: [holdStep, clearOverrideStep] }, vendorMovesFields: [] }),
    );

    expect(outcome.status).toBe("drift_detected");
    expect(outcome.driftFields).toContain("/override");
  });

  it("settles PARTIAL — not failed — when a later step does not land, and names the step", async () => {
    const rec = recorder();
    // Step 0 lands (Hold). Step 1's delete is accepted and changes nothing: the override is still 2.
    const s = stub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN, soap(""), CARD_HELD_OVERRIDDEN);

    const outcome = await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      sequenced(holdStep, clearOverrideStep),
    );

    // Reporting this as `failed` would send an operator to re-run a lock that already landed.
    expect(outcome.status).toBe("partial");
    expect(outcome.stepIndex).toBe(1);
    expect(outcome.stepLabel).toBe("Clear the outstanding override");
    expect(settled(rec)).toMatchObject({ status: "partial", step_index: 1 });
    const audited = rec.writtenRows("audit_logs").at(-1);
    expect(audited?.action).toBe("card.mutation_partial");
    // The UI names the step by its label, never by its number (docs/27 §5.1), so the label has to
    // survive into the audit row.
    expect(audited?.meta).toMatchObject({ stepIndex: 1, stepLabel: "Clear the outstanding override" });
  });

  it("settles FAILED when the FIRST step does not land — nothing applied, so nothing is partial", async () => {
    const rec = recorder();
    // The lock is accepted and changes nothing. Step 1 must never be reached.
    const s = stub(loginOk, CARD_START, soap(""), CARD_START);

    const outcome = await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      sequenced(holdStep, clearOverrideStep),
    );

    expect(outcome.status).toBe("failed");
    expect(settled(rec)).toMatchObject({ status: "failed", efs_fault_code: "no_change" });
    // The proof that the loop stopped: a second dispatch would have consumed a scripted response
    // that is not there and thrown "the stub ran out".
    expect(s.bodies.filter((b) => b.includes("deleteOverride"))).toHaveLength(0);
  });
});

describe("governance gates run in the plan phase, before a row exists", () => {
  it("refuses when planStepUp asks for a fresh sign-in the caller does not have", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START);

    const error = await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      capability({ governance: { planStepUp: (ctx) => (ctx.stepUp ? null : STEP_UP_SENTENCE) } }),
    ).catch((e: unknown) => e);

    // Both halves, on ONE rejection: the right ERROR so the route maps it to a step-up response, and
    // the right WORDS so the operator is told which action needs re-authenticating. Asserting only
    // the class is what let the message be a generic sentence in the first place.
    expect(error).toBeInstanceOf(ActionRefusalError);
    expect((error as ActionRefusalError).message).toBe(STEP_UP_SENTENCE);

    // No row and no dispatch: a refusal decided against the fresh document must leave no
    // half-finished record of a change that never happened.
    expect(inserted(rec)).toHaveLength(0);
    expect(s.bodies.filter((b) => b.includes("setCardv2"))).toHaveLength(0);
  });

  it("lets the same capability through when the caller DID re-authenticate", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN);

    const outcome = await executeCapability(
      { ...ctxFor(rec, s.fetchImpl, versionOf(CARD_START)), stepUp: true },
      capability({ governance: { planStepUp: (ctx) => (ctx.stepUp ? null : STEP_UP_SENTENCE) } }),
    );

    // The pair matters: without this case, a `planStepUp` that was never called at all would pass
    // the refusal test above for the wrong reason.
    expect(outcome.status).toBe("succeeded");
  });

  it("refuses when a precondition throws, and still opens no row", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START);

    await expect(executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      capability({
        governance: {
          precondition: () => {
            throw new ActionRefusalError("This card is flagged for fraud.", "step_up_required");
          },
        },
      }),
    )).rejects.toThrow("This card is flagged for fraud.");

    expect(inserted(rec)).toHaveLength(0);
  });

  it("passes the snapshot to auditMeta, so the meta describes the card the write was planned against", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN);

    await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      capability({ governance: { auditMeta: (snap) => ({ statusBefore: snap.doc?.card.status ?? null }) } }),
    );

    expect(rec.writtenRows("audit_logs").at(-1)?.meta).toMatchObject({ statusBefore: "Active" });
  });
});

describe("the seam refuses what it cannot record", () => {
  it("refuses a non-card target before spending a single vendor call", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START);

    // `efs_card_mutations` keys on `efs_card_id`. Writing this row anyway would put an unkeyed
    // mutation in the card ledger and defeat the one-in-flight index for every card at once
    // (docs/27 §5.2). The second LedgerAdapter is described there and deliberately not built.
    const error = await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      capability({ target: { kind: "account" } }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CardControlError);
    expect((error as CardControlError).code).toBe("unsupported_target");
    expect(inserted(rec)).toHaveLength(0);
    expect(s.bodies).toHaveLength(0);
  });
});

describe("a verification that cannot decide", () => {
  it("settles 'sent', not 'failed', when judge answers indeterminate on a document it could read", async () => {
    const rec = recorder();
    const s = stub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN);

    // The one case here that does not use a shipped verify: no capability today can answer
    // `indeterminate` while holding a document, and the point of the three-valued Landing is that a
    // capability which genuinely cannot judge — an ordering op whose horizon is days — may say so
    // instead of lying in one direction (docs/27 §3.3).
    const outcome = await executeCapability(
      ctxFor(rec, s.fetchImpl, versionOf(CARD_START)),
      capability({
        verify: { snapshot: cardEchoVerify<void>().snapshot, judge: () => "indeterminate" },
      }),
    );

    expect(outcome.status).toBe("sent");
    expect(settled(rec)).toMatchObject({ status: "sent", efs_fault_code: "unverified" });
    expect(rec.writtenRows("audit_logs").map((r) => r.action)).toContain("card.mutation_unverified");
  });
});

describe("apply latency measures the interval its column names (Step 4.7)", () => {
  /**
   * Migration 0191 documents `apply_latency_ms` as "milliseconds from dispatch to the first re-read
   * that saw the change". `prove.ts` used to time the whole `executeCapability` call instead, which
   * also carried the planning read, the write, the mirror update, the ledger writes and — decisively
   * — the deliberate `EFS_CARD_VERIFY_RETRY_MS` pause. The first live proof recorded 4562 ms on an
   * account that applies a status edit in ~850 ms (`docs/22` H6).
   *
   * ── Why the WRITE is deliberately slowed here ───────────────────────────────────────────────────
   * The first draft of these tests passed against BOTH the old and the new measurement, because a
   * scripted vendor answers instantly: with every call taking ~0 ms, "the whole call" and "the verify
   * window" differ only by the retry pause, which both include. The tests proved nothing.
   *
   * `WRITE_MS` is what separates them. It sits INSIDE the old window and OUTSIDE the new one, so the
   * old measurement cannot come in under it and the new one cannot come in over it. Restoring the
   * whole-call timing turns three of these four red.
   */
  const RETRY_MS = 300;
  const WRITE_MS = 400;
  const withRetry = testEnv({ ...env, EFS_CARD_VERIFY_RETRY_MS: RETRY_MS });
  const ctxWithRetry = (rec: SupabaseRecorder, fetchImpl: typeof fetch, expectedVersion: string): CardMutationContext =>
    ({ ...ctxFor(rec, fetchImpl, expectedVersion), env: withRetry });

  /** Like `stub`, but every WRITE takes WRITE_MS — time the old measurement counted and the new does not. */
  function slowWriteStub(...responses: string[]): { fetchImpl: typeof fetch } {
    let i = 0;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const next = responses[i++];
      if (next === undefined) throw new Error("the stub ran out of scripted responses");
      if (body.includes("setCardv2") || body.includes("deleteOverride")) {
        await new Promise((r) => setTimeout(r, WRITE_MS));
      }
      return new Response(next, { status: 200 });
    }) as typeof fetch;
    return { fetchImpl };
  }

  it("excludes the write itself when the first re-read sees the change", async () => {
    const rec = recorder();
    // login → plan read → setCardv2 (slow) → re-read ALREADY showing Hold.
    const s = slowWriteStub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN);

    const outcome = await executeCapability(ctxWithRetry(rec, s.fetchImpl, versionOf(CARD_START)), capability());

    expect(outcome.status).toBe("succeeded");
    expect(outcome.applyLatencyMs).not.toBeNull();
    // No pause was taken and the write is not ours to count. The old whole-call timing could not
    // come in under WRITE_MS, let alone under the retry interval.
    expect(outcome.applyLatencyMs!).toBeLessThan(RETRY_MS);
  });

  it("includes the retry pause when only the second look sees it, and still excludes the write", async () => {
    const rec = recorder();
    // The first re-read still shows the OLD document, so the second look is the one that lands.
    const s = slowWriteStub(loginOk, CARD_START, soap(""), CARD_START, CARD_HELD_OVERRIDDEN);

    const outcome = await executeCapability(ctxWithRetry(rec, s.fetchImpl, versionOf(CARD_START)), capability());

    expect(outcome.status).toBe("succeeded");
    // Includes the pause DELIBERATELY: the column says "the first re-read that saw the change", and
    // a vendor whose edit only becomes visible after a wait genuinely took longer to apply it.
    expect(outcome.applyLatencyMs!).toBeGreaterThanOrEqual(RETRY_MS);
    // The upper bound is what makes this case discriminating rather than decorative: the old
    // measurement would carry WRITE_MS on top of the pause and land above this line.
    expect(outcome.applyLatencyMs!).toBeLessThan(RETRY_MS + WRITE_MS);
  });

  /**
   * The pair above is the plan's own Verify — "the two must be distinguishable, which today they are
   * not". Stated as one assertion so a future change that collapses them fails HERE, with a message
   * about the distinction, rather than as two unrelated bound violations.
   */
  it("distinguishes a vendor that lands immediately from one that lands only on the second look", async () => {
    const immediate = await executeCapability(
      ctxWithRetry(recorder(), slowWriteStub(loginOk, CARD_START, soap(""), CARD_HELD_OVERRIDDEN).fetchImpl, versionOf(CARD_START)),
      capability(),
    );
    // The SOAP session is cached across calls, so the second run would skip its login and read every
    // scripted response one position early — the login envelope would arrive where a card was due.
    __resetEfsSessions();
    const delayed = await executeCapability(
      ctxWithRetry(recorder(), slowWriteStub(loginOk, CARD_START, soap(""), CARD_START, CARD_HELD_OVERRIDDEN).fetchImpl, versionOf(CARD_START)),
      capability(),
    );

    // Both halves are needed, and the first is what makes this discriminating. Under the old
    // whole-call timing the DIFFERENCE was still ~RETRY_MS — the pause is in one and not the other
    // either way — so a delta assertion alone passes on the broken code. What the old measurement
    // cannot do is put the immediate case under the retry interval, because it carries the write.
    // This one stays exact.
    expect(immediate.applyLatencyMs!).toBeLessThan(RETRY_MS);

    // The delta gets a tolerance, and it is not a fudge. Observed failing at 295 >= 300 on
    // 2026-08-15, roughly 1 isolated run in 5. The two latencies are measured in SEPARATE
    // executeCapability calls, so the delta is RETRY_MS plus the difference between two independent
    // read durations — if the immediate run's reads happen to take a few ms longer than the delayed
    // run's, the delta lands just under RETRY_MS through no fault of the code. Nothing discriminating
    // is lost: per the comment above, a collapse back to whole-call timing leaves this delta at
    // ~RETRY_MS anyway, so this assertion never caught the bug — `immediate < RETRY_MS`, directly
    // above, is what does, and it is untouched.
    const TIMER_SLACK_MS = 25;
    expect(delayed.applyLatencyMs! - immediate.applyLatencyMs!).toBeGreaterThanOrEqual(RETRY_MS - TIMER_SLACK_MS);
  });

  it("is null when nothing landed — an unlanded write has no apply latency", async () => {
    const rec = recorder();
    // Both looks show the card unchanged: the write was accepted and never applied.
    const s = slowWriteStub(loginOk, CARD_START, soap(""), CARD_START, CARD_START);

    const outcome = await executeCapability(ctxWithRetry(rec, s.fetchImpl, versionOf(CARD_START)), capability());

    expect(outcome.status).toBe("failed");
    // Zero would be a measurement. Null is the absence of one, and the column is nullable for this.
    expect(outcome.applyLatencyMs ?? null).toBeNull();
  });

  it("reports the LAST landed step's latency on a sequence, not the sum of the steps", async () => {
    const rec = recorder();
    // Step 0 lands on its first look; step 1 needs the second. A sum would carry step 0's window and
    // both slow writes; the last-step rule keeps the number a property of the VENDOR, not the recipe.
    const s = slowWriteStub(
      loginOk, CARD_START,
      soap(""), CARD_HELD_OVERRIDDEN,
      soap(""), CARD_HELD_OVERRIDDEN, CARD_HELD_CLEARED,
    );

    const outcome = await executeCapability(
      ctxWithRetry(rec, s.fetchImpl, versionOf(CARD_START)),
      sequenced(holdStep, clearOverrideStep),
    );

    expect(outcome.status).toBe("succeeded");
    expect(outcome.applyLatencyMs!).toBeGreaterThanOrEqual(RETRY_MS);
    expect(outcome.applyLatencyMs!).toBeLessThan(RETRY_MS + WRITE_MS);
  });
});
