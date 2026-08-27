import { afterEach, describe, expect, it } from "vitest";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { testEnv } from "../../../testing/testEnv.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";
import { applyMileageOverride, readUnitMileage } from "./efsMileageOverride.js";

/**
 * The override's verdict, decided from two reads and nothing else (`docs/37` §6 E′).
 *
 * ── Why this exists as a SERVICE test and not only through the route ────────────────────────────
 * `overrideLastMileage` returns nothing at all — the WSDL declares its response message with no
 * parts — so `landing` is the only thing that distinguishes "the reading changed" from "the vendor
 * accepted a request and did nothing". That judgement is the whole safety property of this feature
 * (standing rule 11: *a successful response is never evidence of a correct write, only a re-read
 * is*), and it lived here untested behind a route suite that could only see the outcome it chose.
 *
 * Stubbed at `fetch`, not at the ops module, so every assertion below is on the WIRE (standing rule
 * 6). The second independent route is the WSDL: `efsSecureFuelOps.test.ts` asserts these same
 * request shapes against the checked-in contract, so a body that satisfies both is not a tautology.
 */

const env = testEnv({
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
});

const creds: EfsSoapCredentials = {
  orgId: "org-1",
  environment: "sandbox",
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

const mileageRow = (unit: string, code: string, mileage: number) =>
  `<value><unit>${unit}</unit><code>${code}</code><mileage>${mileage}</mileage></value>`;

const readResponse = (rows: string) => soap(`<getLastMileageResponse><result>${rows}</result></getLastMileageResponse>`);

/**
 * A vendor that answers the two reads with DIFFERENT values, in order.
 *
 * That ordering is the point. A stub returning one fixed reading cannot tell a landed write from an
 * ignored one — both would re-read the same number — so it would pass every case below and prove
 * none of them.
 */
function stubVendor(readings: (number | null)[]) {
  const ops: string[] = [];
  const sent: string[] = [];
  let readIndex = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    sent.push(body);
    if (body.includes("<CardManagementEP_login>")) {
      return new Response(soap("<loginResponse><result>sess-42</result></loginResponse>"), { status: 200 });
    }
    if (body.includes("<CardManagementEP_overrideLastMileage>")) {
      ops.push("overrideLastMileage");
      // No parts, exactly as the WSDL declares it.
      return new Response(soap("<overrideLastMileageResponse/>"), { status: 200 });
    }
    ops.push("getLastMileage");
    // `?? null` rather than `!`: an off-by-one here would otherwise assert a reading the test never
    // declared, and "EFS holds nothing" is the honest reading of an index past the end.
    const value = readings[Math.min(readIndex, readings.length - 1)] ?? null;
    readIndex += 1;
    return new Response(readResponse(value === null ? "" : mileageRow("688", "ODRD", value)), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, ops, sent };
}

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("readUnitMileage", () => {
  it("matches on BOTH unit and code rather than trusting the first row", async () => {
    /**
     * The search is a filter, not a lookup — the portal's "All" mode proves the same operation can
     * answer with the whole fleet. A binding that ignored an unrecognised criterion would hand back
     * a row for a different truck, and `rows[0]` would report it as this one's reading.
     */
    const ops: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("<CardManagementEP_login>")) {
        return new Response(soap("<loginResponse><result>sess-42</result></loginResponse>"), { status: 200 });
      }
      ops.push("getLastMileage");
      return new Response(readResponse(mileageRow("412", "ODRD", 91204) + mileageRow("688", "ODRD", 258536)), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await readUnitMileage(env, creds, "688", "ODRD", { fetchImpl })).toBe(258536);
  });

  it("answers null, not zero, when EFS holds no reading for the unit", async () => {
    // Zero is a real odometer value for a new truck. Conflating the two would seed a baseline.
    const { fetchImpl } = stubVendor([null]);
    expect(await readUnitMileage(env, creds, "688", "ODRD", { fetchImpl })).toBeNull();
  });

  it("answers null when the vendor returns a row for a DIFFERENT unit", async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("<CardManagementEP_login>")) {
        return new Response(soap("<loginResponse><result>sess-42</result></loginResponse>"), { status: 200 });
      }
      return new Response(readResponse(mileageRow("868", "ODRD", 400000)), { status: 200 });
    }) as unknown as typeof fetch;

    // "No reading" rather than a confident wrong number — the failure this comparison exists for.
    expect(await readUnitMileage(env, creds, "688", "ODRD", { fetchImpl })).toBeNull();
  });
});

