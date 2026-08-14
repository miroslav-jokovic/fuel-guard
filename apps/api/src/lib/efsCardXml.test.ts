import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertEchoFidelity, type CardEdit, serializeSetCardRequest } from "./efsCardEcho.js";
import {
  type CardDocument,
  canonicalize,
  cardVersion,
  describeAtPath,
  documentShape,
  maskPan,
  parseCardDocument,
  redactCardXml,
} from "./efsCardXml.js";
import { childElements, collectElements, parseXml } from "./efsXml.js";
import { elementOrder } from "./efsCardCanonical.js";
import { sequenceRank } from "./efsCardSequence.js";

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
  "getCardV2.reportOnly.xml",
  // The production shape: header fields nested inside <header>, sub-objects as its siblings. Every
  // property in this file must hold on it exactly as it does on the flat guide examples — that it
  // did NOT is the bug this fixture exists for. See the comment at the head of the fixture.
  "getCardV2.nestedHeader.xml",
];

const TARGET = { clientId: "session-abc", cardNumber: "70830000000000000" };
const XSI_NS_TEST = "http://www.w3.org/2001/XMLSchema-instance";

/** Inputs rather than echoed content. On the nested shape `cardNumber` is BOTH, so it is excluded
 *  from the response side too whenever the two documents are compared. */
const INPUT_FIELDS = new Set(["clientId", "cardNumber"]);

/**
 * Re-parse a serialized request and return its `<card>` part.
 *
 * The operation takes `(clientId, card)` per the WSDL, so `<card>` is the element that has to
 * correspond to the document we read — `clientId` is an input alongside it, not part of the echo.
 */
function requestBody(xml: string) {
  const wrapper = parseXml(`<w xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${xml}</w>`);
  const operation = wrapper ? collectElements(wrapper, "CardManagementEP_setCardv2")[0] : null;
  if (!operation) throw new Error("request body did not parse, or the operation element is misnamed");
  const card = collectElements(operation, "card")[0];
  if (!card) throw new Error("request has no <card> part");
  return card;
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

  it("preserves an empty REPORT_ONLY matchValue and its reportValue", () => {
    const doc = parseCardDocument(fixture("getCardV2.reportOnly.xml"));
    expect(doc.card.infos).toEqual(expect.arrayContaining([
      expect.objectContaining({ infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "T001" }),
    ]));
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
    expect(canonicalize(body, INPUT_FIELDS)).toEqual(canonicalize(doc.root, INPUT_FIELDS));
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
    // The ODRD accrual prompt was in the response and is NOT in the replacement, so it is gone. That
    // is still the semantic — but it now has to be SAID: `removals` is what separates a deliberate
    // deletion from an edit list that quietly lost a record (see efsCardCollections.ts).
    const { body, xml } = echo(doc, [{ op: "replaceAll", name: "infos", records, removals: ["ODRD"] }]);

    expect(collectElements(body, "infos")).toHaveLength(2);
    expect(xml).toContain("<matchValue>D-9999</matchValue>");
    expect(xml).not.toContain("ODRD");
  });

  it("refuses the same replacement when the dropped record is not declared", () => {
    // The identical edit list, minus the `removals`. Nothing about the REQUEST differs — which is
    // exactly why the canonical diff cannot tell these two apart and this check exists.
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const records = [
      { infoId: "DRID", matchValue: "D-9999", validationType: "EXACT_MATCH", reportValue: null, lengthCheck: "false", minimum: "0", maximum: "0", value: "0" },
      { infoId: "UNIT", matchValue: "4242", validationType: "EXACT_MATCH", reportValue: null, lengthCheck: "false", minimum: "0", maximum: "0", value: "0" },
    ];

    expect(() => echo(doc, [{ op: "replaceAll", name: "infos", records }])).toThrow(/drops <infos> record "ODRD"/);
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
      // CADV is dropped on purpose by this recipe, so the recipe declares it. An override that
      // silently ate a product limit is the exact failure this workstream is here to prevent.
      { op: "replaceAll", name: "limits", records: [{ hours: "1", limit: "1000", limitId: "ULSD", minHours: "0" }], removals: ["CADV"] },
    ];
    const { body, xml } = echo(doc(), edits);
    expect(collectElements(body, "limits")).toHaveLength(1);
    expect(xml).toContain("<limit>1000</limit>");
    expect(xml).not.toContain("CADV");
    expect(xml).toContain("<matchValue>D-4471</matchValue>"); // prompts untouched
  });
});

