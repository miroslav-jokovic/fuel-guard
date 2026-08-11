import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertEchoFidelity, type CardEdit, serializeSetCardRequest } from "./efsCardEcho.js";
import {
  type CardDocument,
  canonicalize,
  cardVersion,
  describeAtPath,
  maskPan,
  parseCardDocument,
  redactCardXml,
} from "./efsCardXml.js";
import { collectElements, parseXml } from "./efsXml.js";

/**
 * The centre of gravity for this feature.
 *
 * `setCardV2` is a full-document write (guide p137): a field missing from the request is DELETED, and
 * EFS accepts a well-formed request that removes a driver assignment without complaint. Every test
 * below is ultimately the same test — send back what we were given, unless we meant not to.
 *
 * The negative case at the end is the load-bearing one. Without it the fidelity guard is decoration.
 */

const FIXTURES = fileURLToPath(new URL("./__fixtures__/efs/", import.meta.url));
const fixture = (name: string): string => readFileSync(`${FIXTURES}${name}`, "utf8");

const ALL_FIXTURES = [
  "getCardV2.full.xml",
  "getCardV2.single.xml",
  "getCardV2.empty.xml",
  "getCardV2.nil.xml",
  "getCardV2.unknownField.xml",
  "getCardV2.namespaced.xml",
  "getCardV2.autoRoll.xml",
  "getCardV2.overridden.xml",
];

const TARGET = { clientId: "session-abc", cardNumber: "70830000000000000" };

/** Re-parse a serialized request body so assertions can look at it as a document. */
function requestBody(xml: string) {
  const wrapper = parseXml(`<w xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${xml}</w>`);
  const body = wrapper ? collectElements(wrapper, "CardManagementEP_setCardV2")[0] : null;
  if (!body) throw new Error("request body did not parse");
  return body;
}

function echo(doc: CardDocument, edits: CardEdit[] = []) {
  const { xml } = serializeSetCardRequest(doc, TARGET, edits);
  assertEchoFidelity(doc, xml, edits);
  return { xml, body: requestBody(xml) };
}

