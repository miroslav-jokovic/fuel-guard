import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { seal, secretAad } from "../lib/secretBox.js";
import { credentialIdentityHash } from "../services/efsSoapCredentialIdentity.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { promotedCapabilitiesTable } from "../testing/promotionFixture.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * CHARACTERISATION. These tests do not say the behaviour is right — they say what it currently IS.
 *
 * Phase 3 rewrites the orchestrator underneath all five write routes: dispatch switches on
 * `mutation.kind`, snapshot/verify replace the hardcoded `getCardV2`/`intentLanded`, and the whole
 * thing grows a step loop. Its exit criterion is that this suite passes BYTE-IDENTICALLY.
 *
 * Nothing else in the repo covers route → dispatched bytes. `efsCardXml.test.ts` proves the
 * serializer against a document, `efsCardEdits.test.ts` proves the recipes against a document, and
 * `fuelCardsControl.test.ts` proves the gates — but no test has ever asserted that pressing Lock
 * produces THIS request. Which means "the tests still pass" would have proved nothing about a
 * refactor of the layer in between, and that layer is where a full-document write gets built.
 *
 * ── What is asserted, and why it is the whole body ───────────────────────────────────────────────
 * The exact `setCardv2` body, in full, for each route. Not a substring, not a field count. A
 * substring assertion passes a request that dropped an `<infos>` record it never mentioned, and a
 * dropped `<infos>` record is a deleted driver assignment (guide p137). Byte equality is the only
 * assertion that catches what this refactor could plausibly break.
 *
 * They are long. That is the cost of the property, and the property is the point.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => holder.client,
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
/** Obviously fake: `lint:secrets` scans tracked content and a realistic PAN would trip it. */
const PAN = "70830000000000000";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENDPOINT = "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/";
const IDEMPOTENCY = "11111111-1111-4111-8111-111111111111";

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: KEY,
  EFS_CARD_CONTROL_ENABLED: "true",
  // The interactive lane defaults to 1 rps; left alone these five cases spend their wall clock in
  // the pacer proving nothing.
  EFS_SOAP_INTERACTIVE_RPS: "100",
  EFS_SOAP_MAX_RPS: "100",
  /**
   * 0 = no second verifying look, and the same reasoning as the line above: the stub answers the
   * re-read with the SAME document, so four of these five cases were sleeping the full 3s default
   * before deciding a landing this suite does not assert. Each case ran at 3.1s against vitest's 5s
   * timeout — 62% of the budget — and tipped over under load in a full run, which is a red gate for
   * the suite that gates every migration in this phase.
   *
   * Nothing is weakened: what is asserted here is the DISPATCHED BYTES, which are produced before
   * any verification runs. The second look has its own coverage in efsCardControl.test.ts, in
   * "the second verifying look".
   */
  EFS_CARD_VERIFY_RETRY_MS: "0",
} as NodeJS.ProcessEnv);

const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

const soap = (body: string): string =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

/**
 * The card every case runs against, and the version the client claims to have drawn its screen from.
 *
 * `expectedVersion` must equal the version of THIS document or `planCardMutation` refuses with a 409
 * before dispatching anything — so it is computed from the fixture rather than written down, which
 * also means a change to the fixture cannot silently turn these into version-mismatch tests.
 */
let CARD_XML = fixture("getCardV2.full.xml");