describe("applyMileageOverride", () => {
  it("reports `landed` only when the re-read shows the requested value", async () => {
    const v = stubVendor([258536, 258900]);
    const outcome = await applyMileageOverride(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl: v.fetchImpl });

    expect(outcome.landing).toBe("landed");
    expect(outcome.before).toBe(258536);
    expect(outcome.after).toBe(258900);
    expect(outcome.dispatched).toBe(true);
    // Read, write, read — the re-read is not optional, because the write says nothing.
    expect(v.ops).toEqual(["getLastMileage", "overrideLastMileage", "getLastMileage"]);
  });

  it("sends the mileage on the wire in the WSDL's parameter order", async () => {
    // Standing rule 6: the assertion is on the bytes, not on the argument object.
    const v = stubVendor([258536, 258900]);
    await applyMileageOverride(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl: v.fetchImpl });

    const write = v.sent.find((b) => b.includes("<CardManagementEP_overrideLastMileage>")) ?? "";
    expect(write).toContain("<clientId>sess-42</clientId><unit>688</unit><code>ODRD</code><mileage>258900</mileage>");
  });

  it("does NOT dispatch when EFS already holds the requested value", async () => {
    /**
     * The case that would otherwise report a fabricated success. Dispatching here spends a vendor
     * call to reach a state that already holds, and — because the response carries nothing — the
     * re-read afterwards shows the requested value whether or not the vendor acted at all. That is
     * indistinguishable from a landed write, which makes it the one case where `landed` would be
     * unfounded. Mutation `efs-mileage-already-current-dispatched` removes this skip.
     */
    const v = stubVendor([258900]);
    const outcome = await applyMileageOverride(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl: v.fetchImpl });

    expect(outcome.landing).toBe("already_current");
    expect(outcome.dispatched).toBe(false);
    expect(v.ops).toEqual(["getLastMileage"]);
    expect(v.ops).not.toContain("overrideLastMileage");
  });

  it("reports `not_landed` when the reading is unmoved after the write", async () => {
    // Accepted and silently ignored — the vendor's demonstrated response to shapes it dislikes
    // (audit W3). A 200 here is not evidence of anything.
    const v = stubVendor([258536, 258536]);
    const outcome = await applyMileageOverride(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl: v.fetchImpl });

    expect(outcome.landing).toBe("not_landed");
    expect(outcome.dispatched).toBe(true);
  });

  it("reports `indeterminate` — not `landed` — when the reading moved somewhere else", async () => {
    /**
     * The ELD feed writes this value too, so a third number is evidence something else wrote after
     * us, NOT evidence of failure and certainly not of success. Calling it `landed` would claim a
     * write landed that nothing checked; calling it `not_landed` would send an operator to repeat a
     * write that may have worked. Mutation `efs-mileage-indeterminate-as-landed` collapses it.
     */
    const v = stubVendor([258536, 259100]);
    const outcome = await applyMileageOverride(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl: v.fetchImpl });

    expect(outcome.landing).toBe("indeterminate");
    expect(outcome.after).toBe(259100);
    expect(outcome.requested).toBe(258900);
  });

  it("seeds a unit EFS holds no reading for, and calls that landed", async () => {
    // `before: null` is the new-truck case §6a E′ describes as a seed rather than a repair.
    const v = stubVendor([null, 258900]);
    const outcome = await applyMileageOverride(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl: v.fetchImpl });

    expect(outcome.before).toBeNull();
    expect(outcome.landing).toBe("landed");
    expect(outcome.dispatched).toBe(true);
  });
});