describe("EFS returns <infos> in a different order on every read", () => {
  /**
   * Observed, not theorised. Two read-only probe runs against the same QA card, seconds apart with
   * no write between them, came back byte-identical except for the prompt order:
   *
   *     read 1:  UNIT, DRID, NAME
   *     read 2:  NAME, UNIT, DRID
   *
   * Same three records, same values, same `lastTransaction`. Under document-order canonicalisation
   * those hash to two different `cardVersion`s, and everything built on that token inherits the
   * coin toss:
   *
   *   • The write probe reported THE GATE FAILED — "our request is silently altering cards" — on a
   *     run whose echo was perfect, then passed on the next one. Same code, same card.
   *   • `cardVersion` is the optimistic-concurrency token for every mutation, so a dispatcher would
   *     have been told "this card changed in EFS" at random, on a card nobody had touched.
   *   • `intentLanded` would have reported phantom drift on every write.
   *
   * Order is not information here and the vendor plainly does not treat it as such.
   */
  const permuted = (order: readonly number[]): string => {
    const xml = fixture("getCardV2.nestedHeader.xml");
    // `<infos>\n` — the newline matters. The fixture's own header comment mentions `<infos>` in
    // prose, and a laxer pattern starts its first match there and swallows the real record after it.
    const records = xml.match(/ *<infos>\n[\s\S]*?<\/infos>\n/g)!;
    expect(records).toHaveLength(6);
    return xml.replace(records.join(""), order.map((i) => records[i]!).join(""));
  };

  it("hashes to the same version however the vendor orders the prompts", () => {
    const asSent = parseCardDocument(permuted([0, 1, 2, 3, 4, 5]));
    const shuffled = parseCardDocument(permuted([5, 2, 0, 4, 1, 3]));
    const reversed = parseCardDocument(permuted([5, 4, 3, 2, 1, 0]));
    expect(shuffled.version).toBe(asSent.version);
    expect(reversed.version).toBe(asSent.version);
  });

  it("still notices a prompt whose VALUE changed, in any order", () => {
    // The tolerance must not become blindness. Records are compared whole, so a changed field makes
    // a different record and the multiset differs — wherever it happens to sit in the document.
    const asSent = parseCardDocument(permuted([0, 1, 2, 3, 4, 5]));
    const edited = parseCardDocument(
      permuted([5, 2, 0, 4, 1, 3]).replace("<matchValue>0225</matchValue>", "<matchValue>0311</matchValue>"),
    );
    expect(edited.version).not.toBe(asSent.version);
  });

  it("still notices a prompt that disappeared", () => {
    const asSent = parseCardDocument(permuted([0, 1, 2, 3, 4, 5]));
    const fewer = parseCardDocument(permuted([0, 1, 2, 3, 4]));
    expect(fewer.version).not.toBe(asSent.version);
  });

  it("does not confuse two prompts that swapped their values", () => {
    // The one case a naive "sort every path independently" fix would miss: association between an
    // infoId and its own matchValue has to survive, or DRID=1001/UNIT=T001 would compare equal to
    // DRID=T001/UNIT=1001.
    const base = fixture("getCardV2.nestedHeader.xml");
    const swapped = base
      .replace("<matchValue>685</matchValue>", "<matchValue>@@</matchValue>")
      .replace("<matchValue>0225</matchValue>", "<matchValue>685</matchValue>")
      .replace("<matchValue>@@</matchValue>", "<matchValue>0225</matchValue>");
    expect(parseCardDocument(swapped).version).not.toBe(parseCardDocument(base).version);
  });
});

