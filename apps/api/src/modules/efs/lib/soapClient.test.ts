import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../../../env.js";
import {
  RETRY_SLEEP_CAP_MS,
  __resetSoapPacing,
  capRetrySleep,
  looksLikeSoapFault,
  parseRetryAfter,
  soapFetch,
} from "./soapClient.js";

/**
 * Audit P1-1 tripwires. The property: a SOAP Fault riding HTTP 500 is the vendor's ANSWER and is
 * returned on the first attempt — never retried through backoff sleeps in a paced lane — while a
 * fault-less 5xx (a gateway blip) keeps the retry budget it always had. Plus the Retry-After cap:
 * the header is advice, our ceiling is ours.
 */

const env = loadEnv({
  NODE_ENV: "test",
  EFS_SOAP_MAX_RETRIES: "4",
  EFS_SOAP_MAX_RPS: "100",
  EFS_SOAP_INTERACTIVE_RPS: "100",
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: "true",
} as unknown as NodeJS.ProcessEnv);

const FAULT_500 =
  `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soapenv:Body><soapenv:Fault><faultstring>Not Allowed 109491436176</faultstring></soapenv:Fault>` +
  `</soapenv:Body></soapenv:Envelope>`;

function stubFetch(...responses: { status: number; body: string }[]): { impl: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (async () => {
    const next = responses[Math.min(calls, responses.length - 1)]!;
    calls += 1;
    return new Response(next.body, { status: next.status });
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

afterEach(() => __resetSoapPacing());

describe("looksLikeSoapFault", () => {
  it("recognises prefixed and bare Fault elements, and nothing else", () => {
    expect(looksLikeSoapFault(FAULT_500)).toBe(true);
    expect(looksLikeSoapFault("<Fault><faultstring>x</faultstring></Fault>")).toBe(true);
    expect(looksLikeSoapFault("<result>Faultless prose about defaults</result>")).toBe(false);
    expect(looksLikeSoapFault("<html>502 Bad Gateway</html>")).toBe(false);
  });
});

describe("capRetrySleep", () => {
  it("caps a hostile Retry-After at the backoff ceiling and passes null through", () => {
    expect(capRetrySleep(3_600_000)).toBe(RETRY_SLEEP_CAP_MS);
    expect(capRetrySleep(1_000)).toBe(1_000);
    expect(capRetrySleep(null)).toBeNull();
    expect(parseRetryAfter("3600")).toBe(3_600_000); // the parse stays honest; the CAP is separate
  });
});

describe("soapFetch fault-on-500 (audit P1-1)", () => {
  it("returns a Fault body on the FIRST attempt instead of burning the retry budget", async () => {
    const s = stubFetch({ status: 500, body: FAULT_500 });
    const out = await soapFetch(env, "org:cred", {
      url: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
      body: "<x/>", soapAction: "getPolicy", fetchImpl: s.impl,
    });
    expect(out.status).toBe(500);
    expect(out.body).toContain("Not Allowed");
    // THE assertion: one attempt. Before this fix a permanent refusal cost 5 paced attempts plus
    // backoff sleeps — the observed 15–20s card-detail pages.
    expect(s.calls()).toBe(1);
  });

  it("still retries a fault-less 5xx — a gateway blip is genuinely transient", async () => {
    const s = stubFetch(
      { status: 502, body: "<html>Bad Gateway</html>" },
      { status: 200, body: "<ok/>" },
    );
    const out = await soapFetch(env, "org:cred2", {
      url: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
      body: "<x/>", soapAction: "getPolicy", fetchImpl: s.impl,
    });
    expect(out.status).toBe(200);
    expect(s.calls()).toBe(2);
  });

  it("honors retry:false absolutely, fault or no fault", async () => {
    const s = stubFetch({ status: 502, body: "<html>Bad Gateway</html>" });
    const out = await soapFetch(env, "org:cred3", {
      url: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
      body: "<x/>", soapAction: "setCardv2", fetchImpl: s.impl, retry: false,
    });
    expect(out.status).toBe(502);
    expect(s.calls()).toBe(1);
  });
});