function seededClient(): ReturnType<typeof createSupabaseRecorder> {
  return createSupabaseRecorder({
    // The per-user daily cap is an RPC. Without it, `card_override` and `card_prompts` fail CLOSED
    // with a 503 — deliberately, since an unmetered override is unmetered free fuel — while
    // `card_status` fails open. Seeding it keeps these tests about the dispatched bytes.
    rpc: { bump_card_write_counter: { allowed: true } },
    tables: {
      /**
       * Step 4.2. The gate now demands a promotion row per capability, so these fixtures model the
       * state migration 0193 backfills for every org whose write_entitlement is already confirmed.
       * Without it every write below refuses `not_promoted` — which is the gate working, and exactly
       * why the plan insists the backfill ship in the same change as the gate.
       */
      efs_capability_promotions: promotedCapabilitiesTable(),
      efs_card_control_settings: {
        data: {
          org_id: ORG,
          enabled: true,
          write_entitlement: "confirmed",
          require_approver: false,
          probed_identity_hash: credentialIdentityHash(env, {
            endpointUrl: ENDPOINT,
            soapUsername: "user",
            accountId: null,
          }),
        },
      },
      efs_soap_credentials: [{
        org_id: ORG,
        environment: "sandbox",
        endpoint_url: ENDPOINT,
        soap_username: "user",
        soap_password: "pass",
        soap_password_sealed: null,
        account_id: null,
        posted_last_cursor: null, rejected_last_cursor: null,
        posted_last_polled_at: null, rejected_last_polled_at: null,
        posted_last_success_at: null, rejected_last_success_at: null,
        posted_last_error: null, rejected_last_error: null,
        enabled: true,
      }],
      efs_cards: [{
        id: CARD_ID,
        org_id: ORG,
        card_number_sealed: seal(env, PAN, secretAad(ORG, "efs_card_pan")),
      }],
      // An insert must hand back an id; every other read of this table must look EMPTY, or the
      // in-flight check and the hourly cap would refuse the mutation before it dispatched.
      efs_card_mutations: (query) =>
        query.write?.method === "insert"
          ? { data: { id: "mutation-1" }, error: null }
          : { data: [], error: null, count: 0 },
    },
  });
}

/**
 * Every MUTATING vendor body the app put on the wire during one test.
 *
 * Captured by exclusion — anything that is not a login and not a `getCardv2` read — rather than by
 * matching `setCardv2`. `clearOverride` is allowed to adopt a dedicated vendor op instead of the
 * full-document echo (`plan.vendorOp`), and a capture that only recognised `setCardv2` would record
 * NOTHING for that route while still reporting a clean pass.
 */
let dispatched: string[] = [];

/**
 * Real fetch for our own server, canned SOAP for EFS.
 *
 * The suite talks to the app over HTTP, so a blanket stub would break the request under test. The
 * split is on host: 127.0.0.1 is us, anything else is the vendor.
 */
function installFetchStub(): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("127.0.0.1") || url.includes("localhost")) return realFetch(input as Parameters<typeof fetch>[0], init);

    const body = String(init?.body ?? "");
    if (body.includes("CardManagementEP_login")) {
      return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
    }
    if (!body.includes("CardManagementEP_getCardv2")) {
      dispatched.push(body);
      // A VOID success, which is what setCardv2 actually returns (zero-part response in the WSDL).
      // "EFS returned 200" means nothing; the reconciler re-reads the card regardless, which is why
      // the getCardv2 branch below serves the same document again.
      return new Response(soap("<setCardV2Response/>"), { status: 200 });
    }
    return new Response(CARD_XML, { status: 200 });
  }) as typeof fetch);
}

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "admin") throw new Error("bad token");
    return ADMIN;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(server);
});

afterEach(() => {
  vi.unstubAllGlobals();
  dispatched = [];
});

/** Drive one write route the way the drawer does, and return the bytes it put on the wire. */
async function dispatchOf(
  cardFixture: string,
  path: string,
  method: string,
  bodyFor: (version: string) => unknown,
): Promise<string> {
  CARD_XML = fixture(cardFixture);
  const body = bodyFor(parseCardDocument(CARD_XML).version);
  const recorder = seededClient();
  holder.client = recorder.client;
  installFetchStub();

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer admin",
      "Idempotency-Key": IDEMPOTENCY,
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json();
  expect(res.status, `route answered ${res.status}: ${JSON.stringify(payload)}`).toBe(200);
  expect(dispatched, "no mutating vendor call reached the wire").toHaveLength(1);
  return dispatched[0]!;
}

