import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPT_INPUT_UNSET } from "@silvicom/shared";
import { type PromptsSetBody, promptsSetContract } from "@silvicom/shared";
import { parseCardDocument } from "../../lib/efsCardXml.js";
import { __resetEfsSessions } from "../../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../../lib/soapClient.js";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";
import { executeCapability } from "../../services/efsCardControl.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { resolveCapability } from "../orchestrator/resolve.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import { promptsSetBehaviour } from "./promptsSet.behaviour.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * Removing a prompt — the refusal with the largest blast radius, and no test until Step 3.6.
 *
 * `replaceAll` means the array in the request IS the card's prompts afterwards (guide p137), so a
 * record that does not come back is DELETED. Dropping the DRID record stops the pump asking who is
 * fuelling, and every downstream attribution decision loses its strongest signal.
 *
 * The gate raises TWO different refusals and the difference is the whole point: a missing password
 * is `step_up_required` and a missing opt-in is `invalid_request`, because one of them is answered
 * by re-authenticating and the other by the client sending a flag it deliberately withheld. A test
 * that only checked "it refused" would pass while telling somebody to type their password at a
 * problem no password solves.
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
  readFileSync(fileURLToPath(new URL(`../../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

/** Carries DRID, UNIT and ODRD records — so there is genuinely something to remove. */
const CARD_XML = fixture("getCardV2.full.xml");
/**
 * The same card as EFS would return it AFTER the removal landed. Built by deleting the record rather
 * than by blanking it, because that is the difference the whole capability turns on: an emptied
 * `matchValue` is a prompt that still asks, and a missing record is a pump that stops asking.
 */
const CARD_WITHOUT_DRID = CARD_XML.replace(/<infos>(?:(?!<\/infos>)[\s\S])*?<infoId>DRID<\/infoId>[\s\S]*?<\/infos>/, "");

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
  expectedVersion: versionOf(xml),
  idempotencyKey: null,
  stepUp,
});

/**
 * Derived from the contract's own schema rather than hand-written. A local copy drifted immediately:
 * it listed ODRD, which the card carries and `EFS_EDITABLE_INFO_IDS` does not permit anyone to edit.
 */
type PromptInput = PromptsSetBody["prompts"][number];

const setPrompts = (
  rec: SupabaseRecorder,
  prompts: PromptInput[],
  opts: { stepUp: boolean; allowRemoveDriverId: boolean; after?: string },
) =>
  executeCapability(
    ctxFor(rec, stub(loginOk, CARD_XML, soap(""), opts.after ?? CARD_XML), CARD_XML, opts.stepUp),
    // `satisfies` rather than a bare literal: Step 4.5 gave `CapabilityBehaviour` a producer position
    // for TBody (`proof.sample`), so the type is no longer contravariant and an inferred
    // `replaceAll: true` is narrower than the contract's `boolean`. Type-only — the value is unchanged.
    resolveCapability(promptsSetContract, promptsSetBehaviour, {
      expectedVersion: versionOf(CARD_XML),
      replaceAll: true,
      allowRemoveDriverId: opts.allowRemoveDriverId,
      prompts,
    } satisfies PromptsSetBody),
  );

const keepUnit: PromptInput =
  { infoId: "UNIT", validationType: "EXACT_MATCH", matchValue: "3182", reportValue: null, remove: false, ...PROMPT_INPUT_UNSET };
const dropDriverId: PromptInput =
  { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: null, reportValue: null, remove: true, ...PROMPT_INPUT_UNSET };

const inserted = (rec: SupabaseRecorder) =>
  rec.forTable("efs_card_mutations").filter((q) => q.write?.method === "insert");

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

/**
 * Step 9.4 — the card whose prompts come from the POLICY.
 *
 * `getCardV2.empty.xml` is the only captured document in the repository carrying
 * `infoSource: POLICY`, and it is the whole reason this can be tested at all: every card on both
 * live accounts reads `BOTH` (Step 7.3), which is the finding that has blocked the live
 * `infoSource=POLICY` fixture since Step 0.13. **The live half of 9.4's Verify remains open**; what
 * is proven here is that the branch throws on a document that really does say POLICY, rather than
 * on one a test invented.
 */
describe("a card that takes its prompts from the policy", () => {
  const POLICY_XML = fixture("getCardV2.empty.xml");

  const setPromptsOn = (rec: SupabaseRecorder, xml: string) =>
    executeCapability(
      ctxFor(rec, stub(loginOk, xml, soap(""), xml), xml, true),
      resolveCapability(promptsSetContract, promptsSetBehaviour, {
        expectedVersion: versionOf(xml),
        replaceAll: true,
        allowRemoveDriverId: false,
        prompts: [keepUnit],
      } satisfies PromptsSetBody),
    );

  it("refuses the write, and calls it a bad request rather than a step-up", async () => {
    /**
     * The defect: EFS ACCEPTS this write and ignores it, and the echo verifier cannot tell —
     * it re-reads the card and finds the records it just wrote, because the card still STORES
     * them. They simply never reach a pump. Before this refusal the operator saw a clean landing
     * for a change that would never take effect.
     */
    const rec = recorder();
    const error = await setPromptsOn(rec, POLICY_XML).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ActionRefusalError);
    // No password fixes this one — the fix is a policy edit, which this product does not do.
    expect((error as ActionRefusalError).code).toBe("invalid_request");
    expect((error as ActionRefusalError).message).toContain("policy");
  });

  it("refuses BEFORE the ledger row, so nothing is left half-written", async () => {
    // The precondition runs after the fresh read and before the row opens (docs/27 §3.4). A
    // refusal that had already inserted would leave a mutation nobody dispatched.
    const rec = recorder();
    await setPromptsOn(rec, POLICY_XML).catch(() => undefined);
    expect(inserted(rec)).toHaveLength(0);
  });

  it("still allows a card sourced BOTH — which is every card on both live accounts", async () => {
    /**
     * The guard must not quietly become "refuse prompt writes". `BOTH` means the card's own records
     * ARE consulted, and every prompt write this product has ever landed was on a BOTH card.
     *
     * Asserted against the fixture's actual header rather than trusting the filename, so this
     * cannot pass because the document happens to carry no `infoSource` at all — which is the
     * ALLOWED-absent branch and would prove nothing about `BOTH`.
     */
    expect(parseCardDocument(CARD_XML).card.infoSource).toBe("BOTH");

    const rec = recorder();
    const outcome = await setPrompts(rec, [keepUnit], { stepUp: true, allowRemoveDriverId: false })
      .catch((e: unknown) => e);
    expect(outcome).not.toBeInstanceOf(ActionRefusalError);
    expect(inserted(rec)).toHaveLength(1);
  });

  it("allows a document with no infoSource at all, rather than failing closed on 'we cannot tell'", async () => {
    /**
     * Deliberate, and the opposite choice from the removal gate above.
     *
     * A card document without the field is an older shape or a parse we have not modelled. Refusing
     * there would block every prompt write the moment the vendor renamed a header field — turning a
     * guard against a SILENT NO-OP into an outage. The removal gate protects a driver's attribution
     * and must fail closed; this one protects against a write that does nothing, which is not worth
     * breaking the feature over.
     */
    const withoutSource = CARD_XML.replace(/<infoSource>[^<]*<\/infoSource>/, "");
    expect(parseCardDocument(withoutSource).card.infoSource).toBeNull();

    const rec = recorder();
    const outcome = await setPromptsOn(rec, withoutSource).catch((e: unknown) => e);
    expect(outcome).not.toBeInstanceOf(ActionRefusalError);
  });
});

describe("removing a card's Driver ID prompt", () => {
  it("refuses without a fresh sign-in, and says so as a step-up rather than a bad request", async () => {
    const rec = recorder();
    const error = await setPrompts(rec, [dropDriverId], { stepUp: false, allowRemoveDriverId: true })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ActionRefusalError);
    expect((error as ActionRefusalError).code).toBe("step_up_required");
    expect(inserted(rec)).toHaveLength(0);
  });

  it("refuses WITH a fresh sign-in when the explicit opt-in is missing — and calls it a bad request", async () => {
    const rec = recorder();
    const error = await setPrompts(rec, [dropDriverId], { stepUp: true, allowRemoveDriverId: false })
      .catch((e: unknown) => e);

    // The code is the point. Re-authenticating does not fix this one: the client has to send a flag
    // it withheld, and answering `step_up_required` would send a person to type their password at a
    // problem no password solves.
    expect(error).toBeInstanceOf(ActionRefusalError);
    expect((error as ActionRefusalError).code).toBe("invalid_request");
    expect((error as ActionRefusalError).message).toContain("allowRemoveDriverId");
    expect(inserted(rec)).toHaveLength(0);
  });

  it("allows it when both the password and the opt-in are present", async () => {
    const rec = recorder();
    const outcome = await setPrompts(rec, [dropDriverId], {
      stepUp: true, allowRemoveDriverId: true, after: CARD_WITHOUT_DRID,
    });

    // Without this case, a precondition that refused unconditionally would satisfy both refusals
    // above for the wrong reason.
    expect(outcome.status).toBe("succeeded");
    expect(rec.writtenRows("audit_logs").at(-1)?.meta).toMatchObject({ removedInfoIds: ["DRID"] });
  });

  it("does not demand anything to edit a prompt without removing it", async () => {
    const rec = recorder();
    const outcome = await setPrompts(rec, [keepUnit], { stepUp: false, allowRemoveDriverId: false });

    // The gate is narrow on purpose: changing a unit number is routine, and friction on the routine
    // path is what teaches people to tick every box without reading it.
    expect(outcome.status).toBe("succeeded");
  });
});

/**
 * Step 9.1's last gap, closed. The live prover built its sample from the hardcoded DRID/UNIT pair
 * while the write path validated against the account's resolved set — so a green `prove prompts_set`
 * proved two prompt ids and read as proving the surface. Same shape as the `oeg5RevertLanded`
 * lesson: when a live run goes green, ask which code path it exercised.
 *
 * The fixture carries DRID, ODRD and UNIT, which is what makes these assertions possible: ODRD is
 * reachable only through the resolved set, so a sample that ignores `ctx` cannot produce it.
 */
describe("the proof samples the account's prompts, not a constant", () => {
  const doc = parseCardDocument(readFileSync(
    fileURLToPath(new URL("../../lib/__fixtures__/efs/getCardV2.full.xml", import.meta.url)), "utf8",
  ));
  const snap = { doc };
  const ids = (body: PromptsSetBody) => body.prompts.map((p) => p.infoId).sort();

  it("covers every editable prompt the ACCOUNT allows, ODRD included", () => {
    const sample = promptsSetBehaviour.proof!.sample(snap, { editableInfoIds: ["DRID", "UNIT", "ODRD"] });
    expect(ids(sample)).toEqual(["DRID", "ODRD", "UNIT"]);
  });

  it("covers only the fallback pair when the account has never been read", () => {
    // The positive control. Without it, a sample that ignored `ctx` and returned every record on the
    // card would satisfy the assertion above while proving nothing about the resolved set.
    const sample = promptsSetBehaviour.proof!.sample(snap, { editableInfoIds: ["DRID", "UNIT"] });
    expect(ids(sample)).toEqual(["DRID", "UNIT"]);
  });

  it("reverts exactly what it sampled, through its own capability", () => {
    // OEG-5. A revert narrower than the sample leaves a QA card dirty in precisely the way rule 14
    // exists to prevent, and a `replaceAll` revert that omits a record DELETES it (guide p137).
    const ctx = { editableInfoIds: ["DRID", "UNIT", "ODRD"] };
    const revert = promptsSetBehaviour.proof!.revert(snap, ctx);
    expect(revert.capability).toBe("prompts_set");
    expect(ids(revert.body as PromptsSetBody)).toEqual(ids(promptsSetBehaviour.proof!.sample(snap, ctx)));
  });

  it("voids when the resolved set reaches nothing on this card", () => {
    // OEG-3. An account whose editable ids the card does not carry has nothing to flip, so a write
    // would be a no-op reported as a landing.
    expect(promptsSetBehaviour.proof!.precondition(snap, { editableInfoIds: ["BDAY", "GLCD"] })).toBe(false);
    expect(promptsSetBehaviour.proof!.precondition(snap, { editableInfoIds: ["ODRD"] })).toBe(true);
  });
});
