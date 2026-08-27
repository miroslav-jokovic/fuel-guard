import { describe, expect, it } from "vitest";
import {
  EFS_SERVICE_NS,
  experimentEdits,
  isExperimentStatus,
  transformForVariant,
  variantOperation,
} from "./efsCardExperiments.js";
import { assertEchoFidelity, serializeSetCardRequest } from "./efsCardEcho.js";
import { parseCardDocument } from "./efsCardXml.js";
import { EfsSoapError } from "./efsSoapSession.js";

/**
 * The property under test: every variant is the CANONICAL serializer output with only the wrapper
 * rewritten, and the fidelity guard accepts the transformed bytes. The fixture is the nested
 * response shape this account actually returns (see findCardRoot in efsCardXml.ts), statuses in the
 * uppercase casing observed in production — reads must stay tolerant of it.
 */

const NESTED_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
<ns:getCardv2Response xmlns:ns="http://com.tch.cards.service"><result>
<cardNumber>7083051234567897671</cardNumber>
<header><companyXRef>TEST-PAYEE-001</companyXRef><handEnter>POLICY</handEnter><infoSource>BOTH</infoSource><limitSource>POLICY</limitSource><locationOverride>0</locationOverride><locationSource>POLICY</locationSource><overrideAllLocations>false</overrideAllLocations><originalStatus xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/><payrollStatus>FOLLOWS</payrollStatus><override>0</override><policyNumber>1</policyNumber><status>ACTIVE</status><timeSource>POLICY</timeSource><lastUsedDate>2026-08-11T12:43:00.000-05:00</lastUsedDate><lastTransaction>1513124524</lastTransaction><payrollUse>B</payrollUse></header>
<infos><infoId>UNIT</infoId><lengthCheck>false</lengthCheck><matchValue></matchValue><maximum>0</maximum><minimum>0</minimum><reportValue>T001</reportValue><validationType>REPORT_ONLY</validationType><value>0</value></infos>
<infos><infoId>DRID</infoId><lengthCheck>false</lengthCheck><matchValue>1001</matchValue><maximum>0</maximum><minimum>0</minimum><reportValue></reportValue><validationType>EXACT_MATCH</validationType><value>0</value></infos>
<locationGroups>1</locationGroups>
</result></ns:getCardv2Response></soapenv:Body></soapenv:Envelope>`;

const TARGET = { clientId: "client-123", cardNumber: "7083051234567897671" };

function canonicalRequest(edits = experimentEdits({ statusValue: "Hold" })) {
  const doc = parseCardDocument(NESTED_RESPONSE);
  const { xml } = serializeSetCardRequest(doc, TARGET, edits);
  return { doc, xml, edits };
}

describe("experimentEdits", () => {
  it("builds a lone status edit, value verbatim", () => {
    expect(experimentEdits({ statusValue: "HOLD" }))
      .toEqual([{ op: "setField", name: "status", value: "HOLD" }]);
  });

  it("adds originalStatus when asked (hypothesis H3)", () => {
    expect(experimentEdits({ statusValue: "Hold", originalStatusValue: "Active" }))
      .toEqual([
        { op: "setField", name: "status", value: "Hold" },
        { op: "setField", name: "originalStatus", value: "Active" },
      ]);
  });

  it("refuses Deleted and Fraud in any casing — the hard delete stays unreachable", () => {
    for (const value of ["Deleted", "DELETED", "Fraud", "fraud", ""]) {
      expect(() => experimentEdits({ statusValue: value })).toThrow(EfsSoapError);
    }
    expect(isExperimentStatus("hOlD")).toBe(true);
    expect(isExperimentStatus("Deleted")).toBe(false);
  });
});

describe("transformForVariant", () => {
  it("standard: byte-identical, dispatches setCardv2", () => {
    const { xml } = canonicalRequest();
    const out = transformForVariant(xml, "standard");
    expect(out.body).toBe(xml);
    expect(out.operation).toBe("setCardv2");
  });

  it("qualified_wrapper: namespace-qualified operation element, same content (hypothesis H5)", () => {
    const { xml } = canonicalRequest();
    const out = transformForVariant(xml, "qualified_wrapper");
    expect(out.operation).toBe("setCardv2");
    expect(out.body.startsWith(`<setCardv2 xmlns="${EFS_SERVICE_NS}"`)).toBe(true);
    expect(out.body.endsWith("</setCardv2>")).toBe(true);
    // Content untouched: clientId first, then the whole card, exactly as the canonical body had them.
    expect(out.body).toContain("<clientId>client-123</clientId>");
    expect(out.body).toContain("<card><cardNumber>7083051234567897671</cardNumber>");
    expect(out.body).not.toContain("CardManagementEP_setCardv2");
  });

  it("setcard_v1: renamed message wrapper, dispatches setCard (E5)", () => {
    const { xml } = canonicalRequest();
    const out = transformForVariant(xml, "setcard_v1");
    expect(out.operation).toBe("setCard");
    expect(out.body.startsWith("<CardManagementEP_setCard ")).toBe(true);
    expect(out.body.endsWith("</CardManagementEP_setCard>")).toBe(true);
    expect(out.body).not.toContain("setCardv2");
  });

  it("refuses a string that is not the canonical wrapper — no third shape by accident", () => {
    expect(() => transformForVariant("<somethingElse/>", "qualified_wrapper")).toThrow(EfsSoapError);
  });

  it("every variant still passes the fidelity guard on the transformed bytes", () => {
    const { doc, xml, edits } = canonicalRequest();
    for (const variant of ["standard", "qualified_wrapper", "setcard_v1"] as const) {
      const { body } = transformForVariant(xml, variant);
      expect(() => assertEchoFidelity(doc, body, edits)).not.toThrow();
    }
  });

  it("variantOperation matches the transform's operation", () => {
    const { xml } = canonicalRequest();
    for (const variant of ["standard", "qualified_wrapper", "setcard_v1"] as const) {
      expect(variantOperation(variant)).toBe(transformForVariant(xml, variant).operation);
    }
  });
});