describe("the bytes each write route puts on the wire", () => {
  const R = `/api/fuel-cards/${CARD_ID}`;
  const F = "getCardV2.full.xml";
  const O = "getCardV2.overridden.xml";

  /**
   * The 2am action. `<status>Hold</status>` is the only field that differs from the card EFS
   * returned — every prompt, limit, location and time restriction goes back untouched.
   */
  it("locks a card to Hold", async () => {
    expect(await dispatchOf(F, `${R}/lock`, "POST", (v) => ({ expectedVersion: v, reason: "stolen overnight", status: "Hold" })))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CardManagementEP_setCardv2 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><clientId>sess-1</clientId><card><cardNumber>70830000000000000</cardNumber><companyXRef>FG-TEST</companyXRef><handEnter>DISALLOW</handEnter><infoSource>BOTH</infoSource><limitSource>CARD</limitSource><locationOverride>0</locationOverride><locationSource>BOTH</locationSource><overrideAllLocations>false</overrideAllLocations><originalStatus xsi:nil="true"/><payrollStatus>Follows</payrollStatus><override>0</override><policyNumber>14</policyNumber><status>Hold</status><timeSource>CARD</timeSource><lastUsedDate>2026-08-09T14:22:07-05:00</lastUsedDate><lastTransaction>AUTH88213</lastTransaction><payrollUse>N</payrollUse><payrollAtm>DISALLOW</payrollAtm><payrollChk>DISALLOW</payrollChk><payrollAch>DISALLOW</payrollAch><payrollWire>DISALLOW</payrollWire><payrollDebit>DISALLOW</payrollDebit><infos><infoId>DRID</infoId><lengthCheck>false</lengthCheck><matchValue>D-4471</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>UNIT</infoId><lengthCheck>false</lengthCheck><matchValue>3182</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>ODRD</infoId><lengthCheck>true</lengthCheck><matchValue></matchValue><maximum>9999999</maximum><minimum>1</minimum><reportValue></reportValue><validationType>ACCRUAL_CHECK</validationType><value>1500</value></infos><limits><hours>24</hours><limit>250</limit><limitId>ULSD</limitId><minHours>4</minHours></limits><limits><hours>168</hours><limit>100</limit><limitId>CADV</limitId><minHours>0</minHours></limits><locationGroups>4410</locationGroups><locationGroups>4411</locationGroups><locations>115732</locations><locations>220841</locations><timeRestrictions><beginTime>1970-01-01T22:00:00-06:00</beginTime><day>1</day><endTime>1970-01-01T05:00:00-06:00</endTime></timeRestrictions><timeRestrictions><beginTime>1970-01-01T23:00:00-06:00</beginTime><day>7</day><endTime>1970-01-01T04:00:00-06:00</endTime></timeRestrictions></card></CardManagementEP_setCardv2></soap:Body></soap:Envelope>`);
  });

  /**
   * The fixture is already Active, so this one is deliberately a near-zero-edit echo: what it
   * pins is that unlocking does not disturb anything else on the way through.
   */
  it("unlocks a card back to Active", async () => {
    expect(await dispatchOf(F, `${R}/unlock`, "POST", (v) => ({ expectedVersion: v, reason: "recovered" })))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CardManagementEP_setCardv2 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><clientId>sess-1</clientId><card><cardNumber>70830000000000000</cardNumber><companyXRef>FG-TEST</companyXRef><handEnter>DISALLOW</handEnter><infoSource>BOTH</infoSource><limitSource>CARD</limitSource><locationOverride>0</locationOverride><locationSource>BOTH</locationSource><overrideAllLocations>false</overrideAllLocations><originalStatus xsi:nil="true"/><payrollStatus>Follows</payrollStatus><override>0</override><policyNumber>14</policyNumber><status>Active</status><timeSource>CARD</timeSource><lastUsedDate>2026-08-09T14:22:07-05:00</lastUsedDate><lastTransaction>AUTH88213</lastTransaction><payrollUse>N</payrollUse><payrollAtm>DISALLOW</payrollAtm><payrollChk>DISALLOW</payrollChk><payrollAch>DISALLOW</payrollAch><payrollWire>DISALLOW</payrollWire><payrollDebit>DISALLOW</payrollDebit><infos><infoId>DRID</infoId><lengthCheck>false</lengthCheck><matchValue>D-4471</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>UNIT</infoId><lengthCheck>false</lengthCheck><matchValue>3182</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>ODRD</infoId><lengthCheck>true</lengthCheck><matchValue></matchValue><maximum>9999999</maximum><minimum>1</minimum><reportValue></reportValue><validationType>ACCRUAL_CHECK</validationType><value>1500</value></infos><limits><hours>24</hours><limit>250</limit><limitId>ULSD</limitId><minHours>4</minHours></limits><limits><hours>168</hours><limit>100</limit><limitId>CADV</limitId><minHours>0</minHours></limits><locationGroups>4410</locationGroups><locationGroups>4411</locationGroups><locations>115732</locations><locations>220841</locations><timeRestrictions><beginTime>1970-01-01T22:00:00-06:00</beginTime><day>1</day><endTime>1970-01-01T05:00:00-06:00</endTime></timeRestrictions><timeRestrictions><beginTime>1970-01-01T23:00:00-06:00</beginTime><day>7</day><endTime>1970-01-01T04:00:00-06:00</endTime></timeRestrictions></card></CardManagementEP_setCardv2></soap:Body></soap:Envelope>`);
  });

  /**
   * Three fields move together and the p194 recipe is the reason: `<override>` carries the USE
   * COUNT, `<locationOverride>` the location id, `<overrideAllLocations>` false because this grant is
   * scoped. Reading `override` as a boolean is the bug audit W1 caught.
   */
  it("grants a single-location override for three uses", async () => {
    expect(await dispatchOf(F, `${R}/override`, "POST", (v) => ({ expectedVersion: v, reason: "breakdown", uses: 3, scope: { kind: "location", locationId: "115732" } })))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CardManagementEP_setCardv2 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><clientId>sess-1</clientId><card><cardNumber>70830000000000000</cardNumber><companyXRef>FG-TEST</companyXRef><handEnter>DISALLOW</handEnter><infoSource>BOTH</infoSource><limitSource>CARD</limitSource><locationOverride>115732</locationOverride><locationSource>BOTH</locationSource><overrideAllLocations>false</overrideAllLocations><originalStatus xsi:nil="true"/><payrollStatus>Follows</payrollStatus><override>3</override><policyNumber>14</policyNumber><status>Active</status><timeSource>CARD</timeSource><lastUsedDate>2026-08-09T14:22:07-05:00</lastUsedDate><lastTransaction>AUTH88213</lastTransaction><payrollUse>N</payrollUse><payrollAtm>DISALLOW</payrollAtm><payrollChk>DISALLOW</payrollChk><payrollAch>DISALLOW</payrollAch><payrollWire>DISALLOW</payrollWire><payrollDebit>DISALLOW</payrollDebit><infos><infoId>DRID</infoId><lengthCheck>false</lengthCheck><matchValue>D-4471</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>UNIT</infoId><lengthCheck>false</lengthCheck><matchValue>3182</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>ODRD</infoId><lengthCheck>true</lengthCheck><matchValue></matchValue><maximum>9999999</maximum><minimum>1</minimum><reportValue></reportValue><validationType>ACCRUAL_CHECK</validationType><value>1500</value></infos><limits><hours>24</hours><limit>250</limit><limitId>ULSD</limitId><minHours>4</minHours></limits><limits><hours>168</hours><limit>100</limit><limitId>CADV</limitId><minHours>0</minHours></limits><locationGroups>4410</locationGroups><locationGroups>4411</locationGroups><locations>115732</locations><locations>220841</locations><timeRestrictions><beginTime>1970-01-01T22:00:00-06:00</beginTime><day>1</day><endTime>1970-01-01T05:00:00-06:00</endTime></timeRestrictions><timeRestrictions><beginTime>1970-01-01T23:00:00-06:00</beginTime><day>7</day><endTime>1970-01-01T04:00:00-06:00</endTime></timeRestrictions></card></CardManagementEP_setCardv2></soap:Body></soap:Envelope>`);
  });

  /**
   * Runs against `getCardV2.overridden.xml`, NOT the standard fixture. On a card with no override
   * the request is a zero-edit echo and the case would pass even if clearing were broken entirely —
   * the assertion has to start from a card that has something to clear (uses 2, location 115732).
   */
  it("clears an override that was actually set", async () => {
    expect(await dispatchOf(O, `${R}/override`, "DELETE", (v) => ({ expectedVersion: v, reason: "done" })))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CardManagementEP_setCardv2 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><clientId>sess-1</clientId><card><cardNumber>70830000000000000</cardNumber><companyXRef>FG-TEST</companyXRef><handEnter>ALLOW</handEnter><infoSource>CARD</infoSource><limitSource>CARD</limitSource><locationSource>CARD</locationSource><timeSource>CARD</timeSource><locationOverride>0</locationOverride><overrideAllLocations>false</overrideAllLocations><override>0</override><policyNumber>4</policyNumber><status>Active</status><payrollStatus>Follows</payrollStatus><infos><infoId>DRID</infoId><matchValue>D-4471</matchValue><validationType>EXACT_MATCH</validationType></infos></card></CardManagementEP_setCardv2></soap:Body></soap:Envelope>`);
  });

  /**
   * The dangerous one. `replaceAll` means the array in the request IS the card's prompts
   * afterwards, so UNIT and ODRD must come back whole — every field, not just the three the typed
   * view models. Their absence here would be two deleted prompts (guide p137).
   */
  it("changes one prompt and echoes the rest", async () => {
    expect(await dispatchOf(F, `${R}/prompts`, "POST", (v) => ({ expectedVersion: v, reason: "new driver", replaceAll: true, prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-9999", reportValue: null, remove: false }] })))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CardManagementEP_setCardv2 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><clientId>sess-1</clientId><card><cardNumber>70830000000000000</cardNumber><companyXRef>FG-TEST</companyXRef><handEnter>DISALLOW</handEnter><infoSource>BOTH</infoSource><limitSource>CARD</limitSource><locationOverride>0</locationOverride><locationSource>BOTH</locationSource><overrideAllLocations>false</overrideAllLocations><originalStatus xsi:nil="true"/><payrollStatus>Follows</payrollStatus><override>0</override><policyNumber>14</policyNumber><status>Active</status><timeSource>CARD</timeSource><lastUsedDate>2026-08-09T14:22:07-05:00</lastUsedDate><lastTransaction>AUTH88213</lastTransaction><payrollUse>N</payrollUse><payrollAtm>DISALLOW</payrollAtm><payrollChk>DISALLOW</payrollChk><payrollAch>DISALLOW</payrollAch><payrollWire>DISALLOW</payrollWire><payrollDebit>DISALLOW</payrollDebit><infos><infoId>DRID</infoId><lengthCheck>false</lengthCheck><matchValue>D-9999</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>UNIT</infoId><lengthCheck>false</lengthCheck><matchValue>3182</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos><infos><infoId>ODRD</infoId><lengthCheck>true</lengthCheck><matchValue></matchValue><maximum>9999999</maximum><minimum>1</minimum><reportValue></reportValue><validationType>ACCRUAL_CHECK</validationType><value>1500</value></infos><limits><hours>24</hours><limit>250</limit><limitId>ULSD</limitId><minHours>4</minHours></limits><limits><hours>168</hours><limit>100</limit><limitId>CADV</limitId><minHours>0</minHours></limits><locationGroups>4410</locationGroups><locationGroups>4411</locationGroups><locations>115732</locations><locations>220841</locations><timeRestrictions><beginTime>1970-01-01T22:00:00-06:00</beginTime><day>1</day><endTime>1970-01-01T05:00:00-06:00</endTime></timeRestrictions><timeRestrictions><beginTime>1970-01-01T23:00:00-06:00</beginTime><day>7</day><endTime>1970-01-01T04:00:00-06:00</endTime></timeRestrictions></card></CardManagementEP_setCardv2></soap:Body></soap:Envelope>`);
  });

});
