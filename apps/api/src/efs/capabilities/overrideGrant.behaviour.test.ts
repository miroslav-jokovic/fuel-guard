import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERRIDE_LIMITS_STEP_UP, type OverrideGrantBody, overrideGrantContract } from "@fuelguard/shared";
import { parseCardDocument } from "../../lib/efsCardXml.js";
import { __resetEfsSessions } from "../../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../../lib/soapClient.js";
import { executeCapability } from "../../services/efsCardControl.js";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";
import { overrideGrantEdits } from "../../services/efsCardEdits.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { resolveCapability } from "../orchestrator/resolve.js";
import type { CardMutationContext } from "../orchestrator/types.js";
import { overrideGrantBehaviour } from "./overrideGrant.behaviour.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * Step 3.11 — the P0 this file exists for.
 *
 * ── What happened, and how it was found ─────────────────────────────────────────────────────────
 * A live QA grant on 2026-08-14 LANDED and was recorded `failed`. The operator was shown "EFS
 * accepted the request but the card is unchanged. Check the card in the WEX portal before retrying"
 * — an invitation to grant a SECOND free tank on a card that already carried one.
 *
 * Phase 3 verified the dispatched bytes exhaustively and could not have caught this: every test in
 * the suite scripts its own after-document, so every test agreed with itself about what the vendor
 * would say. The ledger's own rows are what settled it — three `override_grant` rows, `override`
 * landing 0 → 1 every time, `overrideAllLocations` sent `true` and read back `false` every time.
 *
 * The cases below script the after-document the VENDOR actually returned, taken from those rows.
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

/** `override` 0, `overrideAllLocations` false, `locationOverride` 0 — the live before-state. */
const NO_OVERRIDE = fixture("getCardV2.full.xml");

/**
 * What this vendor actually returned: the count applied, the scope flag still `false`.
 *
 * Every one of the 234 card rows either org has ever mirrored reads `overrideAllLocations=false`,
 * and not one reads `true`. This is not a scripted hypothetical; it is the recorded answer.
 */
const COUNT_ONLY = NO_OVERRIDE.replace("<override>0</override>", "<override>1</override>");

/** The scope flag echoed as sent — what the guide's p194 recipe says should come back. */
const COUNT_AND_SCOPE = COUNT_ONLY.replace(
  "<overrideAllLocations>false</overrideAllLocations>",
  "<overrideAllLocations>true</overrideAllLocations>",
);

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

const grant = (afterXml: string, rec: SupabaseRecorder) =>
  executeCapability(
    {
      admin: rec.client, env, creds, orgId: ORG,
      fetchImpl: stub(loginOk, NO_OVERRIDE, soap(""), afterXml),
      efsCardId: CARD_ID, cardNumber: CARD, userId: USER,
      expectedVersion: versionOf(NO_OVERRIDE),
      idempotencyKey: null,
      stepUp: false,
    } satisfies CardMutationContext,
    resolveCapability(overrideGrantContract, overrideGrantBehaviour, {
      uses: 1,
      scope: { kind: "all" },
      limits: [],
      allowHandEnter: false,
      expectedVersion: versionOf(NO_OVERRIDE),
    }),
  );

const auditActions = (rec: SupabaseRecorder) =>
  rec.writtenRows("audit_logs").map((row) => row.action);

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  vi.restoreAllMocks();
});

