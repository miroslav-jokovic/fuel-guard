import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { __resetEfsSessions } from "./efsSoapSession.js";
import { __resetSoapPacing } from "./soapClient.js";
import { testEnv } from "../../../testing/testEnv.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import {
  getCardRefreshingLimits,
  getCarrierInfo,
  getContracts,
  getCreditLimits,
  getLocationGroupDescriptions,
  getLocationGroups,
  getPolicyDescriptions,
  getPolicyRefreshingLimits,
  getProductGroups,
  getProducts,
  getPromptTypes,
  getSitePolicyDescriptions,
  serverTime,
} from "./efsAccountOps.js";

/**
 * Step 7.1's Verify: *"one recorded fixture per op; assert the request wrapper and `clientId`, and
 * that the parse matches."*
 *
 * ── ⚠ These fixtures are WSDL-DERIVED, not recorded. Read this before trusting them ─────────────
 * The step asks for RECORDED fixtures and this container has no route to EFS, so they are
 * hand-written against `docs/efs/CardManagementWS.wsdl`. That is a genuinely weaker artefact and the
 * difference is not cosmetic: a recorded fixture proves what the vendor SENDS, while these prove
 * only what the vendor DECLARES. Values, capitalisation, `xsi:nil` habits and the presence of
 * undeclared extra fields are all things only a live read settles — and this account has already
 * produced two surprises of exactly that kind (a `status` outside the documented enum, and an
 * `infosrc` the constraint rejected).
 *
 * So there are three tiers of assertion here, and only the first two are worth much offline:
 *
 *   1. REQUEST SHAPE — fully trustworthy. It is our own output, and the wrapper name and `clientId`
 *      are checkable against the WSDL with no vendor involved.
 *   2. FIXTURE FIDELITY — `every fixture field is declared in the WSDL` below. This is what makes a
 *      hand-written fixture worth anything: it cannot invent a field the vendor never declared, so a
 *      parser written to satisfy it cannot be satisfying a field that does not exist.
 *   3. PARSE — real, but only as good as tier 2.
 *
 * **A live session must re-record these.** Until then, treat a green run here as "the parser matches
 * the contract", never as "the parser matches production".
 */

const ORG = "org-1";
const env = testEnv({
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
});

const creds: EfsSoapCredentials = {
  orgId: ORG,
  environment: "sandbox",
  endpointUrl: "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user", soapPassword: "pass", accountId: null,
  postedLastCursor: null, rejectedLastCursor: null,
  postedLastPolledAt: null, rejectedLastPolledAt: null,
  postedLastSuccessAt: null, rejectedLastSuccessAt: null,
  postedLastError: null, rejectedLastError: null,
  enabled: true, fromEnvFallback: false, tls: null,
};

