import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { __resetLocationShapes, searchLocation } from "./efsLocationSearch.js";
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