describe("an override grant whose scope this vendor does not report back", () => {
  it("is NOT recorded as failed, and does not tell the operator to retry", async () => {
    const rec = recorder();
    const outcome = await grant(COUNT_ONLY, rec);

    // Before Step 3.11 this was `failed` / `no_change`, with the message "the card is unchanged".
    // Retrying an override does not overwrite it — it grants another one.
    expect(outcome.status).toBe("sent");
    expect(outcome.faultCode).toBe("unverified");
    expect(outcome.faultMessage).not.toMatch(/unchanged/i);
    expect(auditActions(rec)).toContain("card.mutation_unverified");
    expect(auditActions(rec)).not.toContain("card.mutation_failed");
  });

  it("records what EFS actually held, and which field it could not judge", async () => {
    const rec = recorder();
    await grant(COUNT_ONLY, rec);

    // The Phase 3 live re-run (2026-08-15) produced the first `sent` row this outcome had ever
    // written in anger, and it carried `after_document: null` — strictly LESS evidence than the
    // `failed` row it replaced, on the one outcome whose entire message is "go and look". An
    // unverified row that cannot say what the card held, or where the disagreement was, is a shrug.
    const settled = rec.writtenRows("efs_card_mutations").at(-1);
    expect(settled?.status).toBe("sent");
    expect(settled?.after_document).toMatchObject({ overrideUses: 1, overrideAllLocations: false });

    const audited = rec.writtenRows("audit_logs").find((r) => r.action === "card.mutation_unverified");
    expect(audited?.meta).toMatchObject({ unlandedFields: ["overrideAllLocations"] });
  });

  it("still shows the operator the count EFS actually holds", async () => {
    const rec = recorder();
    await grant(COUNT_ONLY, rec);

    // The badge was never wrong — it is fed from the verifying re-read. Refusing to judge the scope
    // must not cost the operator the one fact the vendor does report.
    expect(rec.writtenRows("efs_cards").at(-1)).toMatchObject({ override_uses: 1 });
  });

  it("is judged the same way by the background sweep, a cycle later", async () => {
    const after = parseCardDocument(COUNT_ONLY);
    const edits = overrideGrantEdits(parseCardDocument(NO_OVERRIDE), 1, { kind: "all" }, []);

    // `reconcile` is the sweep's predicate. Overriding only `judge` would leave the row un-condemned
    // for one sync cycle and then condemned by efsCardUnresolved.ts — the same wrong answer, late.
    expect(overrideGrantBehaviour.verify.reconcile?.({ doc: after }, edits, {}))
      .toBe("indeterminate");
  });

  it("records `succeeded` when the vendor DOES echo the scope back", async () => {
    const rec = recorder();
    const outcome = await grant(COUNT_AND_SCOPE, rec);

    // Without this the whole capability could resolve to "indeterminate" and every case above would
    // still pass. It also states the property Phase 4.4's scanner is expected to change.
    expect(outcome.status).toBe("succeeded");
  });
});

describe("the product-limit override reaches the wire (Step 10.1)", () => {
  const limits = [{ limitId: "ULSD", limit: 1000, hours: 1, minHours: 0 }];
  const body = { uses: 1, scope: { kind: "all" as const }, limits, allowHandEnter: false, expectedVersion: "" };

  it("threads the operator's products into the edit list rather than dropping them", () => {
    // The failure this pins is silent and in the expensive direction: an override that carried no
    // limits still SUCCEEDS — override and overrideAllLocations both land — so the ledger and the
    // confirmation both say a product limit was overridden while the driver is capped as before.
    // getCardV2.full.xml carries ULSD 250 and CADV 100, so the recipe has real records to replace.
    const doc = parseCardDocument(NO_OVERRIDE);
    const mutation = overrideGrantBehaviour.mutation;
    if (mutation.kind !== "echo") throw new Error("override_grant is an echo write");

    const edit = mutation.buildEdits(doc, body, {} as never).find((e) => e.name === "limits");
    expect(edit?.op).toBe("replaceAll");
    expect(edit?.op === "replaceAll" && edit.records).toEqual([
      { hours: "1", limit: "1000", limitId: "ULSD", minHours: "0" },
    ]);
    // And the removals the echo guard needs, or the write is refused before it is sent.
    expect(edit?.op === "replaceAll" && edit.removals).toEqual(["ULSD", "CADV"]);
  });

  it("demands a fresh sign-in for it, at one use, before a slot is spent", () => {
    // `preflightStepUp` runs before prepare(), so this refusal costs nothing against the daily
    // override budget. One use is the point: the reason is the deleted limits, not the count.
    expect(overrideGrantBehaviour.preflightStepUp?.(body))
      .toBe(OVERRIDE_LIMITS_STEP_UP);
    // POSITIVE CONTROL: the same grant without products asks for nothing.
    expect(overrideGrantBehaviour.preflightStepUp?.({ ...body, limits: [] })).toBeNull();
  });

  it("records the limits it deleted, so a failed vendor restore is recoverable", () => {
    // Step 10.4 asks WEX whether clearing an override restores the card's own limits. Nothing in the
    // guide promises it does. This row is what makes either answer survivable.
    const meta = overrideGrantBehaviour.auditMeta?.({ doc: parseCardDocument(NO_OVERRIDE) } as never, body, {} as never);
    expect(meta).toMatchObject({
      limitsBefore: [
        { hours: "24", limit: "250", limitId: "ULSD", minHours: "4" },
        { hours: "168", limit: "100", limitId: "CADV", minHours: "0" },
      ],
      limitsAfter: limits,
    });
  });
});