const WSDL = readFileSync(fileURLToPath(new URL("../../../../../../docs/efs/CardManagementWS.wsdl", import.meta.url)), "utf8");
const fixture = (op: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/efs/account/${op}.xml`, import.meta.url)), "utf8");

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>sess-42</result></loginResponse>");

/**
 * Every request body this run sent, so the wrapper and clientId can be asserted on the WIRE.
 *
 * `requestFor(op)` finds the operation's request by CONTENT, never by index. `withEfsSession` caches
 * a session per endpoint, so whether a login precedes the operation depends on what ran before it —
 * indexing `sent[1]` passed for the first call in a test and silently read an empty string for the
 * second and third, which is how the `policy` parameter case first "failed".
 */
function recordingFetch(response: string): {
  fetch: typeof fetch;
  sent: string[];
  requestFor: (op: string) => string;
} {
  const sent: string[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    sent.push(body);
    // The login is `<CardManagementEP_login>`, so match the OPERATION, not a bare "<login".
    return new Response(body.includes("<CardManagementEP_login>") ? loginOk : response, { status: 200 });
  }) as unknown as typeof fetch;
  return {
    fetch: impl,
    sent,
    requestFor: (op: string) => sent.find((b) => b.includes(`<CardManagementEP_${op}>`)) ?? "",
  };
}

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

/**
 * The thirteen, as one table.
 *
 * Derived rather than hand-listed per test (standing lesson 4.4): the coverage assertion at the
 * bottom compares this table against the operations `efsAccountOps.ts` actually emits, so an
 * operation added to the module without a row here fails rather than going quietly untested.
 */
type Impl = { fetchImpl: typeof fetch };
const OPERATIONS = [
  { op: "getCarrierInfo", run: (o: Impl) => getCarrierInfo(env, creds, o) },
  { op: "getPromptTypes", run: (o: Impl) => getPromptTypes(env, creds, o) },
  { op: "getPolicyDescriptions", run: (o: Impl) => getPolicyDescriptions(env, creds, o) },
  { op: "getProducts", run: (o: Impl) => getProducts(env, creds, o) },
  { op: "getProductGroups", run: (o: Impl) => getProductGroups(env, creds, o) },
  { op: "getContracts", run: (o: Impl) => getContracts(env, creds, o) },
  { op: "getCreditLimits", run: (o: Impl) => getCreditLimits(env, creds, 5501, o) },
  { op: "getCardRefreshingLimits", run: (o: Impl) => getCardRefreshingLimits(env, creds, "70830000000000001", o) },
  { op: "getPolicyRefreshingLimits", run: (o: Impl) => getPolicyRefreshingLimits(env, creds, 14, o) },
  { op: "getLocationGroupDescriptions", run: (o: Impl) => getLocationGroupDescriptions(env, creds, o) },
  { op: "getLocationGroups", run: (o: Impl) => getLocationGroups(env, creds, { policyNumber: 14 }, o) },
  { op: "getSitePolicyDescriptions", run: (o: Impl) => getSitePolicyDescriptions(env, creds, o) },
  { op: "serverTime", run: (o: Impl) => serverTime(env, creds, o) },
] as const;

describe("request shape — our own output, and the tier that needs no vendor", () => {
  for (const { op, run } of OPERATIONS) {
    it(`${op} sends the CardManagementEP_${op} wrapper carrying clientId`, async () => {
      const { fetch: fetchImpl, requestFor } = recordingFetch(fixture(op));
      await run({ fetchImpl });

      const body = requestFor(op);
      expect(body).toContain(`<CardManagementEP_${op}>`);
      expect(body).toContain(`</CardManagementEP_${op}>`);
      // The session's clientId, not a literal: every one of these is `parameterOrder="clientId …"`.
      expect(body).toContain("<clientId>sess-42</clientId>");
    });
  }

  it("sends the parameters the WSDL names, with the WSDL's spelling", async () => {
    /**
     * The three that take more than `clientId`, and every one of them is a name that would have been
     * guessed wrongly:
     *   getCreditLimits            contractId  (not contract, not contractNumber)
     *   getPolicyRefreshingLimits  policy      (NOT policyNumber — every other policy op uses that)
     *   getCardRefreshingLimits    cardNumber
     * Read from `parameterOrder` in the checked-in WSDL.
     */
    const check = async (op: string, run: (o: Impl) => Promise<unknown>, param: string, value: string) => {
      const { fetch: fetchImpl, requestFor } = recordingFetch(fixture(op));
      await run({ fetchImpl });
      expect(requestFor(op), `${op} must send <${param}>`).toContain(`<${param}>${value}</${param}>`);
    };
    await check("getCreditLimits", (o) => getCreditLimits(env, creds, 5501, o), "contractId", "5501");
    await check("getPolicyRefreshingLimits", (o) => getPolicyRefreshingLimits(env, creds, 14, o), "policy", "14");
    await check(
      "getCardRefreshingLimits",
      (o) => getCardRefreshingLimits(env, creds, "70830000000000001", o),
      "cardNumber", "70830000000000001",
    );
  });

  it("uses `policy`, never `policyNumber`, for getPolicyRefreshingLimits", async () => {
    // The positive control for the case above. `policyNumber` is what the other four policy-shaped
    // operations use, so this is the one an author copies in by muscle memory — and Axis2 answers a
    // wrong parameter name with a shape fault, not a helpful message.
    const { fetch: fetchImpl, requestFor } = recordingFetch(fixture("getPolicyRefreshingLimits"));
    await getPolicyRefreshingLimits(env, creds, 14, { fetchImpl });
    expect(requestFor("getPolicyRefreshingLimits")).not.toContain("<policyNumber>");
  });
});

describe("fixture fidelity — what makes a hand-written fixture worth anything", () => {
  it("every element in every fixture is declared somewhere in the WSDL", () => {
    /**
     * The assertion that stops this suite being a tautology (standing rule 6). The fixtures are
     * hand-written and the parsers were written to satisfy them, so on its own "the parser parses the
     * fixture" proves only that one author was self-consistent.
     *
     * The WSDL is the second, independent route: it came from the vendor. If a fixture carried a
     * field EFS never declares — the natural way to hand-write a plausible-looking response — the
     * parser built for it would be reading something that does not exist, and this fails.
     *
     * It does NOT prove the reverse (that EFS sends only what it declares); that is what a recorded
     * fixture is for, and Step 7.3 is the step that closes it.
     */
    const declared = new Set([
      ...[...WSDL.matchAll(/<element[^>]*\bname="([^"]+)"/g)].map((m) => m[1]!),
      ...[...WSDL.matchAll(/<part\s+name="([^"]+)"/g)].map((m) => m[1]!),
    ]);
    // SOAP envelope scaffolding is ours, not the vendor's schema.
    const envelope = new Set(["Envelope", "Body", "soap:Envelope", "soap:Body"]);

    const offenders: string[] = [];
    for (const { op } of OPERATIONS) {
      const xml = fixture(op);
      for (const [, tag] of xml.matchAll(/<([A-Za-z][A-Za-z0-9]*)[\s/>]/g)) {
        const name = tag!;
        if (envelope.has(name) || name === `${op}Response` || name === "value") continue;
        if (!declared.has(name)) offenders.push(`${op}.xml: <${name}>`);
      }
    }
    expect(offenders, "fixture fields not declared anywhere in the WSDL").toEqual([]);
  });

  it("covers all thirteen operations the module exports", () => {
    // Derived, not hand-counted. An operation added to `efsAccountOps.ts` without a row in
    // OPERATIONS above fails here rather than shipping untested.
    const source = readFileSync(fileURLToPath(new URL("./efsAccountOps.ts", import.meta.url)), "utf8");
    const emitted = new Set([...source.matchAll(/<CardManagementEP_([A-Za-z0-9]+)>/g)].map((m) => m[1]!));
    // `Set<string>`, not the literal union `as const` infers: the point is to compare against
    // whatever the MODULE emits, which is by definition not constrained to this table.
    const tested = new Set<string>(OPERATIONS.map((o) => o.op));
    expect([...emitted].filter((op) => !tested.has(op)), "operations with no test").toEqual([]);
    expect(tested.size).toBe(13);
  });

  /**
   * The invariant the module's header rests on: this file is read-only, which is why Step 7.2 exposes
   * it with no probe flag and why it is safe against the production org.
   *
   * `overrideLastMileage` is the first operation in this integration that could break it, and it is
   * the natural one to add here — its read half lives in this file. Asserting the absence keeps that
   * decision from being undone by a later author following the wrong local convention.
   */
  it("emits no operation that can change anything at EFS", () => {
    const source = readFileSync(fileURLToPath(new URL("./efsAccountOps.ts", import.meta.url)), "utf8");
    const emitted = [...source.matchAll(/<CardManagementEP_([A-Za-z0-9]+)>/g)].map((m) => m[1]!);
    const writers = emitted.filter((op) => /^(set|create|delete|remove|override|register|transfer|issue|stop)/.test(op));
    expect(writers, "efsAccountOps.ts must stay read-only — see the module header").toEqual([]);
  });
});

describe("parse — as good as the fixtures above, and no better", () => {
  it("getCarrierInfo reads the account identity and the location-group capability flag", async () => {
    const { fetch: impl } = recordingFetch(fixture("getCarrierInfo"));
    const result = await getCarrierInfo(env, creds, { fetchImpl: impl });
    expect(result).toEqual({ name: "FUELGUARD TEST CARRIER", carrierId: 884412, locationGroups: true });
  });

  it("getPromptTypes reads bare <value> leaves, which resultRecords would have dropped", async () => {
    // A StringArray's records have no children, so the generic record walker discards them — the
    // same shape getCardsWithNoDriverId handles with its own reader.
    const { fetch: impl } = recordingFetch(fixture("getPromptTypes"));
    expect(await getPromptTypes(env, creds, { fetchImpl: impl })).toEqual(["DRID", "UNIT", "ODOM", "NAME", "TRIP"]);
  });

  it("getPolicyDescriptions keeps a policy whose description is xsi:nil", async () => {
    const { fetch: impl } = recordingFetch(fixture("getPolicyDescriptions"));
    const rows = await getPolicyDescriptions(env, creds, { fetchImpl: impl });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ contractId: 5501, description: "OVER THE ROAD", policyNumber: 1 });
    // Nil is a null description, NOT a dropped policy: policy 14 exists and cards point at it.
    expect(rows[1]).toEqual({ contractId: 5501, description: null, policyNumber: 14 });
  });

  it("getProducts reads the vocabulary a limitId refers to", async () => {
    const { fetch: impl } = recordingFetch(fixture("getProducts"));
    const rows = await getProducts(env, creds, { fetchImpl: impl });
    expect(rows[0]).toMatchObject({ code: "ULSD", description: "ULTRA LOW SULFUR DIESEL", group: "FUEL" });
    expect(rows[1]).toMatchObject({ code: "RFR", phraseId: null, shellPriceGroup: null });
  });

  it("getProductGroups reads isFuel, which decides gallons versus dollars", async () => {
    const { fetch: impl } = recordingFetch(fixture("getProductGroups"));
    const rows = await getProductGroups(env, creds, { fetchImpl: impl });
    expect(rows.map((r) => [r.groupId, r.isFuel])).toEqual([["FUEL", true], ["CADV", false]]);
  });

  it("getContracts reads the contractId getCreditLimits is then called per", async () => {
    const { fetch: impl } = recordingFetch(fixture("getContracts"));
    const rows = await getContracts(env, creds, { fetchImpl: impl });
    expect(rows[0]).toMatchObject({ contractId: 5501, currency: "USD", masterContract: true, checkFee: 2.5 });
  });

  it("getCreditLimits keeps uom, without which every amount here is unlabelled", async () => {
    const { fetch: impl } = recordingFetch(fixture("getCreditLimits"));
    const limits = await getCreditLimits(env, creds, 5501, { fetchImpl: impl });
    expect(limits).toMatchObject({ creditAvailable: 18342.17, dailyAvailable: 9120.44, uom: "USD" });
  });

  it("getCardRefreshingLimits reads <cardRefreshingLimitsData>, NOT <result>", async () => {
    /**
     * The trap the plan's "follow getPolicy exactly" would have walked into. `getPolicy` reads
     * `<result>`; this operation's WSDL response part is `cardRefreshingLimitsData`, so a template
     * copy would have found nothing and reported a card with no refreshing limits — indistinguishable
     * from a card that genuinely has none.
     */
    const { fetch: impl } = recordingFetch(fixture("getCardRefreshingLimits"));
    const limits = await getCardRefreshingLimits(env, creds, "70830000000000001", { fetchImpl: impl });
    expect(limits).toEqual({
      refreshingLimitSource: "POLICY",
      dayCntLimit: 2, dayAmtLimit: 500,
      weekCntLimit: null, weekAmtLimit: null,
      monCntLimit: 20, monAmtLimit: 6000,
    });
  });

  it("getPolicyRefreshingLimits reads <policyRefreshingLimitsData>, NOT <result>", async () => {
    const { fetch: impl } = recordingFetch(fixture("getPolicyRefreshingLimits"));
    expect(await getPolicyRefreshingLimits(env, creds, 14, { fetchImpl: impl })).toEqual({
      dayCntLimit: 3, dayAmtLimit: 750,
      weekCntLimit: 12, weekAmtLimit: 3000,
      monCntLimit: null, monAmtLimit: null,
    });
  });

  it("getLocationGroupDescriptions distinguishes a rule-based group from an explicit one", async () => {
    // ruleBased matters downstream: a rule-based group's membership is computed by EFS and cannot be
    // enumerated with getLocGrpLocs the way an explicit group's can.
    const { fetch: impl } = recordingFetch(fixture("getLocationGroupDescriptions"));
    const rows = await getLocationGroupDescriptions(env, creds, { fetchImpl: impl });
    expect(rows.map((r) => [r.grpId, r.ruleBased, r.editable])).toEqual([[41, false, true], [42, true, false]]);
  });

  it("getLocationGroups sends both filters even when only one is set", async () => {
    // elAlways, not el: this binding rejects omitted filter elements even where the WSDL marks them
    // nillable — the rejected-feed request is the proof, and searchLocation is where it bit.
    const { fetch: impl, requestFor } = recordingFetch(fixture("getLocationGroups"));
    const rows = await getLocationGroups(env, creds, { policyNumber: 14 }, { fetchImpl: impl });
    expect(requestFor("getLocationGroups")).toContain("<cardNum></cardNum>");
    expect(requestFor("getLocationGroups")).toContain("<policyNum>14</policyNum>");
    expect(rows[0]).toEqual({ grpId: 41, name: "APPROVED TRUCK STOPS", carrierId: 884412 });
  });

  it("getSitePolicyDescriptions keeps a site policy with no policy behind it", async () => {
    // The nested WSPolicyDescription is nillable, so "absent" is a state EFS can report and must not
    // become a dropped row — the site policy still exists and still governs a pump.
    const { fetch: impl } = recordingFetch(fixture("getSitePolicyDescriptions"));
    const rows = await getSitePolicyDescriptions(env, creds, { fetchImpl: impl });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sitePolicyPolicy).toEqual({ contractId: 5501, description: "OVER THE ROAD", policyNumber: 1 });
    expect(rows[1]!.sitePolicyPolicy).toBeNull();
  });

  it("serverTime returns the vendor string verbatim, offset and all", async () => {
    /**
     * NOT parsed to a Date. The whole point of asking is to compare EFS's clock against ours, and EFS
     * servers are Central Time with an optional offset (p10-11) — `new Date()` on a bare timestamp
     * lands five or six hours out, which would answer the question wrongly while looking like an
     * answer. `parseEfsDateTime` exists for exactly this and the caller decides when to use it.
     */
    const { fetch: impl } = recordingFetch(fixture("serverTime"));
    expect(await serverTime(env, creds, { fetchImpl: impl })).toBe("2026-08-16T09:41:07.000-05:00");
  });

  
  
  
  });
