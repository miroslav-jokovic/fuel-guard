import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { parseCardDocument } from "./efsCardXml.js";
import { classifySetCardResponse, deleteOverrideOp, editsLanded, isDecline, setCardV2 } from "./efsCardWrite.js";
import { EfsSoapError, __resetEfsSessions } from "./efsSoapSession.js";
import { childElements, collectElements, localName } from "./efsXml.js";
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
    // Operation name AND request signature both come from the WSDL rather than the guide: the
    // binding declares `setCardv2` (lowercase v) taking two parts, `clientId` and `card`. Sending
    // `setCardV2` earned an Axis2 "EPR for the Operation not found" and never reached a card.
    expect(sent).toContain("<CardManagementEP_setCardv2");
    expect(sent).toContain("<clientId>sess-1</clientId>");
    expect(sent).toContain(`<card><cardNumber>${CARD}</cardNumber>`);
    expect(sent).toContain("</card></CardManagementEP_setCardv2>");
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
    // An edit that targets `cardNumber` — a setCardv2 INPUT, not echoed content. The serializer will
    // emit it inside <card>; the expectation excludes it as an input. The two disagree, and that
    // disagreement is exactly what the guard exists to refuse.
    //
    // This used to be `[appendRecord, appendRecord, removeAll]`, which diverged only because the
    // expectation applied edits in list order while the serializer treated the last removeAll as the
    // base. That was two readings of one contradictory edit list disagreeing, not a lossy request —
    // and it stopped diverging once both sides were made to agree about what an edit list means.
    // The property worth pinning here is the one below: the guard runs on the bytes about to be
    // sent, and aborts BEFORE the vendor is dialled.
    await expect(
      setCardV2(env, creds, before, CARD, [
        { op: "setField", name: "cardNumber", value: "70839999999999999" },
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

  it("treats errorNumber/errorDesc responses as vendor failures", async () => {
    const s = stub(loginOk, soap(
      "<setCardV2Response><result><errorNumber>42</errorNumber><errorDesc>Card is not writable</errorDesc></result></setCardV2Response>",
    ));
    const attempt = setCardV2(env, creds, doc(), CARD, [], { fetchImpl: s.fetchImpl });
    await expect(attempt).rejects.toMatchObject({ code: "declined" });
    await expect(attempt).rejects.toThrow(/errorNumber=42.*errorDesc=Card is not writable/);
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
    // Mechanical proof, not a review habit: nothing 10+ digits long survives into a persisted column.
    expect(result.requestXmlRedacted).not.toMatch(/\d{10,}/);
    expect(result.responseXmlRedacted).not.toMatch(/\d{10,}/);
  });
});

describe("deleteOverrideOp — the dedicated clear (fix plan D1)", () => {
  it("sends the two-part request the WSDL declares, and nothing resembling a document", async () => {
    const s = stub(loginOk, soap(""));
    await deleteOverrideOp(env, creds, CARD, { fetchImpl: s.fetchImpl });
    const sent = s.bodies[1]!;
    expect(sent).toContain("<CardManagementEP_deleteOverride>");
    expect(sent).toContain("<clientId>sess-1</clientId>");
    expect(sent).toContain(`<cardNumber>${CARD}</cardNumber>`);
    // The op's whole safety case: no echoed card document, so no field to drop. A request that
    // grew an <infos> or <limits> element has become a different operation.
    expect(sent).not.toContain("<infos>");
    expect(sent).not.toContain("<limits>");
    expect(sent).not.toContain("<card>");
  });

  it("treats an empty 200 as success and a decline as a refusal, same rules as setCardV2", async () => {
    const ok = stub(loginOk, soap(""));
    const result = await deleteOverrideOp(env, creds, CARD, { fetchImpl: ok.fetchImpl });
    expect(result.shape).toBe("empty");

    __resetEfsSessions();
    __resetSoapPacing();
    const declined = stub(loginOk, soap("<deleteOverrideResponse><result>-1</result></deleteOverrideResponse>"));
    await expect(
      deleteOverrideOp(env, creds, CARD, { fetchImpl: declined.fetchImpl }),
    ).rejects.toMatchObject({ code: "declined" });
  });

  it("does not retry, even when the transport would — a timed-out delete may have landed", async () => {
    const s = stub(loginOk, { status: 500, body: "boom" }, soap(""));
    await expect(
      deleteOverrideOp(env, creds, CARD, { fetchImpl: s.fetchImpl }),
    ).rejects.toBeInstanceOf(EfsSoapError);
    // Login and ONE dispatch. A third call would be a second delete reaching EFS.
    expect(s.calls).toBe(2);
  });

  it("surfaces not_allowed with its code — the entitlement finding the D1 probe reads", async () => {
    const s = stub(
      loginOk,
      soap("<soap:Fault xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'><faultstring>Not Allowed 109491436176</faultstring></soap:Fault>"),
    );
    await expect(
      deleteOverrideOp(env, creds, CARD, { fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("redacts the card number out of everything persisted", async () => {
    const s = stub(loginOk, soap("<deleteOverrideResponse/>"));
    const result = await deleteOverrideOp(env, creds, CARD, { fetchImpl: s.fetchImpl });
    expect(result.requestXmlRedacted).not.toMatch(/\d{10,}/);
    expect(result.responseXmlRedacted).not.toMatch(/\d{10,}/);
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

  /**
   * These four are about the direction this function is allowed to be wrong in.
   *
   * It resolves `sent` rows — writes whose outcome nobody knows — with no before-document to diff
   * against. A false NEGATIVE leaves a row unresolved for a human to look at. A false POSITIVE
   * records a write that never applied as succeeded, and nothing ever looks at it again.
   */
  it("does not call a prompts replaceAll landed just because the record COUNT matches", () => {
    // The card EFS returns is unchanged — the write did not apply. Three records before, three after,
    // so a count comparison says "landed" on the single most common prompts edit there is.
    const after = doc();
    const records = collectElements(after.root, "infos").map((el) => {
      const record: Record<string, string | null> = {};
      for (const child of childElements(el)) record[localName(child)] = (child.textContent ?? "").trim();
      return record;
    });
    const changed = records.map((r) => (r.infoId === "DRID" ? { ...r, matchValue: "D-9999" } : r));

    expect(editsLanded(after, [{ op: "replaceAll", name: "infos", records: changed }])).toBe(false);
  });

  it("says a replaceAll landed when the fresh document actually carries the new values", () => {
    const after = parseCardDocument(fixture("getCardV2.full.xml").replace("D-4471", "D-9999"));
    const records = collectElements(after.root, "infos").map((el) => {
      const record: Record<string, string | null> = {};
      for (const child of childElements(el)) record[localName(child)] = (child.textContent ?? "").trim();
      return record;
    });

    expect(editsLanded(after, [{ op: "replaceAll", name: "infos", records }])).toBe(true);
  });

  it("does not call a replaceAll landed when a record we did not intend is still there", () => {
    // Same count, different membership: we asked for {DRID, UNIT, NEW} and the card holds
    // {DRID, UNIT, ODRD}. Identity has to be compared, not cardinality.
    const after = doc();
    const records = collectElements(after.root, "infos")
      .map((el) => {
        const record: Record<string, string | null> = {};
        for (const child of childElements(el)) record[localName(child)] = (child.textContent ?? "").trim();
        return record;
      })
      .map((r) => (r.infoId === "ODRD" ? { ...r, infoId: "TRIP" } : r));

    expect(editsLanded(after, [{ op: "replaceAll", name: "infos", records }])).toBe(false);
  });

  it("does not report an appendRecord landed when the record is not on the card", () => {
    const after = doc();
    expect(
      editsLanded(after, [
        { op: "appendRecord", name: "limits", record: { limitId: "DEF", limit: "40", hours: "24", minHours: "0" } },
      ]),
    ).toBe(false);
  });

  it("refuses to call anything landed when a record on the card cannot be identified", () => {
    // Unknown must resolve to "not landed": the row stays visible for a human instead of being
    // written off as succeeded on the strength of a record nobody can match.
    const after = parseCardDocument(fixture("getCardV2.full.xml").replace("<infoId>ODRD</infoId>", "<infoId></infoId>"));
    const records = collectElements(after.root, "infos").map((el) => {
      const record: Record<string, string | null> = {};
      for (const child of childElements(el)) record[localName(child)] = (child.textContent ?? "").trim();
      return record;
    });

    expect(editsLanded(after, [{ op: "replaceAll", name: "infos", records }])).toBe(false);
  });

  it("reports an appendRecord landed when the record is on the card with the values we sent", () => {
    const after = doc();
    expect(
      editsLanded(after, [
        { op: "appendRecord", name: "limits", record: { limitId: "CADV", limit: "100", hours: "168" } },
      ]),
    ).toBe(true);
  });
});