describe("the setCardv2 request signature — read off the WSDL, not the guide", () => {
  /**
   * Two bugs found in one Axis2 dispatch failure, both of them ours.
   *
   * The guide writes `setCardV2` (p137). The binding declares `setCardv2` — lowercase `v`, like
   * `getCardv2` but unlike `getCardSummariesV2`. The vendor is inconsistent and the guide hides it,
   * so the operation name is not something a page number can settle.
   *
   * The second one was hiding behind the first. The WSDL declares:
   *
   *     <message name="CardManagementEP_setCardv2">
   *       <part name="clientId" type="xsd:string"/>
   *       <part name="card"     type="ns2:WSCardv2"/>
   *     </message>
   *
   * — two parts, so the card belongs inside ONE `<card>` element. We were emitting clientId,
   * cardNumber and the card's contents as flat siblings. Nothing caught it because dispatch failed
   * on the name before the binding ever deserialized the body; fixing only the name would have sent
   * a well-formed request with the wrong shape to a full-document write.
   */
  const doc = () => parseCardDocument(fixture("getCardV2.nestedHeader.xml"));

  it("names the operation as the binding does", () => {
    const { xml } = serializeSetCardRequest(doc(), TARGET, []);
    expect(xml).toContain("<CardManagementEP_setCardv2");
    expect(xml).not.toContain("CardManagementEP_setCardV2");
  });

  it("passes the card as a single <card> part, with clientId beside it", () => {
    const { xml } = serializeSetCardRequest(doc(), TARGET, []);
    const wrapper = parseXml(`<w xmlns:xsi="${XSI_NS_TEST}">${xml}</w>`)!;
    const operation = collectElements(wrapper, "CardManagementEP_setCardv2")[0]!;
    // Exactly the two parts the WSDL declares, in parameterOrder.
    expect(childElements(operation).map((el) => el.localName)).toEqual(["clientId", "card"]);
  });

  it("puts cardNumber inside <card>, where WSCardv2's sequence declares it", () => {
    const { body } = echo(doc());
    expect(collectElements(body, "cardNumber")).toHaveLength(1);
    // First, per the <sequence>: cardNumber, header, infos, limits, locationGroups, …
    expect(childElements(body)[0]!.localName).toBe("cardNumber");
    expect(childElements(body)[1]!.localName).toBe("header");
  });

  it("refuses a request with no <card> part", () => {
    // The flat shape we used to send. Well-formed XML, correct operation name, wrong signature —
    // and the guard has to be the thing that stops it, because EFS might not.
    const d = doc();
    const flattened = serializeSetCardRequest(d, TARGET, []).xml
      .replace("<card>", "")
      .replace("</card>", "");
    expect(() => assertEchoFidelity(d, flattened, [])).toThrow(/no <card> element/);
  });
});