describe("parseCardDocument", () => {
  it.each(ALL_FIXTURES)("parses %s into a typed view", (name) => {
    const doc = parseCardDocument(fixture(name));
    expect(doc.card.status).toBeTruthy();
    expect(doc.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads exactly one repeated element as an array of one", () => {
    // The elementToValue collapse: a lone <infos> parses as a bare record there, and treating it as
    // "no prompts" is how a driver assignment gets deleted. collectElements always returns a list.
    const doc = parseCardDocument(fixture("getCardV2.single.xml"));
    expect(doc.card.infos).toHaveLength(1);
    expect(doc.card.infos[0]).toMatchObject({ infoId: "DRID", matchValue: "D-0001", validationType: "EXACT_MATCH" });
    expect(doc.card.limits).toHaveLength(1);
    expect(doc.card.locationGroups).toEqual(["4410"]);
    expect(doc.card.locations).toEqual(["115732"]);
  });

  it("reads three prompts and two limits from the full fixture", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    expect(doc.card.infos.map((i) => i.infoId)).toEqual(["DRID", "UNIT", "ODRD"]);
    expect(doc.card.limits.map((l) => l.limitId)).toEqual(["ULSD", "CADV"]);
    expect(doc.card.timeRestrictions.map((t) => t.day)).toEqual([1, 7]);
  });

  it("reads empty collections as empty arrays, never as undefined", () => {
    const doc = parseCardDocument(fixture("getCardV2.empty.xml"));
    expect(doc.card.infos).toEqual([]);
    expect(doc.card.limits).toEqual([]);
    expect(doc.card.timeRestrictions).toEqual([]);
  });

  it("reads xsi:nil as null, in BOTH spellings the vendor uses", () => {
    // The guide's own getCardv2 example writes xsi:nil="1" (p38) rather than the canonical "true".
    // Reading "1" as a value would put the literal string "1" where a null belongs.
    const doc = parseCardDocument(fixture("getCardV2.nil.xml"));
    expect(doc.card.originalStatus).toBeNull(); // xsi:nil="true"
    expect(doc.card.lastTransaction).toBeNull(); // xsi:nil="1"
    expect(doc.card.lastUsedDate).toBeNull();
    expect(doc.card.infos[0]?.reportValue).toBeNull();
  });

  it("finds the card through namespace prefixes", () => {
    const doc = parseCardDocument(fixture("getCardV2.namespaced.xml"));
    expect(doc.card.status).toBe("Active");
    expect(doc.card.infos.map((i) => i.infoId)).toEqual(["DRID", "UNIT"]);
  });

  it("reads override as a USE COUNT and locationOverride as a LOCATION ID", () => {
    // Both are documented boolean(1); the Overrides appendix (p194) puts a 1-9 count in one and a
    // 6-digit location id in the other. Reading them as booleans throws away the whole feature.
    const doc = parseCardDocument(fixture("getCardV2.overridden.xml"));
    expect(doc.card.overrideUses).toBe(2);
    expect(doc.card.locationOverrideId).toBe("115732");
  });

  it("does not mistake a boolean-shaped locationOverride for a location id", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    expect(doc.card.locationOverrideId).toBeNull(); // the fixture carries <locationOverride>0</…>
    expect(doc.card.overrideUses).toBe(0);
  });

  it("keeps autoRollMax of 0 as 0 — 'no daily maximum', not 'unset'", () => {
    const doc = parseCardDocument(fixture("getCardV2.autoRoll.xml"));
    expect(doc.card.limits[0]).toMatchObject({ limitId: "ULSD", autoRollMap: 7, autoRollMax: 0 });
    expect(doc.card.limits[1]).toMatchObject({ limitId: "DEF", autoRollMax: 75 });
  });

  it("throws on a SOAP fault rather than returning an empty card", () => {
    const fault = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>InvalidClientId</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
    expect(() => parseCardDocument(fault)).toThrow(/InvalidClientId|session/i);
  });

  it("throws when no card element can be found", () => {
    // An empty card that echoed successfully would DELETE every prompt and limit on the card. Loud.
    const empty = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getCardv2Response/></soap:Body></soap:Envelope>`;
    expect(() => parseCardDocument(empty)).toThrow(/no card element/i);
  });

  it("keeps a status EFS reports that is outside the documented list", () => {
    // The inverse of what this test used to assert. z.enum on `status` took production down: a real
    // card came back with a value outside our five, the document was rejected, and getCardv2 failed
    // outright — the entire card page lost to a value we only ever wanted to PRINT. The guide types
    // the field `string (8)` and names examples; it never promises a closed set.
    const weird = fixture("getCardV2.full.xml").replace("<status>Active</status>", "<status>Frozen</status>");
    expect(parseCardDocument(weird).card.status).toBe("Frozen");
  });

  it("keeps an unknown source and an out-of-range policy number rather than failing the read", () => {
    // Same rule, applied to the fields most likely to grow a value: the *Source alphabet and the
    // documented 1–99 policy range.
    const weird = fixture("getCardV2.full.xml")
      .replace(/<infoSource>[^<]*<\/infoSource>/, "<infoSource>MIXED</infoSource>")
      .replace(/<policyNumber>[^<]*<\/policyNumber>/, "<policyNumber>139</policyNumber>");
    const doc = parseCardDocument(weird);
    expect(doc.card.infoSource).toBe("MIXED");
    expect(doc.card.policyNumber).toBe(139);
  });

});

describe("describeAtPath", () => {
  // Why this is tested on its own: with the read schema now tolerant, no realistic vendor document
  // still fails validation — so there is nothing left to drive the error path end to end. The helper
  // is the part that has to be right the day somebody adds a strict field back, and the reason it
  // exists is concrete: production reported `status — Invalid option: expected one of "Active"|…`
  // with no mention of what was actually received, and answering that cost a second round trip.
  it("quotes the value at the failing path, including nested ones", () => {
    const raw = { status: "Frozen", infos: [{ infoId: "DRID", validationType: "SOMETHING_NEW" }] };
    expect(describeAtPath(raw, ["status"])).toBe('"Frozen"');
    expect(describeAtPath(raw, ["infos", 0, "validationType"])).toBe('"SOMETHING_NEW"');
  });

  it("distinguishes null, absent and unreachable rather than printing 'undefined'", () => {
    expect(describeAtPath({ status: null }, ["status"])).toBe("null");
    expect(describeAtPath({}, ["status"])).toBe("absent");
    expect(describeAtPath({ status: "x" }, ["status", "deeper"])).toBe("not present");
  });

  it("redacts — the failing path can be a field that carries a card number", () => {
    expect(describeAtPath({ matchValue: "7083050013944594622" }, ["matchValue"])).not.toMatch(/\d{12}/);
  });
});

describe("zero-edit echo — the identity property", () => {
  it.each(ALL_FIXTURES)("re-emits %s with no change at all", (name) => {
    const doc = parseCardDocument(fixture(name));
    const { body } = echo(doc);
    // Canonical equality both ways: nothing added, nothing dropped, nothing reordered.
    expect(canonicalize(body, new Set(["clientId", "cardNumber"]))).toEqual(canonicalize(doc.root));
  });

  it.each(ALL_FIXTURES)("emits exactly as many repeated elements as %s contained", (name) => {
    const doc = parseCardDocument(fixture(name));
    const { body } = echo(doc);
    for (const collection of ["infos", "limits", "locationGroups", "locations", "timeRestrictions"] as const) {
      expect(collectElements(body, collection).length).toBe(collectElements(doc.root, collection).length);
    }
  });

  it("echoes a lone <infos> record as a record, not as nothing", () => {
    // The single most consequential assertion in the file: this is the shape that deletes a driver ID.
    const doc = parseCardDocument(fixture("getCardV2.single.xml"));
    const { xml } = echo(doc);
    expect(xml).toContain("<infoId>DRID</infoId>");
    expect(xml).toContain("<matchValue>D-0001</matchValue>");
  });

  it("preserves xsi:nil rather than downgrading it to an empty element", () => {
    const doc = parseCardDocument(fixture("getCardV2.nil.xml"));
    const { xml } = echo(doc);
    expect(xml).toContain('<originalStatus xsi:nil="true"/>');
    expect(xml).not.toContain("<originalStatus></originalStatus>");
  });

  it("preserves fields this codebase has never heard of", () => {
    // The entire reason the echo is built from the DOM. A typed serializer drops these silently, and
    // the first one WEX adds is deleted from every card we touch.
    const doc = parseCardDocument(fixture("getCardV2.unknownField.xml"));
    const { xml } = echo(doc);
    expect(xml).toContain("<futureFlag>ENABLED</futureFlag>");
    expect(xml).toContain("<secureFuelZid>Z-99812</secureFuelZid>");
    expect(xml).toContain("<unknownPerRecordField>keep-me</unknownPerRecordField>");
  });

  it("carries clientId and cardNumber, which are inputs rather than echoed content", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { xml } = echo(doc);
    expect(xml).toContain("<clientId>session-abc</clientId>");
    expect(xml).toContain(`<cardNumber>${TARGET.cardNumber}</cardNumber>`);
  });
});

describe("edits", () => {
  it("changes exactly one leaf when locking a card", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const edits: CardEdit[] = [{ op: "setField", name: "status", value: "Hold" }];
    const { body } = echo(doc, edits);

    const before = canonicalize(doc.root);
    const after = canonicalize(body, new Set(["clientId", "cardNumber"]));
    const changed = [...after.keys()].filter((k) => JSON.stringify(after.get(k)) !== JSON.stringify(before.get(k)));
    expect(changed).toEqual(["/status"]);
    // `v` is the canonical form's real-value prefix — see encodeLeaf() in efsCardXml.ts.
    expect(after.get("/status")).toEqual(["vHold"]);
  });

  it("accepts an explicit removeAll — empty means remove, when you said so", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { body } = echo(doc, [{ op: "removeAll", name: "infos" }]);
    expect(collectElements(body, "infos")).toHaveLength(0);
    // Limits are untouched: removing prompts must not take anything else with it.
    expect(collectElements(body, "limits")).toHaveLength(2);
  });

  it("replaces the whole prompts array, which IS the EFS semantic", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const records = [
      { infoId: "DRID", matchValue: "D-9999", validationType: "EXACT_MATCH", reportValue: null, lengthCheck: "false", minimum: "0", maximum: "0", value: "0" },
      { infoId: "UNIT", matchValue: "4242", validationType: "EXACT_MATCH", reportValue: null, lengthCheck: "false", minimum: "0", maximum: "0", value: "0" },
    ];
    const { body, xml } = echo(doc, [{ op: "replaceAll", name: "infos", records }]);

    expect(collectElements(body, "infos")).toHaveLength(2);
    expect(xml).toContain("<matchValue>D-9999</matchValue>");
    // The ODRD accrual prompt was in the response and is NOT in the replacement, so it is gone —
    // deliberately, which is why the caller has to pass the whole array rather than a patch.
    expect(xml).not.toContain("ODRD");
  });

  it("appends a record without disturbing the existing ones", () => {
    const doc = parseCardDocument(fixture("getCardV2.single.xml"));
    const { body } = echo(doc, [
      { op: "appendRecord", name: "limits", record: { limitId: "DEF", limit: "40", hours: "24", minHours: "0" } },
    ]);
    expect(collectElements(body, "limits")).toHaveLength(2);
  });

  it("adds a field the response never carried", () => {
    const doc = parseCardDocument(fixture("getCardV2.empty.xml"));
    const { xml } = echo(doc, [{ op: "setField", name: "locationOverride", value: "115732" }]);
    expect(xml).toContain("<locationOverride>115732</locationOverride>");
  });

  it("escapes values so a stray angle bracket cannot break the envelope", () => {
    const doc = parseCardDocument(fixture("getCardV2.empty.xml"));
    const { xml } = echo(doc, [{ op: "setField", name: "companyXRef", value: "A&B <test>" }]);
    expect(xml).toContain("<companyXRef>A&amp;B &lt;test&gt;</companyXRef>");
  });
});

describe("override recipes (guide p194)", () => {
  const doc = () => parseCardDocument(fixture("getCardV2.full.xml"));

  it("all-locations: overrideAllLocations true, override = the use count", () => {
    const edits: CardEdit[] = [
      { op: "setField", name: "overrideAllLocations", value: "true" },
      { op: "setField", name: "override", value: "3" },
    ];
    const { xml } = echo(doc(), edits);
    expect(xml).toContain("<overrideAllLocations>true</overrideAllLocations>");
    expect(xml).toContain("<override>3</override>");
    // Everything else still echoed — the recipe is "echo back your data, update these fields".
    expect(xml).toContain("<matchValue>D-4471</matchValue>");
    expect(xml).toContain("<limitId>ULSD</limitId>");
  });

  it("single-location: the 6-digit id, overrideAllLocations false, override = the use count", () => {
    const edits: CardEdit[] = [
      { op: "setField", name: "locationOverride", value: "115732" },
      { op: "setField", name: "overrideAllLocations", value: "false" },
      { op: "setField", name: "override", value: "1" },
    ];
    const { xml } = echo(doc(), edits);
    expect(xml).toContain("<locationOverride>115732</locationOverride>");
    expect(xml).toContain("<overrideAllLocations>false</overrideAllLocations>");
    expect(xml).toContain("<override>1</override>");
  });

  it("clearing an override returns the card to its normal rules", () => {
    const active = parseCardDocument(fixture("getCardV2.overridden.xml"));
    const edits: CardEdit[] = [
      { op: "setField", name: "override", value: "0" },
      { op: "setField", name: "overrideAllLocations", value: "false" },
      { op: "setField", name: "locationOverride", value: "0" },
    ];
    const { xml } = echo(active, edits);
    expect(xml).toContain("<override>0</override>");
    expect(xml).toContain("<locationOverride>0</locationOverride>");
    expect(xml).toContain("<matchValue>D-4471</matchValue>"); // the driver prompt survives
  });

  it("product-limit override: echo WITHOUT the limits, then add back the override limits", () => {
    // The one recipe that deliberately drops an array (p194) — exactly the shape everything else here
    // guards against, which is why it is deferred out of Phase 1 and pinned by a test now.
    const edits: CardEdit[] = [
      { op: "setField", name: "overrideAllLocations", value: "true" },
      { op: "setField", name: "override", value: "1" },
      { op: "replaceAll", name: "limits", records: [{ hours: "1", limit: "1000", limitId: "ULSD", minHours: "0" }] },
    ];
    const { body, xml } = echo(doc(), edits);
    expect(collectElements(body, "limits")).toHaveLength(1);
    expect(xml).toContain("<limit>1000</limit>");
    expect(xml).not.toContain("CADV");
    expect(xml).toContain("<matchValue>D-4471</matchValue>"); // prompts untouched
  });
});

describe("assertEchoFidelity", () => {
  it("throws when a serializer drops a collection, naming the path", () => {
    // THE test that proves the guard works. Without it the guard is decoration.
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    const sabotaged = xml.replace(/<limits>.*?<\/limits>/gs, "");

    expect(() => assertEchoFidelity(doc, sabotaged, [])).toThrow(/faithfully echo/i);
    try {
      assertEchoFidelity(doc, sabotaged, []);
    } catch (e) {
      expect((e as { code: string }).code).toBe("echo_unfaithful");
      expect((e as { message: string }).message).toContain("/limits");
    }
  });

  it("throws when a single <infos> record goes missing", () => {
    const doc = parseCardDocument(fixture("getCardV2.single.xml"));
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    const sabotaged = xml.replace(/<infos>.*?<\/infos>/gs, "");
    expect(() => assertEchoFidelity(doc, sabotaged, [])).toThrow(/faithfully echo/i);
  });

  it("throws when a value changes that no edit asked to change", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    const sabotaged = xml.replace("<matchValue>D-4471</matchValue>", "<matchValue>D-0000</matchValue>");
    expect(() => assertEchoFidelity(doc, sabotaged, [])).toThrow(/faithfully echo/i);
  });

  it("throws when an xsi:nil is downgraded to an empty element", () => {
    const doc = parseCardDocument(fixture("getCardV2.nil.xml"));
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    const sabotaged = xml.replace('<originalStatus xsi:nil="true"/>', "<originalStatus></originalStatus>");
    expect(() => assertEchoFidelity(doc, sabotaged, [])).toThrow(/faithfully echo/i);
  });

  it("throws when an unknown field is dropped", () => {
    const doc = parseCardDocument(fixture("getCardV2.unknownField.xml"));
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    const sabotaged = xml.replace("<futureFlag>ENABLED</futureFlag>", "");
    expect(() => assertEchoFidelity(doc, sabotaged, [])).toThrow(/faithfully echo/i);
  });

  it("refuses a request it cannot re-parse rather than sending it hopefully", () => {
    const doc = parseCardDocument(fixture("getCardV2.empty.xml"));
    expect(() => assertEchoFidelity(doc, "<not-a-request", [])).toThrow(/refusing/i);
  });

  it("does NOT throw for a change an edit accounted for", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const edits: CardEdit[] = [{ op: "setField", name: "status", value: "Hold" }];
    const { xml } = serializeSetCardRequest(doc, TARGET, edits);
    expect(() => assertEchoFidelity(doc, xml, edits)).not.toThrow();
  });

  it("throws when an edit is claimed but the serializer did not make it", () => {
    // The other direction: a request that is missing an intended change is also unfaithful, because
    // the ledger would record a lock that never happened.
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    expect(() => assertEchoFidelity(doc, xml, [{ op: "setField", name: "status", value: "Hold" }])).toThrow(/faithfully echo/i);
  });
});

describe("cardVersion", () => {
  const root = (name: string) => parseCardDocument(fixture(name)).root;

  it("is stable across whitespace and formatting", () => {
    const original = fixture("getCardV2.full.xml");
    const reformatted = original.replace(/>\s+</g, "><");
    expect(cardVersion(parseCardDocument(reformatted).root)).toBe(cardVersion(root("getCardV2.full.xml")));
  });

  it("changes when the configuration changes", () => {
    const held = fixture("getCardV2.full.xml").replace("<status>Active</status>", "<status>Hold</status>");
    expect(cardVersion(parseCardDocument(held).root)).not.toBe(cardVersion(root("getCardV2.full.xml")));
  });

  it("changes when a prompt is removed", () => {
    const stripped = fixture("getCardV2.full.xml").replace(/<infos>\s*<infoId>UNIT<\/infoId>.*?<\/infos>/s, "");
    expect(cardVersion(parseCardDocument(stripped).root)).not.toBe(cardVersion(root("getCardV2.full.xml")));
  });

  it("does NOT change when the card is merely used", () => {
    // A fill in progress must not 409 a dispatcher who opened the drawer thirty seconds ago.
    const used = fixture("getCardV2.full.xml")
      .replace("<lastUsedDate>2026-08-09T14:22:07-05:00</lastUsedDate>", "<lastUsedDate>2026-08-10T09:03:41-05:00</lastUsedDate>")
      .replace("<lastTransaction>AUTH88213</lastTransaction>", "<lastTransaction>AUTH90007</lastTransaction>");
    expect(cardVersion(parseCardDocument(used).root)).toBe(cardVersion(root("getCardV2.full.xml")));
  });

  it("distinguishes two different cards", () => {
    expect(cardVersion(root("getCardV2.full.xml"))).not.toBe(cardVersion(root("getCardV2.single.xml")));
  });
});

describe("redaction", () => {
  it("masks a card number element down to its last four", () => {
    const out = redactCardXml("<cardNumber>70830000000007521</cardNumber>");
    expect(out).toBe("<cardNumber>••••7521</cardNumber>");
    expect(out).not.toContain("70830000000007521");
  });

  it("masks a PAN anywhere it appears, not just in the element we expect", () => {
    // A getCardSummariesV2 body carries the whole fleet's PANs, and a fault message can quote one back.
    const out = redactCardXml("<faultstring>Card 70830000000007521 is not active</faultstring>");
    expect(out).not.toContain("70830000000007521");
    expect(out).toContain("••••7521");
  });

  it("leaves no 12-or-more digit run in a full request body", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { redactedXml } = serializeSetCardRequest(doc, { clientId: "s", cardNumber: "70830000000007521" }, []);
    expect(redactedXml).not.toMatch(/\d{12,}/);
  });

  it("leaves short numbers — unit numbers, location ids, limits — alone", () => {
    const out = redactCardXml("<locations>115732</locations><limit>250</limit>");
    expect(out).toBe("<locations>115732</locations><limit>250</limit>");
  });

  it("masks for display without ever holding a full PAN", () => {
    expect(maskPan("7521")).toBe("•••• 7521");
  });
});