describe("the use count itself, which is what authorises a purchase", () => {
  it("is condemned as failed when it does not land, scope flag or no scope flag", async () => {
    const rec = recorder();
    // The vendor accepted the call and applied nothing: `override` still 0, `overrideAllLocations`
    // still false. Indistinguishable from the case above on the scope field alone.
    const outcome = await grant(NO_OVERRIDE, rec);

    // This is the line that keeps Step 3.11 from being a widened tolerance. The tolerance covers the
    // two fields this account never reports; it does not cover the field that grants the fuel.
    expect(outcome.status).toBe("failed");
    expect(outcome.faultCode).toBe("no_change");
    expect(auditActions(rec)).toContain("card.mutation_failed");
  });

  it("names the fields that did not land, so the failure can be acted on", async () => {
    const rec = recorder();
    await grant(NO_OVERRIDE, rec);

    // Step 3.11's investigation was told to read `drift->'unexplained'` and found it null on every
    // failed row — `finalizeFailed` never wrote it. A `no_change` naming no field is a failure
    // nobody can diagnose without reconstructing it from two jsonb columns by hand.
    const failed = rec.writtenRows("audit_logs").find((r) => r.action === "card.mutation_failed");
    expect(failed?.meta).toMatchObject({
      unlandedFields: ["override", "overrideAllLocations"],
    });
  });
});


/**
 * Step 10.3's `limitSource` guard — Step 9.4's refusal, one phase later, for the other collection.
 *
 * `getCardV2.empty.xml` is the only captured document in the repository carrying
 * `limitSource: POLICY`, which is what makes this provable offline at all. The LIVE half stays open
 * for the same reason 9.4's does.
 *
 * ── Why it went unnoticed until a QA session ────────────────────────────────────────────────────
 * QA policy 1 carries no limits and the QA cards in use sit on policy 1; production policy 1 carries
 * nine, DSL 200 and ULSD 200 among them (inventory, 2026-08-18). So the product could be built and
 * demonstrated without the question ever being asked.
 */
describe("a card that takes its product limits from the policy", () => {
  const POLICY_XML = fixture("getCardV2.empty.xml");

  const grantOn = (xml: string, rec: SupabaseRecorder, limits: OverrideGrantBody["limits"]) =>
    executeCapability(
      {
        admin: rec.client, env, creds, orgId: ORG,
        fetchImpl: stub(loginOk, xml, soap(""), xml),
        efsCardId: CARD_ID, cardNumber: CARD, userId: USER,
        expectedVersion: versionOf(xml),
        idempotencyKey: null,
        stepUp: true,
      } satisfies CardMutationContext,
      resolveCapability(overrideGrantContract, overrideGrantBehaviour, {
        uses: 1,
        scope: { kind: "all" },
        limits,
        allowHandEnter: false,
        expectedVersion: versionOf(xml),
      }),
    );

  it("refuses a PRODUCT override, because EFS would accept it and never cap anything", async () => {
    // The echo verifier cannot catch this one: the card still STORES the records, so the re-read
    // finds them and reports a clean landing for an exception that governs nothing at the pump.
    const rec = recorder();
    const error = await grantOn(POLICY_XML, rec, [
      { limitId: "ULSD", limit: 50, hours: 1, minHours: 0 },
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ActionRefusalError);
    // No password fixes it — the fix is a policy edit, which this product does not do.
    expect((error as ActionRefusalError).code).toBe("invalid_request");
    expect((error as ActionRefusalError).message).toMatch(/policy/i);
  });

  /**
   * THE CONTROL, and it is what keeps the guard from being a blanket refusal. A scope-only exception
   * touches no limits and must stay available on a POLICY-source card — it grants purchases outside
   * the card's normal caps, wherever those caps come from.
   */
  it("still allows a SCOPE-ONLY exception on the same card", async () => {
    const rec = recorder();
    const outcome = await grantOn(POLICY_XML, rec, []).catch((e: unknown) => e);
    expect(outcome).not.toBeInstanceOf(ActionRefusalError);
  });
});
