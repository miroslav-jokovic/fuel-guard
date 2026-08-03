import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { __resetSoapPacing } from "./soapClient.js";
import { fetchPostedTransactions, fetchRejectedTransactions, pingEfsSoap } from "./efsSoap.js";

const env = {
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
} as Env;

const creds: EfsSoapCredentials = {
  orgId: "org-1",
  environment: "production",
  endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user",
  soapPassword: "pass<&",
  accountId: null,
  postedLastCursor: null,
  rejectedLastCursor: null,
  postedLastPolledAt: null,
  rejectedLastPolledAt: null,
  postedLastSuccessAt: null,
  rejectedLastSuccessAt: null,
  postedLastError: null,
  rejectedLastError: null,
  enabled: true,
};

const soap = (body: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

function fetchSequence(...responses: string[]): { fetchImpl: typeof fetch; bodies: string[] } {
  let index = 0;
  const bodies: string[] = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(responses[index++] ?? soap("<empty/>"), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

describe("EFS SOAP operations", () => {
  afterEach(() => __resetSoapPacing());

  it("logs in, fetches posted line items, and logs out", async () => {
    const sequence = fetchSequence(
      soap("<loginResponse><result>session-123</result></loginResponse>"),
      soap(`<getMCTransExtLocV2Response><result><value><transactionId>77</transactionId><POSDate>2026-08-01</POSDate><cardNumber>1234</cardNumber><invoice>INV-7</invoice><locationName>Truck Stop</locationName><locationCity>Chicago</locationCity><locationState>IL</locationState><infos><type>UNIT</type><value>TRK-7</value></infos><infos><type>NAME</type><value>Jane Driver</value></infos><infos><type>DRID</type><value>42</value></infos><infos><type>ODRD</type><value>1000</value></infos><lineItems><category>ULSD</category><quantity>50.5</quantity><ppu>3.49</ppu><amount>176.25</amount></lineItems></value></result></getMCTransExtLocV2Response>`),
      soap("<logoutResponse/>")
    );

    const result = await fetchPostedTransactions(env, creds, null, { fetchImpl: sequence.fetchImpl });

    expect(result.rows).toEqual([
      expect.objectContaining({
        TransactionId: "77",
        "Card #": "1234",
        Invoice: "INV-7",
        Unit: "TRK-7",
        "Driver Name": "Jane Driver",
        "Driver ID": "42",
        Odometer: "1000",
        Item: "ULSD",
        Qty: "50.5",
        Amt: "176.25",
      }),
    ]);
    expect(result.pagesFetched).toBe(1);
    expect(result.responseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sequence.bodies[0]).toContain("<user>user</user><password>pass&lt;&amp;</password>");
    expect(sequence.bodies[1]).toContain("<CardManagementEP_getMCTransExtLocV2>");
    expect(sequence.bodies[1]).toContain("<clientId>session-123</clientId>");
    expect(sequence.bodies[2]).toContain("<CardManagementEP_logout>");
  });

  it("uses the WSDL search wrapper for rejected authorizations", async () => {
    const sequence = fetchSequence(
      soap("<loginResponse><result>session-456</result></loginResponse>"),
      soap("<getTranRejectsResponse><result><value><tranDate>2026-08-01T15:30:00Z</tranDate><cardNum>9876</cardNum><invoice>INV-8</invoice><locId>9</locId><locName>Stop 9</locName><locCity>Dallas</locCity><locState>TX</locState><errorCode>401</errorCode><errorDesc>LIMIT EXCEEDED</errorDesc><unit>TRK-8</unit></value></result></getTranRejectsResponse>"),
      soap("<logoutResponse/>")
    );

    const result = await fetchRejectedTransactions(env, creds, "2026-08-01T15:00:00.000Z", { fetchImpl: sequence.fetchImpl });

    expect(result.rows).toEqual([
      expect.objectContaining({
        Date: "2026-08-01T15:30:00Z",
        "Card Number": "9876",
        "Error Code": "401",
        "Error Description": "LIMIT EXCEEDED",
      }),
    ]);
    expect(sequence.bodies[1]).toContain("<CardManagementEP_getTranRejects>");
    expect(sequence.bodies[1]).toContain("<search><startDate>");
    expect(sequence.bodies[1]).toContain("<endDate>");
  });

  it("reports login failures without exposing the password", async () => {
    const sequence = fetchSequence(soap("<soap:Fault><faultstring>Invalid username or password</faultstring></soap:Fault>"));
    const result = await pingEfsSoap(env, creds, { fetchImpl: sequence.fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("auth");
      expect(result.error.message).not.toContain(creds.soapPassword);
    }
  });
});
