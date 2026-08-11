import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertEchoFidelity, serializeSetCardRequest } from "../lib/efsCardEcho.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { lockEdits, overrideClearEdits, overrideGrantEdits, promptsEdits, unlockEdits } from "./efsCardEdits.js";

/**
 * The vendor recipes, tested as recipes: what does the REQUEST look like after each intent.
 *
 * Every case ends by serializing and running `assertEchoFidelity`, because an edit list that is
 * "right" in isolation but produces a request the guard refuses is not right — and the guard is what
 * stands between a prompts change and a fleet losing its driver assignments.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");
const doc = (name = "getCardV2.full.xml") => parseCardDocument(fixture(name));
const CARD = "70830000000000000";

/** Build the request the way `setCardV2` does, and let the production guard judge it. */
function request(document: ReturnType<typeof doc>, edits: Parameters<typeof serializeSetCardRequest>[2]): string {
  const { xml } = serializeSetCardRequest(document, { clientId: "sess-1", cardNumber: CARD }, edits);
  assertEchoFidelity(document, xml, edits);
  return xml;
}

describe("lock / unlock", () => {
  it("changes exactly one leaf", () => {
    const before = doc();
    const xml = request(before, lockEdits("Hold"));
    expect(xml).toContain("<status>Hold</status>");
    expect(xml).not.toContain("<status>Active</status>");
    // Everything else is still there — the policy, the prompts, the limits.
    expect(xml).toContain("<policyNumber>14</policyNumber>");
    expect(xml.match(/<infos>/g)?.length).toBe(before.card.infos.length);
  });

  it("never writes Deleted", () => {
    // `Deleted` is EFS's hard delete (p128) and is not in EFS_WRITABLE_STATUSES, so it is unreachable
    // from the type. This asserts the two values the product actually offers.
    expect(lockEdits("Hold")).toEqual([{ op: "setField", name: "status", value: "Hold" }]);
    expect(lockEdits("Inactive")).toEqual([{ op: "setField", name: "status", value: "Inactive" }]);
    expect(unlockEdits()).toEqual([{ op: "setField", name: "status", value: "Active" }]);
  });
});

describe("override — the p194 recipes", () => {
  it("all locations: overrideAllLocations=true and override = uses", () => {
    const before = doc();
    const xml = request(before, overrideGrantEdits(before, 2, { kind: "all" }));
    expect(xml).toContain("<override>2</override>");
    expect(xml).toContain("<overrideAllLocations>true</overrideAllLocations>");
  });

  it("single location: the 6-digit id, all-locations false, override = uses", () => {
    const before = doc();
    const xml = request(before, overrideGrantEdits(before, 1, { kind: "location", locationId: "442013" }));
    expect(xml).toContain("<locationOverride>442013</locationOverride>");
    expect(xml).toContain("<overrideAllLocations>false</overrideAllLocations>");
    expect(xml).toContain("<override>1</override>");
  });

  it("clears a stale single-location id when granting an all-locations override", () => {
    // The one inference in efsCardEdits.ts, and the reason it is tested rather than argued about:
    // a card already carrying last week's truck stop must not end up asserting both scopes at once.
    const before = doc("getCardV2.overridden.xml");
    expect(before.card.locationOverrideId).not.toBeNull();
    const xml = request(before, overrideGrantEdits(before, 3, { kind: "all" }));
    expect(xml).toContain("<locationOverride>0</locationOverride>");
    expect(xml).toContain("<overrideAllLocations>true</overrideAllLocations>");
  });

  it("does not touch locationOverride on a card that never had one", () => {
    const before = doc(); // locationOverride is "0" — already the no-id value
    const edits = overrideGrantEdits(before, 1, { kind: "all" });
    expect(edits.some((e) => e.name === "locationOverride")).toBe(false);
  });

  it("clearing disarms all three fields unconditionally", () => {
    const before = doc("getCardV2.overridden.xml");
    const xml = request(before, overrideClearEdits());
    expect(xml).toContain("<override>0</override>");
    expect(xml).toContain("<overrideAllLocations>false</overrideAllLocations>");
    expect(xml).toContain("<locationOverride>0</locationOverride>");
  });
});

describe("prompts — full replace without collateral damage", () => {
  it("preserves every field of an edited record, changing only the two that were asked for", () => {
    const before = doc();
    const drid = before.card.infos.find((i) => i.infoId === "DRID")!;
    expect(drid.lengthCheck).not.toBeNull(); // the fixture carries fields the API never surfaces

    const plan = promptsEdits(before, [
      { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-9999" },
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: "T-118" },
    ]);
    const xml = request(before, plan.edits);

    expect(xml).toContain("<matchValue>D-9999</matchValue>");
    // lengthCheck was never mentioned by the operator and must survive the round trip.
    expect(xml).toContain("<lengthCheck>false</lengthCheck>");
    expect(plan.removedInfoIds).toEqual([]);
  });

  it("passes non-editable records through untouched", () => {
    const before = doc();
    const others = before.card.infos.filter((i) => i.infoId !== "DRID" && i.infoId !== "UNIT");
    expect(others.length).toBeGreaterThan(0); // the fixture has to actually exercise this

    const plan = promptsEdits(before, [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-4471" }]);
    const xml = request(before, plan.edits);
    for (const other of others) expect(xml).toContain(`<infoId>${other.infoId}</infoId>`);
  });

  it("reports a removal rather than performing one silently", () => {
    const before = doc();
    // UNIT submitted, DRID absent → the operator removed the driver-ID prompt. The route is what
    // decides whether that is allowed; this function only has to SAY it is happening.
    const plan = promptsEdits(before, [{ infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: "T-118" }]);
    expect(plan.removedInfoIds).toContain("DRID");
    const xml = request(before, plan.edits);
    expect(xml).not.toContain("<infoId>DRID</infoId>");
  });

  it("appends a prompt the card has never had", () => {
    const before = doc("getCardV2.empty.xml");
    const plan = promptsEdits(before, [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-1" }]);
    const xml = request(before, plan.edits);
    expect(xml).toContain("<infoId>DRID</infoId>");
    expect(xml).toContain("<matchValue>D-1</matchValue>");
  });

  it("blanks a cleared matchValue rather than nilling it", () => {
    const before = doc();
    const plan = promptsEdits(before, [
      { infoId: "DRID", validationType: "REPORT_ONLY", matchValue: null },
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: "T-118" },
    ]);
    const xml = request(before, plan.edits);
    // "Blank them out if you intend to remove them" (p137) — an empty element, not xsi:nil, and
    // certainly not an omitted one.
    expect(xml).toContain("<matchValue></matchValue>");
  });

  it("records before and after for the audit trail", () => {
    const before = doc();
    const plan = promptsEdits(before, [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-9999" }]);
    expect(plan.before.find((p) => p.infoId === "DRID")?.matchValue).toBe("D-4471");
    expect(plan.after.find((p) => p.infoId === "DRID")?.matchValue).toBe("D-9999");
  });
});
