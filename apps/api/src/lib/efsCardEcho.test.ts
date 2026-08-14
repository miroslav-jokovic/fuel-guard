import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertEchoFidelity, serializeSetCardRequest, type CardEdit } from "./efsCardEcho.js";
import { parseCardDocument } from "./efsCardXml.js";
import { childElements, collectElements, localName, type XmlElement } from "./efsXml.js";

/**
 * What the echo guard can and cannot see.
 *
 * `assertEchoFidelity` answers one question — "does the request say what the EDIT LIST says?" — and
 * these cases are about the second question it must also answer: "does the edit list still contain
 * the card?" A `replaceAll` is a full-document write, so a record missing from `records` is a record
 * DELETED from the card, and an edit list that lost one is indistinguishable from an edit list that
 * meant to lose one unless the guard is told which removals were intended.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/efs/${name}`, import.meta.url)), "utf8");
const doc = () => parseCardDocument(fixture("getCardV2.full.xml"));
const target = { clientId: "client-1", cardNumber: "70830000000000000" };

/** The record shape the real caller builds: the DOM element flattened, every field preserved. */
function flatten(element: XmlElement): Record<string, string | null> {
  const record: Record<string, string | null> = {};
  for (const child of childElements(element)) {
    record[localName(child)] = (child.textContent ?? "").trim();
  }
  return record;
}

const infosOf = (d: ReturnType<typeof doc>) => collectElements(d.root, "infos").map(flatten);

/** Serialize then check, exactly as `setCardV2` does inside its body callback. */
function buildAndCheck(d: ReturnType<typeof doc>, edits: CardEdit[]): void {
  const { xml } = serializeSetCardRequest(d, target, edits);
  assertEchoFidelity(d, xml, edits);
}

describe("a replaceAll that silently drops part of the card", () => {
  it("refuses an edit list that lost a whole record", () => {
    const d = doc();
    const records = infosOf(d);
    expect(records.map((r) => r.infoId)).toEqual(["DRID", "UNIT", "ODRD"]);

    // ODRD is not editable in Phase 1, so a caller that rebuilt the array from the EDITABLE prompts
    // alone would drop it — and a dropped record in a full-replace is a deleted prompt.
    const lossy = records.filter((r) => r.infoId !== "ODRD");

    expect(() => buildAndCheck(d, [{ op: "replaceAll", name: "infos", records: lossy }])).toThrow(
      /echo|faithful|infos/i,
    );
  });

  it("refuses an edit list that lost a field inside a record — the Phase 1 reportValue bug", () => {
    const d = doc();
    // Exactly the Phase 1 defect: records rebuilt from the typed view, which carried only the three
    // fields the UI knew about, so reportValue and the rest were dropped from every record.
    const lossy = infosOf(d).map((r) => ({
      infoId: r.infoId ?? null,
      matchValue: r.matchValue ?? null,
      validationType: r.validationType ?? null,
    }));

    expect(() => buildAndCheck(d, [{ op: "replaceAll", name: "infos", records: lossy }])).toThrow(
      /echo|faithful|infos/i,
    );
  });

  it("allows the same drop once the edit declares it", () => {
    const d = doc();
    const records = infosOf(d).filter((r) => r.infoId !== "ODRD");

    expect(() =>
      buildAndCheck(d, [{ op: "replaceAll", name: "infos", records, removals: ["ODRD"] }]),
    ).not.toThrow();
  });

  it("does not accept a declaration of one removal as cover for another", () => {
    const d = doc();
    const records = infosOf(d).filter((r) => r.infoId !== "ODRD" && r.infoId !== "UNIT");

    expect(() =>
      buildAndCheck(d, [{ op: "replaceAll", name: "infos", records, removals: ["ODRD"] }]),
    ).toThrow(/drops <infos> record "UNIT"/);
  });

  it("still allows removeAll, which is what an intended emptying looks like", () => {
    const d = doc();
    expect(() => buildAndCheck(d, [{ op: "removeAll", name: "infos" }])).not.toThrow();
  });

  it("refuses a record it cannot identify rather than waving it through", () => {
    // A record with fields but no <infoId> cannot be matched against the response, so there is no way
    // to tell "preserved" from "deleted". Ambiguity has to resolve toward refusing.
    const d = parseCardDocument(
      fixture("getCardV2.full.xml").replace("<infoId>ODRD</infoId>", "<infoId></infoId>"),
    );
    expect(() => buildAndCheck(d, [{ op: "replaceAll", name: "infos", records: infosOf(d) }])).toThrow(
      /no usable <infoId>/,
    );
  });

  it("allows a replaceAll that preserves every record and every field", () => {
    const d = doc();
    const records = infosOf(d).map((r) =>
      r.infoId === "DRID" ? { ...r, matchValue: "D-9999" } : r,
    );

    expect(() => buildAndCheck(d, [{ op: "replaceAll", name: "infos", records }])).not.toThrow();
  });
});