describe("the nested <header> shape — what production actually returns", () => {
  /**
   * A near-miss postmortem, kept as tests.
   *
   * Every example in the guide is flat. The live account nests the header fields in `<header>` and
   * hangs the sub-objects off the parent. The marker search landed on `<header>`, `collectElements`
   * found no `<infos>` there, and the card parsed as if it had no prompts at all. The echo built
   * from that document would have been well-formed, would have passed the fidelity guard (which
   * compares the request against what the PARSER saw), and would have DELETED all six prompts —
   * Driver ID and driver name included — on every card we touched.
   *
   * These tests are the shape of that failure, so it cannot come back.
   */
  const nested = () => parseCardDocument(fixture("getCardV2.nestedHeader.xml"));

  it("reads the header fields through the wrapper", () => {
    const doc = nested();
    expect(doc.card.status).toBe("HOLD");
    expect(doc.card.policyNumber).toBe(1);
    expect(doc.card.handEnter).toBe("POLICY");
    expect(doc.card.originalStatus).toBeNull(); // xsi:nil="1", the guide's own spelling
  });

  it("separates the header from the element that carries the sub-objects", () => {
    const doc = nested();
    expect(doc.root).not.toBe(doc.header);
    expect(doc.fieldPrefix).toBe("/header");
  });

  it("finds all six prompts — the assertion the bug failed", () => {
    const doc = nested();
    expect(doc.card.infos).toHaveLength(6);
    expect(doc.card.infos.map((i) => i.infoId)).toEqual(["UNIT", "TRLR", "NAME", "TRIP", "CNTN", "DRID"]);
    // The two that are assignments rather than reporting, i.e. the two a lossy echo would unassign.
    expect(doc.card.infos.find((i) => i.infoId === "DRID")?.matchValue).toBe("0225");
    expect(doc.card.infos.find((i) => i.infoId === "UNIT")?.matchValue).toBe("685");
    expect(doc.card.locationGroups).toEqual(["1"]);
  });

  it("echoes the wrapper back in the shape it arrived", () => {
    const { xml, body } = echo(nested());
    expect(xml).toContain("<header>");
    expect(collectElements(body, "header")).toHaveLength(1);
    // Header fields stay INSIDE the wrapper — a flattened echo is a different document.
    expect(collectElements(body, "status")).toHaveLength(0);
    expect(collectElements(collectElements(body, "header")[0]!, "status")).toHaveLength(1);
  });

  it("echoes every prompt, and the driver's own values with them", () => {
    const { xml, body } = echo(nested());
    expect(collectElements(body, "infos")).toHaveLength(6);
    expect(xml).toContain("<infoId>DRID</infoId>");
    expect(xml).toContain("<matchValue>0225</matchValue>");
    expect(xml).toContain("<reportValue>MICHAEL KENLOCK</reportValue>");
    expect(xml).toContain("<locationGroups>1</locationGroups>");
  });

  it("sends the card number once — it is an input, and the response carries its own copy", () => {
    const { xml } = echo(nested());
    expect(xml.match(/<cardNumber>/g)).toHaveLength(1);
    expect(xml).toContain(`<cardNumber>${TARGET.cardNumber}</cardNumber>`);
  });

  it("changes exactly one leaf when locking, and it is inside the header", () => {
    const doc = nested();
    const edits: CardEdit[] = [{ op: "setField", name: "status", value: "Active" }];
    const { body } = echo(doc, edits);

    const before = canonicalize(doc.root, INPUT_FIELDS);
    const after = canonicalize(body, INPUT_FIELDS);
    const changed = [...after.keys()].filter((k) => JSON.stringify(after.get(k)) !== JSON.stringify(before.get(k)));
    expect(changed).toEqual(["/header/status"]);
    expect(after.get("/header/status")).toEqual(["vActive"]);
  });

  it("adds a brand-new field inside the wrapper, not next to it", () => {
    // A field the response never carried still belongs to the header on this shape. Emitted at root
    // level it would be a field EFS does not read, so the write would silently not take effect.
    const stripped = fixture("getCardV2.nestedHeader.xml").replace(/\s*<companyXRef><\/companyXRef>/, "");
    const doc = parseCardDocument(stripped);
    const { body } = echo(doc, [{ op: "setField", name: "companyXRef", value: "FG-0225" }]);
    expect(collectElements(body, "companyXRef")).toHaveLength(0);
    expect(collectElements(collectElements(body, "header")[0]!, "companyXRef")).toHaveLength(1);
  });

  it("still refuses a request that drops the prompts", () => {
    // The guard has to survive the nesting too, or the fix trades one silent deletion for another.
    const doc = nested();
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    const sabotaged = xml.replace(/<infos>.*?<\/infos>/gs, "");
    expect(() => assertEchoFidelity(doc, sabotaged, [])).toThrow(/faithfully echo/);
  });

  it("keeps the card number out of the version token", () => {
    // `root` is the outer element on this shape, so the PAN is inside the subtree being hashed. The
    // version is persisted on every mutation row; it must be about configuration, not identity.
    const doc = nested();
    const other = parseCardDocument(
      fixture("getCardV2.nestedHeader.xml").replace("70830000000000000", "70831111111111111"),
    );
    expect(other.version).toBe(doc.version);
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

  it("masks a 10-digit card number in a fault message", () => {
    expect(redactCardXml("<faultstring>Card 7083000000 is not active</faultstring>")).toContain("••••0000");
  });

  it("masks a card number with an OVER suffix in a fault message", () => {
    const out = redactCardXml("<faultstring>Card 70830000000000111OVER is over-limit</faultstring>");
    expect(out).not.toContain("70830000000000111OVER");
    expect(out).toContain("••••0111");
  });

  it("masks transferCard's fromCard and toCard elements", () => {
    const out = redactCardXml("<transferCard><fromCard>7083000000</fromCard><toCard>7083999999</toCard></transferCard>");
    expect(out).toContain("<fromCard>••••0000</fromCard>");
    expect(out).toContain("<toCard>••••9999</toCard>");
  });

  it("leaves no 10-or-more digit run in a full request body", () => {
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { redactedXml } = serializeSetCardRequest(doc, { clientId: "s", cardNumber: "70830000000007521" }, []);
    expect(redactedXml).not.toMatch(/\d{10,}/);
  });

  it("leaves short numbers — unit numbers, location ids, limits — alone", () => {
    const out = redactCardXml("<locations>115732</locations><limit>250</limit>");
    expect(out).toBe("<locations>115732</locations><limit>250</limit>");
  });

  it("KEEPS the EFS support reference in a fault string", () => {
    // The whole point of that number is to be quoted back to WEX. The digit-run pass ate it — every
    // refusal came out as `Not Allowed ••••3445`, and two rounds of diagnostics went to the vendor
    // without the one value they had explicitly asked for.
    expect(redactCardXml("Not Allowed 109491436176")).toBe("Not Allowed 109491436176");
    expect(redactCardXml("ERROR running command 109491258416")).toBe("ERROR running command 109491258416");
    expect(redactCardXml("Invalid policy number for 139445")).toBe("Invalid policy number for 139445");
  });

  it("keeps several references in one message, and still masks a PAN beside them", () => {
    const out = redactCardXml(
      'v2: Not Allowed 109491436176; v1: Not Allowed 109491388553; card 70830000000007521',
    );
    expect(out).toContain("Not Allowed 109491436176");
    expect(out).toContain("Not Allowed 109491388553");
    expect(out).not.toContain("70830000000007521");
    expect(out).toContain("••••7521");
  });

  it("does not let the reference exemption become a way to smuggle a PAN through", () => {
    // The exemption is keyed on the vendor's fault prefixes, and those prefixes never precede a card
    // number. A PAN-length run is still masked even directly after one.
    const out = redactCardXml("Not Allowed 70830000000007521");
    expect(out).not.toContain("70830000000007521");
  });

  it("masks for display without ever holding a full PAN", () => {
    expect(maskPan("7521")).toBe("•••• 7521");
  });
});

describe("documentShape", () => {
  it("names the flat shape the guide documents", () => {
    expect(documentShape(parseCardDocument(fixture("getCardV2.full.xml")))).toBe("flat");
  });

  it("names the nested shape production returns, and the wrapper it found", () => {
    // Reported by the write probe. A QA account and a production account are different EFS
    // installations; if QA answers flat, a clean QA round-trip proves nothing about production, and
    // this string is what makes that visible instead of assumed.
    expect(documentShape(parseCardDocument(fixture("getCardV2.nestedHeader.xml")))).toBe("nested:header");
  });
});

describe("WSCardv2 element sequence", () => {
  /**
   * `setCardv2` takes a `WSCardv2`, and a schema `<sequence>` is ORDERED. This vendor has twice
   * answered a shape it did not expect with a void success and no effect — the operation name, then
   * the missing `<card>` wrapper — so "it parsed" is not evidence a reordered request applies.
   *
   * The canonical diff cannot see any of this. It keys by path, so `<limits>` before `<infos>` and
   * `<infos>` before `<limits>` are the same document to it. That blindness is why order is a
   * separate assertion rather than more of the same comparison.
   */

  const strip = (name: string, xml: string): string =>
    xml.replace(new RegExp(`\\s*<${name}>[\\s\\S]*?</${name}>`, "g"), "");
  const namesOf = (xml: string): string[] => elementOrder(requestBody(xml));

  it("introduces a new infos collection in sequence order, not at the end", () => {
    // A card with no prompts at all — the first prompt on a fresh card. Before this step the new
    // collection was pushed after everything, landing behind timeRestrictions.
    const doc = parseCardDocument(strip("infos", fixture("getCardV2.full.xml")));
    expect(namesOf(serializeSetCardRequest(doc, TARGET, []).xml)).not.toContain("infos");

    const { xml } = echo(doc, [
      { op: "replaceAll", name: "infos", records: [{ infoId: "DRID", matchValue: "D-1", validationType: "EXACT_MATCH" }] },
    ]);

    const names = namesOf(xml);
    expect(names).toContain("infos");
    expect(names.indexOf("infos")).toBeLessThan(names.indexOf("limits"));
    expect(names.indexOf("infos")).toBeLessThan(names.indexOf("timeRestrictions"));
  });

  it("introduces a new limits collection in sequence order", () => {
    // The p194 product-limit override on a card that has no limits yet.
    const doc = parseCardDocument(strip("limits", fixture("getCardV2.full.xml")));
    const { xml } = echo(doc, [
      { op: "replaceAll", name: "limits", records: [{ limitId: "ULSD", limit: "1000", hours: "1", minHours: "0" }] },
    ]);

    const names = namesOf(xml);
    expect(names.indexOf("infos")).toBeLessThan(names.indexOf("limits"));
    expect(names.indexOf("limits")).toBeLessThan(names.indexOf("locationGroups"));
  });

  it("the guard rejects an out-of-sequence request", () => {
    // Swap the two collection blocks in a request that is otherwise byte-for-byte correct. The
    // canonical diff passes it — same paths, same values — so whatever refuses this is the order
    // check and nothing else.
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    const { xml } = serializeSetCardRequest(doc, TARGET, []);
    const infos = /<infos>[\s\S]*<\/infos>/.exec(xml)![0];
    const limits = /<limits>[\s\S]*<\/limits>/.exec(xml)![0];
    const swapped = xml.replace(infos, "@@SWAP@@").replace(limits, infos).replace("@@SWAP@@", limits);

    expect(swapped).not.toBe(xml); // the sabotage actually happened
    expect(namesOf(swapped).indexOf("limits")).toBeLessThan(namesOf(swapped).indexOf("infos"));
    expect(() => assertEchoFidelity(doc, swapped, [])).toThrow(/out of WSCardv2 sequence/);
  });

  it("record fields are emitted in WSCardInfo sequence order regardless of object literal order", () => {
    // The natural order to think in — id, then what it does, then the value — is not the WSDL's.
    // Before this step the request carried whatever order the caller typed.
    const doc = parseCardDocument(fixture("getCardV2.empty.xml"));
    const { xml } = echo(doc, [
      {
        op: "replaceAll",
        name: "infos",
        records: [{
          infoId: "DRID",
          validationType: "EXACT_MATCH",
          matchValue: "D-1",
          value: "0",
          reportValue: "",
          lengthCheck: "false",
          minimum: "0",
          maximum: "0",
        }],
      },
    ]);

    const record = /<infos>([\s\S]*?)<\/infos>/.exec(xml)![1]!;
    const emitted = [...record.matchAll(/<([A-Za-z]+)[>/]/g)].map((m) => m[1]!);
    expect(emitted).toEqual([
      "infoId", "lengthCheck", "matchValue", "maximum", "minimum", "reportValue", "validationType", "value",
    ]);
  });

  it("emits a limits record in WSCardLimitv2 order, the type WSCardv2 actually declares", () => {
    // WSCardv2.limits is WSCardLimitv2 (six fields), not the four-field WSCardLimit. Getting that
    // wrong would leave autoRollMap/autoRollMax with nowhere to go.
    const doc = parseCardDocument(fixture("getCardV2.empty.xml"));
    const { xml } = echo(doc, [
      {
        op: "replaceAll",
        name: "limits",
        records: [{ autoRollMax: "75", limitId: "ULSD", minHours: "0", limit: "300", autoRollMap: "7", hours: "24" }],
      },
    ]);

    const record = /<limits>([\s\S]*?)<\/limits>/.exec(xml)![1]!;
    const emitted = [...record.matchAll(/<([A-Za-z]+)[>/]/g)].map((m) => m[1]!);
    expect(emitted).toEqual(["hours", "limit", "limitId", "minHours", "autoRollMap", "autoRollMax"]);
  });

  it("keeps a field the WSDL does not declare rather than dropping or refusing it", () => {
    // Unmodelled vendor fields surviving the round trip is the whole design. We cannot know where a
    // new one belongs, so it goes last — present, which is what matters, since an omitted field is a
    // DELETED field.
    const doc = parseCardDocument(fixture("getCardV2.empty.xml"));
    const { xml } = echo(doc, [
      {
        op: "replaceAll",
        name: "infos",
        records: [{ someFutureField: "x", validationType: "EXACT_MATCH", infoId: "DRID" }],
      },
    ]);

    const record = /<infos>([\s\S]*?)<\/infos>/.exec(xml)![1]!;
    const emitted = [...record.matchAll(/<([A-Za-z]+)[>/]/g)].map((m) => m[1]!);
    expect(emitted).toEqual(["infoId", "validationType", "someFutureField"]);
  });

  it("a zero-edit echo of every fixture is in sequence, and byte-stable", () => {
    for (const name of ALL_FIXTURES) {
      const doc = parseCardDocument(fixture(name));
      const first = serializeSetCardRequest(doc, TARGET, []).xml;
      const second = serializeSetCardRequest(doc, TARGET, []).xml;

      expect(second, `${name} is not byte-stable across two serializations`).toBe(first);
      expect(() => assertEchoFidelity(doc, first, [])).not.toThrow();

      const ranks = namesOf(first).map(sequenceRank);
      expect([...ranks].sort((a, b) => a - b), `${name} is out of sequence`).toEqual(ranks);
    }
  });
});
