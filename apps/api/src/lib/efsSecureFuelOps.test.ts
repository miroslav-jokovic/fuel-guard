import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { __resetEfsSessions } from "./efsSoapSession.js";
import { __resetSoapPacing } from "./soapClient.js";
import { testEnv } from "../testing/testEnv.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { doesCardPosition, getLastMileage, overrideLastMileage } from "./efsSecureFuelOps.js";

/**
 * The three odometer / SecureFuel operations (`docs/37` §6).
 *
 * Split out of `efsAccountOps.test.ts` when the operations themselves were split out of that module,
 * and it keeps that suite's three tiers: request shape is fully trustworthy (it is our own output,
 * checkable against the WSDL with no vendor involved), fixture fidelity is what makes a hand-written
 * fixture worth anything, and the parse is real but only as good as the fidelity check above it.
 *
 * ⚠ **The fixtures are WSDL-DERIVED, not recorded** — except one row. The first `getLastMileage`
 * record is transcribed from a WEX portal screenshot taken 2026-08-16 (unit 688, 258536), which
 * makes it the only value here that a human has actually seen the vendor produce. Everything else
 * proves what the vendor DECLARES, never what it SENDS. A live read must still re-record these.
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

const WSDL = readFileSync(fileURLToPath(new URL("../../../../docs/efs/CardManagementWS.wsdl", import.meta.url)), "utf8");
const fixture = (op: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/efs/account/${op}.xml`, import.meta.url)), "utf8");

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>sess-42</result></loginResponse>");

function recordingFetch(response: string): {
  fetch: typeof fetch;
  sent: string[];
  requestFor: (op: string) => string;
} {
  const sent: string[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    sent.push(body);
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

describe("request shape", () => {
  it("doesCardPosition sends its wrapper carrying clientId, and nothing else", async () => {
    const { fetch: fetchImpl, requestFor } = recordingFetch(fixture("doesCardPosition"));
    await doesCardPosition(env, creds, { fetchImpl });

    const body = requestFor("doesCardPosition");
    expect(body).toContain("<CardManagementEP_doesCardPosition>");
    expect(body).toContain("<clientId>sess-42</clientId>");
  });

  it("getLastMileage wraps its criteria in <search>, on the WSDL's authority", async () => {
    /**
     * `efsLocationSearch.ts` had to find its wrapper by trying shapes against the live binding and
     * remembering which one ADB accepted, because the WSDL was unavailable when it was written. It
     * is available now and names the part `search`, so this is asserted from the contract rather
     * than discovered from a fault.
     */
    const { fetch: fetchImpl, requestFor } = recordingFetch(fixture("getLastMileage"));
    await getLastMileage(env, creds, { unit: "688", code: "ODRD" }, { fetchImpl });
    expect(requestFor("getLastMileage")).toContain("<search><unit>688</unit><code>ODRD</code></search>");
  });

  it("getLastMileage sends both criteria empty when asked for every unit", async () => {
    // Empty ELEMENTS, not absent ones — this binding rejects omitted filter elements even where the
    // WSDL marks them nillable. It is the wire equivalent of the portal's "All" radio.
    const { fetch: fetchImpl, requestFor } = recordingFetch(fixture("getLastMileage"));
    await getLastMileage(env, creds, {}, { fetchImpl });
    expect(requestFor("getLastMileage")).toContain("<search><unit></unit><code></code></search>");
  });

  it("overrideLastMileage sends the four parameters in the WSDL's order", async () => {
    // `parameterOrder="clientId unit code mileage"`. Axis2 answers a reordered body with a dispatch
    // fault rather than a helpful message, so the order is asserted as one string.
    const { fetch: fetchImpl, requestFor } = recordingFetch(soap("<overrideLastMileageResponse/>"));
    await overrideLastMileage(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl });

    expect(requestFor("overrideLastMileage")).toContain(
      "<clientId>sess-42</clientId><unit>688</unit><code>ODRD</code><mileage>258900</mileage>",
    );
  });
});

describe("fixture fidelity", () => {
  it("every element in both fixtures is declared somewhere in the WSDL", () => {
    // What stops this suite being a tautology: the fixtures are hand-written and the parsers were
    // written to satisfy them, so the WSDL is the second, independent route. A fixture carrying a
    // field EFS never declares would mean a parser reading something that does not exist.
    const declared = new Set([
      ...[...WSDL.matchAll(/<element[^>]*\bname="([^"]+)"/g)].map((m) => m[1]!),
      ...[...WSDL.matchAll(/<part\s+name="([^"]+)"/g)].map((m) => m[1]!),
    ]);
    const envelope = new Set(["Envelope", "Body", "soap:Envelope", "soap:Body"]);

    const offenders: string[] = [];
    for (const op of ["doesCardPosition", "getLastMileage"]) {
      for (const [, tag] of fixture(op).matchAll(/<([A-Za-z][A-Za-z0-9]*)[\s/>]/g)) {
        const name = tag!;
        if (envelope.has(name) || name === `${op}Response` || name === "value") continue;
        if (!declared.has(name)) offenders.push(`${op}.xml: <${name}>`);
      }
    }
    expect(offenders, "fixture fields not declared anywhere in the WSDL").toEqual([]);
  });

  it("covers every operation the module emits", () => {
    // Derived, not hand-counted. A fourth operation added to the module without a test fails here
    // rather than shipping untested.
    const source = readFileSync(fileURLToPath(new URL("./efsSecureFuelOps.ts", import.meta.url)), "utf8");
    const emitted = new Set([...source.matchAll(/<CardManagementEP_([A-Za-z0-9]+)>/g)].map((m) => m[1]!));
    expect([...emitted].sort()).toEqual(["doesCardPosition", "getLastMileage", "overrideLastMileage"]);
  });
});

describe("parse", () => {
  it("doesCardPosition reads its own part name, not `result`", async () => {
    /**
     * The trap that matters most in this file. A parser reaching for `<result>` finds nothing,
     * `bool(null)` is null, and an account that DOES use SecureFuel reads exactly like an account we
     * could not ask — and both render to an operator as "not on".
     */
    const { fetch: impl } = recordingFetch(fixture("doesCardPosition"));
    expect(await doesCardPosition(env, creds, { fetchImpl: impl })).toBe(true);
  });

  it("getLastMileage parses both codes, in the wire's spelling", async () => {
    // The first row is the 2026-08-16 portal capture. The portal renders `Code` as "odometer"; the
    // wire value is `ODRD`, and taking the label for a wire value would send a code this vendor has
    // never seen — into an operation that returns nothing to say so.
    const { fetch: impl } = recordingFetch(fixture("getLastMileage"));
    expect(await getLastMileage(env, creds, {}, { fetchImpl: impl })).toEqual([
      { unit: "688", code: "ODRD", mileage: 258536 },
      { unit: "412", code: "HBRD", mileage: 91204 },
    ]);
  });

  it("overrideLastMileage returns nothing, because the vendor returns nothing", async () => {
    /**
     * Not a formality. `CardManagementEP_overrideLastMileageResponse` is declared with NO PARTS, so
     * there is no result text to classify and no document to diff — a dispatch that returns proves
     * only that the request was accepted. The `void` return type is what stops a caller mistaking
     * that for the reading having changed; landing is judged by re-reading, in
     * `services/efsMileageOverride.ts`.
     */
    const { fetch: impl } = recordingFetch(soap("<overrideLastMileageResponse/>"));
    expect(await overrideLastMileage(env, creds, { unit: "688", code: "ODRD", mileage: 258900 }, { fetchImpl: impl }))
      .toBeUndefined();
  });
});
