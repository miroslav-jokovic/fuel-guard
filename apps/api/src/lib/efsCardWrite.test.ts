import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { parseCardDocument } from "./efsCardXml.js";
import { classifySetCardResponse, editsLanded, isDecline, setCardV2 } from "./efsCardWrite.js";
import { EfsSoapError, __resetEfsSessions } from "./efsSoapSession.js";
import { __resetSoapPacing } from "./soapClient.js";

/**
 * The write operation. Four properties are load-bearing and each has a test that fails loudly if it
 * regresses:
 *
 *   1. The request is a FULL echo — every field of the response comes back, changed ones changed.
 *   2. Fidelity is asserted on the bytes ACTUALLY SENT, so a broken serializer sends nothing.
 *   3. Writes are NEVER retried. A timed-out setCardV2 may have landed.
 *   4. "No news is good news": an empty 200 is success; a decline is a decline.
 */

const env = {
  EFS_SOAP_MAX_RPS: 100,
  // The interactive lane defaults to 1 rps. Left at the default these suites spend most of their
  // wall clock inside the pacer proving nothing.
  EFS_SOAP_INTERACTIVE_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 4, // deliberately non-zero: the retry:false test must prove OUR flag, not this
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
const doc = () => parseCardDocument(fixture("getCardV2.full.xml"));

/** An obviously fake number: `lint:secrets` scans tracked content and a realistic PAN would trip it. */
const CARD = "70830000000000000";

function stub(...responses: (string | { status: number; body: string })[]): {
  fetchImpl: typeof fetch;
  bodies: string[];
  calls: number;
} {
  let i = 0;
  const state = { calls: 0 };
  const bodies: string[] = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    state.calls += 1;
    bodies.push(String(init?.body ?? ""));
    const next = responses[i++] ?? soap("");
    return typeof next === "string"
      ? new Response(next, { status: 200 })
      : new Response(next.body, { status: next.status });
  }) as typeof fetch;
  return { fetchImpl, bodies, get calls() { return state.calls; } };
}

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("setCardV2 — the request", () => {
  it("echoes the whole document and applies only the named edit", async () => {
    const s = stub(loginOk, soap(""));
    const before = doc();
    await setCardV2(env, creds, before, CARD, [{ op: "setField", name: "status", value: "Hold" }], {
      fetchImpl: s.fetchImpl,
    });

    const sent = s.bodies[1]!;
    expect(sent).toContain("<CardManagementEP_setCardV2");
    expect(sent).toContain("<clientId>sess-1</clientId>");
    expect(sent).toContain(`<cardNumber>${CARD}</cardNumber>`);
    expect(sent).toContain("<status>Hold</status>");
    // The single most important assertion in this file: every prompt the card had is still there.
    // One dropped <infos> record is one deleted driver assignment (guide p137).
    const infosSent = sent.match(/<infos>/g)?.length ?? 0;
    expect(infosSent).toBe(before.card.infos.length);
    expect(infosSent).toBeGreaterThan(0);
  });

  it("refuses to send a request that does not faithfully echo the card", async () => {
    const s = stub(loginOk, soap(""));
    const before = doc();
    // A corrupted document: the edit names a collection the serializer will render from the DOM, but
    // the edit list claims a record count that does not match what will be emitted.
    await expect(
      setCardV2(env, creds, before, CARD, [
        // `replaceAll` with a record whose fields differ from what the serializer emits is caught by
        // the canonical diff — the guard compares field PATHS, not just counts.
        { op: "appendRecord", name: "infos", record: { infoId: "DRID" } },
        { op: "appendRecord", name: "infos", record: { infoId: "DRID" } },
        // ...and then a removeAll that contradicts both appends, so expectation and reality diverge.
        { op: "removeAll", name: "infos" },
      ], { fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({ code: "echo_unfaithful" });
    // Login happened; the write did NOT.
    expect(s.calls).toBe(1);
  });

  it("does not retry a write, even when the transport would", async () => {
    // A 500 is normally retriable (soapClient retries 5xx). A write must not be.
    const s = stub(loginOk, { status: 500, body: "boom" }, soap(""));
    await expect(
      setCardV2(env, creds, doc(), CARD, [{ op: "setField", name: "status", value: "Hold" }], {
        fetchImpl: s.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(EfsSoapError);
    // Exactly two calls: the login and ONE write. A third would mean a second write reached EFS.
    expect(s.calls).toBe(2);
  });
});

describe("setCardV2 — reading the answer", () => {
  it("treats an empty 200 as success (no news is good news, p9)", async () => {
    const s = stub(loginOk, soap("<setCardV2Response/>"));
    const result = await setCardV2(env, creds, doc(), CARD, [], { fetchImpl: s.fetchImpl });
    expect(result.shape).toBe("empty");
    expect(result.resultText).toBeNull();
  });

  it("treats Result -1 as a decline", async () => {
    const s = stub(loginOk, soap("<setCardV2Response><result>-1</result></setCardV2Response>"));
    await expect(
      setCardV2(env, creds, doc(), CARD, [], { fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({ code: "declined" });
  });

  it("treats decline TEXT as a decline", async () => {
    const s = stub(loginOk, soap("<setCardV2Response><result>Declined: policy 14 is locked</result></setCardV2Response>"));
    await expect(
      setCardV2(env, creds, doc(), CARD, [], { fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({ code: "declined" });
  });

  it("surfaces a SOAP fault with the documented code", async () => {
    const s = stub(
      loginOk,
      soap("<soap:Fault xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'><faultstring>Not Allowed 109491436176</faultstring></soap:Fault>"),
    );
    await expect(
      setCardV2(env, creds, doc(), CARD, [], { fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("redacts the card number out of everything it hands back for the ledger", async () => {
    const s = stub(loginOk, soap(`<setCardV2Response><echo>${CARD}</echo></setCardV2Response>`));
    const result = await setCardV2(env, creds, doc(), CARD, [], { fetchImpl: s.fetchImpl });
    // Mechanical proof, not a review habit: nothing 12+ digits long survives into a persisted column.
    expect(result.requestXmlRedacted).not.toMatch(/\d{12,}/);
    expect(result.responseXmlRedacted).not.toMatch(/\d{12,}/);
  });
});

describe("classifySetCardResponse", () => {
  it("finds a wrapped scalar rather than reading a card field as a status code", () => {
    const wrapped = soap("<setCardV2Response><result><value>-1</value></result></setCardV2Response>");
    expect(classifySetCardResponse(wrapped)).toEqual({ resultText: "-1", shape: "document" });
  });

  it("does not read an echoed card's own fields as a result", () => {
    const echoed = soap("<setCardV2Response><result><status>Active</status></result></setCardV2Response>");
    expect(classifySetCardResponse(echoed).resultText).toBeNull();
  });
});

describe("isDecline", () => {
  it.each(["-1", "Declined", "ERROR: invalid policy", "Not Allowed"])("refuses %s", (text) => {
    expect(isDecline(text)).toBe(true);
  });

  it.each([null, "", "0", "OK", "1"])("accepts %s", (text) => {
    // An unrecognised non-empty string is NOT a decline. Turning every future informational response
    // into a false failure would be worse than trusting the reconciling re-read, which is what
    // actually decides whether the change landed.
    expect(isDecline(text)).toBe(false);
  });
});

describe("editsLanded", () => {
  it("says a status edit landed when the fresh document carries it", () => {
    const after = parseCardDocument(fixture("getCardV2.full.xml").replace("<status>Active</status>", "<status>Hold</status>"));
    expect(editsLanded(after, [{ op: "setField", name: "status", value: "Hold" }])).toBe(true);
    expect(editsLanded(after, [{ op: "setField", name: "status", value: "Active" }])).toBe(false);
  });

  it("says a removeAll landed only when the collection is actually gone", () => {
    const before = doc();
    expect(editsLanded(before, [{ op: "removeAll", name: "infos" }])).toBe(false);
  });
});
