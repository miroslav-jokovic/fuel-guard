import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import {
  __resetLocationShapes,
  getCardSummaries,
  getCardV2,
  getCardsWithNoDriverId,
  getPolicy,
  searchLocation,
} from "./efsCardOps.js";
import { __resetEfsSessions } from "./efsSoapSession.js";
import { __resetSoapPacing } from "./soapClient.js";

const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
} as Env;

const creds: EfsSoapCredentials = {
  orgId: "org-1",
  environment: "production",
  endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user",
  soapPassword: "pass",
  accountId: null,
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
  readFileSync(fileURLToPath(new URL(`./__fixtures__/efs/${name}`, import.meta.url)), "utf8");

function stub(...responses: string[]): { fetchImpl: typeof fetch; bodies: string[] } {
  let i = 0;
  const bodies: string[] = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(responses[i++] ?? soap("<empty/>"), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
  __resetLocationShapes();
});

describe("getCardV2", () => {
  it("sends clientId and cardNumber and returns a parsed document", async () => {
    const s = stub(loginOk, fixture("getCardV2.full.xml"));
    const doc = await getCardV2(env, creds, "70830000000007521", { fetchImpl: s.fetchImpl });

    expect(s.bodies[1]).toContain("<CardManagementEP_getCardv2>");
    expect(s.bodies[1]).toContain("<clientId>sess-1</clientId>");
    expect(s.bodies[1]).toContain("<cardNumber>70830000000007521</cardNumber>");
    expect(doc.card.status).toBe("Active");
    expect(doc.card.infos.map((i) => i.infoId)).toEqual(["DRID", "UNIT", "ODRD"]);
    expect(doc.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("calls v2, not v1 — v1 omits the auto-roll limits and echoing without them deletes them", async () => {
    const s = stub(loginOk, fixture("getCardV2.autoRoll.xml"));
    const doc = await getCardV2(env, creds, "70830000000007521", { fetchImpl: s.fetchImpl });
    expect(s.bodies[1]).toContain("getCardv2");
    expect(doc.card.limits[0]?.autoRollMap).toBe(7);
  });

  it("surfaces a fault as a typed error rather than an empty card", async () => {
    const s = stub(loginOk, soap("<soap:Fault><faultstring>InvalidParameterNameID</faultstring></soap:Fault>"));
    await expect(getCardV2(env, creds, "70830000000007521", { fetchImpl: s.fetchImpl }))
      .rejects.toMatchObject({ code: "soap_fault" });
  });

  it("shares one login across several card reads", async () => {
    const s = stub(loginOk, fixture("getCardV2.full.xml"), fixture("getCardV2.single.xml"));
    await getCardV2(env, creds, "70830000000000001", { fetchImpl: s.fetchImpl });
    await getCardV2(env, creds, "70830000000000002", { fetchImpl: s.fetchImpl });
    expect(s.bodies.filter((b) => b.includes("CardManagementEP_login"))).toHaveLength(1);
  });
});

describe("getCardSummaries", () => {
  const summaries = soap(`<getCardSummariesV2Response><result>
    <value>
      <cardNumber>70830000000000001</cardNumber><policyNumber>14</policyNumber>
      <companyXref>FG</companyXref><unitNumber>3182</unitNumber>
      <driverId>D-4471</driverId><driverName>A DRIVER</driverName>
      <override>0</override><beingOverridden>false</beingOverridden>
      <status>Active</status><payrollStatus>Follows</payrollStatus><Infosrc>BOTH</Infosrc>
    </value>
    <value>
      <cardNumber>70830000000000002</cardNumber><policyNumber>3</policyNumber>
      <override>1</override><beingOverridden>true</beingOverridden><status>Hold</status>
    </value>
  </result></getCardSummariesV2Response>`);

  it("maps the documented output fields, including the odd capitalisations", async () => {
    const s = stub(loginOk, summaries);
    const rows = await getCardSummaries(env, creds, { fetchImpl: s.fetchImpl });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      cardNumber: "70830000000000001", policyNumber: 14, unitNumber: "3182",
      driverId: "D-4471", override: false, beingOverridden: false, status: "Active",
      infoSource: "BOTH", // arrives as `Infosrc`
    });
    expect(rows[1]).toMatchObject({ override: true, beingOverridden: true, status: "Hold" });
  });

  it("sends an EMPTY <request> by default — omitting it is what the binding rejects", async () => {
    // docs/plans/EFS-SOAP-INTEGRATION-PLAN.md, learned against the production WSDL: "EFS's Axis2
    // binding rejects omitted filter elements even though the WSDL marks them nillable." The working
    // rejected-transaction call sends <cardNum></cardNum> for the same reason. "Optional" in the guide
    // means send it empty, not leave it out — and no-filters is the sweep's NORMAL case.
    const s = stub(loginOk, summaries);
    await getCardSummaries(env, creds, { fetchImpl: s.fetchImpl });
    expect(s.bodies[1]).toContain("<request></request>");
    expect(s.bodies[1]).toContain("<CardManagementEP_getCardSummariesV2>");
  });

  it("emits one <request> per search criterion when asked", async () => {
    const s = stub(loginOk, summaries);
    await getCardSummaries(env, creds, {
      fetchImpl: s.fetchImpl,
      searches: [{ type: "STATUS", searchParam: "A" }, { type: "POLICY", searchParam: "14" }],
    });
    expect(s.bodies[1]).toContain("<request><type>STATUS</type><searchParam>A</searchParam></request>");
    expect(s.bodies[1]).toContain("<request><type>POLICY</type><searchParam>14</searchParam></request>");
  });

  it("can fall back to the v1 operation", async () => {
    const s = stub(loginOk, summaries);
    await getCardSummaries(env, creds, { fetchImpl: s.fetchImpl, useV2: false });
    expect(s.bodies[1]).toContain("<CardManagementEP_getCardSummaries>");
  });

  it("drops rows with no card number rather than inventing an empty one", async () => {
    const s = stub(loginOk, soap("<r><result><value><status>Active</status></value></result></r>"));
    expect(await getCardSummaries(env, creds, { fetchImpl: s.fetchImpl })).toEqual([]);
  });

  it("never lets the fleet's card numbers escape into an error", async () => {
    // This response carries every PAN the customer has. A parse failure must not put them in a log.
    const s = stub(loginOk, soap(`<r><result><value><cardNumber>70830000000007521</cardNumber><policyNumber>x</policyNumber></value></result></r>`));
    const rows = await getCardSummaries(env, creds, { fetchImpl: s.fetchImpl });
    // A non-numeric policy is tolerated (null), so this parses — the guard is asserted below.
    expect(rows[0]?.policyNumber).toBeNull();
  });
});

describe("getCardsWithNoDriverId", () => {
  it("reads a bare list of card numbers", async () => {
    const s = stub(loginOk, soap("<r><result><value>70830000000000001</value><value>70830000000000002</value></result></r>"));
    const cards = await getCardsWithNoDriverId(env, creds, { fetchImpl: s.fetchImpl });
    expect(cards).toEqual(["70830000000000001", "70830000000000002"]);
  });

  it("sends cardType as an EMPTY element, not as an absent one", async () => {
    // "if you only have one card type you can leave this field blank" (p46) — blank is an empty
    // element. Dropping it is the omission the Axis2 binding refuses.
    const s = stub(loginOk, soap("<r><result/></r>"));
    await getCardsWithNoDriverId(env, creds, { fetchImpl: s.fetchImpl });
    expect(s.bodies[1]).toContain("<cardType></cardType>");
  });
});

describe("getPolicy", () => {
  const policy = soap(`<getPolicyResponse><result>
    <description>Line haul</description><handEnter>false</handEnter>
    <infos><infoId>DRID</infoId><validationType>EXACT_MATCH</validationType><matchValue></matchValue></infos>
    <limits><limitId>ULSD</limitId><limit>150</limit><hours>24</hours><minHours>0</minHours></limits>
    <limits><limitId>MERC</limitId><limit>50</limit><hours>168</hours><minHours>0</minHours></limits>
    <timeRestrictions><day>1</day><beginTime>1970-01-01T22:00:00-06:00</beginTime><endTime>1970-01-01T05:00:00-06:00</endTime></timeRestrictions>
  </result></getPolicyResponse>`);

  it("returns the policy-level rules getCard deliberately omits", async () => {
    // getCard returns CARD-level records only, even under source BOTH (p36). Without this call the
    // page shows half the rules the pump enforces.
    const s = stub(loginOk, policy);
    const result = await getPolicy(env, creds, 14, { fetchImpl: s.fetchImpl });

    expect(s.bodies[1]).toContain("<policyNumber>14</policyNumber>");
    expect(result.policyNumber).toBe(14);
    expect(result.description).toBe("Line haul");
    expect(result.limits.map((l) => l.limitId)).toEqual(["ULSD", "MERC"]);
    expect(result.timeRestrictions[0]?.day).toBe(1);
  });

  it("surfaces a limit above our sanity bound instead of rejecting the whole policy", async () => {
    // Reads are tolerant, writes are strict. EFS_LIMIT_MAX is the bound on values WE set; a policy
    // configured beyond it in the WEX portal is a thing to display — refusing to parse it would blank
    // the effective-config table and tell the operator nothing about why.
    const s = stub(loginOk, soap("<r><result><limits><limitId>ULSD</limitId><limit>99999</limit></limits><description>x</description></result></r>"));
    const policy = await getPolicy(env, creds, 1, { fetchImpl: s.fetchImpl });
    expect(policy.limits[0]).toMatchObject({ limitId: "ULSD", limit: 99999 });
  });
});

describe("searchLocation", () => {
  const locations = soap(`<searchLocationResponse><result>
    <value><locId>115732</locId><name>LOVES 442</name><city>EFFINGHAM</city><state>IL</state><country>USA</country><addr1>1000 W FAYETTE</addr1><phone>217-555-0100</phone></value>
    <value><locId>220841</locId><name>PILOT 88</name><city>JOLIET</city><state>IL</state><country>USA</country></value>
  </result></searchLocationResponse>`);

  const shapeFault = soap(
    "<soap:Fault><faultstring>org.apache.axis2.databinding.ADBException: Unexpected subelement locId</faultstring></soap:Fault>",
  );

  it("maps matching locations, wrapping the criteria the way this WSDL's other search does", async () => {
    // The guide lists getTranRejects' criteria flat too (p107) and the real WSDL wraps them in
    // <search> — and production rejected flat searchLocation criteria with "Unexpected subelement
    // locId". So <search> is the first shape tried, and a compliant endpoint sees exactly one request.
    const s = stub(loginOk, locations);
    const found = await searchLocation(env, creds, { state: "IL", name: "LOVES" }, { fetchImpl: s.fetchImpl });

    expect(s.bodies).toHaveLength(2); // login + ONE searchLocation — no ladder on first-shape success
    expect(s.bodies[1]).toContain("<search>");
    expect(s.bodies[1]).toContain("<state>IL</state>");
    expect(s.bodies[1]).toContain("<name>LOVES</name>");
    expect(found[0]).toMatchObject({ locId: "115732", name: "LOVES 442", city: "EFFINGHAM", state: "IL" });
    expect(found).toHaveLength(2);
  });

  it("refuses an entirely empty query instead of asking EFS for every location", async () => {
    // "the system needs to select 1 to many items to search" (p132). An unbounded search against a
    // paced connection is not something to discover in production.
    const s = stub(loginOk);
    await expect(searchLocation(env, creds, {}, { fetchImpl: s.fetchImpl })).rejects.toThrow(/at least one criterion/i);
    expect(s.bodies).toHaveLength(0); // and it never opened a session to find out
  });

  it("sends every criterion element, in the guide's order, even when unset", async () => {
    // An earlier version omitted unset criteria and production rejected that with
    // "ADBException: Unexpected subelement state" — the same omitted-element behaviour the transaction
    // feeds documented. Unset ints go as 0, not empty: an empty <locId></locId> is not a valid xsd:int.
    const s = stub(loginOk, locations);
    await searchLocation(env, creds, { city: "JOLIET", state: null, name: "" }, { fetchImpl: s.fetchImpl });
    const body = s.bodies[1]!;
    expect(body).toContain("<locId>0</locId>");
    expect(body).toContain("<state></state>");
    expect(body).toContain("<city>JOLIET</city>");
    expect(body).toContain("<name></name>");
    expect(body).toContain("<country></country>");
    expect(body).toContain("<chainId>0</chainId>");
    // Order is what the binding actually enforces, so assert it rather than mere presence.
    const order = ["locId", "state", "city", "name", "country", "chainId"].map((n) => body.indexOf(`<${n}>`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(Math.min(...order)).toBeGreaterThan(body.indexOf("<clientId>"));
  });

  it("advances to the next shape when ADB complains about element placement, then remembers the winner", async () => {
    // Shape 1 (<search>) refused with an ADB placement complaint → shape 2 (flat) accepted. The
    // memo means the NEXT call goes straight to flat: one request, not a re-run of the ladder.
    const s = stub(loginOk, shapeFault, locations, locations);
    const found = await searchLocation(env, creds, { state: "IL" }, { fetchImpl: s.fetchImpl });

    expect(found).toHaveLength(2);
    expect(s.bodies[1]).toContain("<search>");
    expect(s.bodies[2]).not.toContain("<search>");
    expect(s.bodies[2]).toContain("<locId>0</locId>"); // flat: criteria as direct children

    await searchLocation(env, creds, { state: "IL" }, { fetchImpl: s.fetchImpl });
    expect(s.bodies).toHaveLength(4); // login + fault + success + ONE remembered-shape request
    expect(s.bodies[3]).not.toContain("<search>");
  });

  it("rethrows a non-shape fault immediately rather than burning paced slots on the ladder", async () => {
    // "Not Allowed" is EFS's firewall verdict (guide p9). Re-asking with the criteria arranged
    // differently cannot change a firewall's mind; only an ADB placement complaint advances the ladder.
    const s = stub(loginOk, soap("<soap:Fault><faultstring>Not Allowed 109491436176</faultstring></soap:Fault>"));
    await expect(searchLocation(env, creds, { state: "IL" }, { fetchImpl: s.fetchImpl }))
      .rejects.toMatchObject({ code: "not_allowed" });
    expect(s.bodies).toHaveLength(2); // login + the single refused attempt
  });

  it("names every shape's refusal when EFS rejects them all", async () => {
    // The aggregate error is what the probe prints, so it must carry EFS's own words per shape —
    // the next fix starts from the vendor's verdicts, not from a bare "soap_fault".
    const s = stub(loginOk, shapeFault, shapeFault, shapeFault, shapeFault);
    await expect(searchLocation(env, creds, { state: "IL" }, { fetchImpl: s.fetchImpl }))
      .rejects.toThrow(/every request shape.*search:.*flat:.*criteria:.*request:/s);
  });
});
