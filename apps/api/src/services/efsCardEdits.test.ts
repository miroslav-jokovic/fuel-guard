import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertEchoFidelity, serializeSetCardRequest, type CardEdit } from "../lib/efsCardEcho.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { PROMPT_INPUT_UNSET, type PromptInput } from "@fuelguard/shared";
import {
  lockEdits, overrideClearEdits, overrideGrantEdits, promptsEdits as promptsEditsFor, unlockEdits,
} from "./efsCardEdits.js";

/**
 * Every case below is about the DIFF — what a submitted prompt does to the request bytes — not about
 * WHICH ids an account lets us edit. Step 9.1 made the editable set a parameter, so these pin it to
 * the pair they were written against and keep asserting exactly what they asserted before.
 *
 * The account-driven half is elsewhere on purpose: `resolveEditableInfoIds` is proven in
 * `packages/shared/src/efsCardCatalog.test.ts` and against the real captures in
 * `apps/api/src/efs/editableInfoIds.test.ts`. Widening the set HERE would make these cases restate
 * that suite's claim in a place nobody would look for it.
 */
const promptsEdits = (doc: CardDocument, prompts: readonly PromptInput[]) =>
  promptsEditsFor(doc, prompts, ["DRID", "UNIT"]);

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

const setField = (e: CardEdit) => {
  if (e.op !== "setField") throw new Error(`expected setField, got ${e.op}`);
  return e;
};

/** Build the request the way `setCardV2` does, and let the production guard judge it. */
function request(document: ReturnType<typeof doc>, edits: Parameters<typeof serializeSetCardRequest>[2]): string {
  const { xml } = serializeSetCardRequest(document, { clientId: "sess-1", cardNumber: CARD }, edits);
  assertEchoFidelity(document, xml, edits);
  return xml;
}

describe("lock / unlock", () => {
  it("changes exactly one leaf", () => {
    const before = doc();
    const xml = request(before, lockEdits("Hold", before.card.status));
    expect(xml).toContain("<status>Hold</status>");
    expect(xml).not.toContain("<status>Active</status>");
    // Everything else is still there — the policy, the prompts, the limits.
    expect(xml).toContain("<policyNumber>14</policyNumber>");
    expect(xml.match(/<infos>/g)?.length).toBe(before.card.infos.length);
  });

  it("never writes Deleted", () => {
    // `Deleted` is EFS's hard delete (p128) and is not in EFS_WRITABLE_STATUSES, so it is unreachable
    // from the type. This asserts the two values the product actually offers.
    expect(lockEdits("Hold", "Active")).toEqual([{ op: "setField", name: "status", value: "Hold" }]);
    expect(lockEdits("Inactive", "Active")).toEqual([{ op: "setField", name: "status", value: "Inactive" }]);
    expect(unlockEdits("Hold")).toEqual([{ op: "setField", name: "status", value: "Active" }]);
  });
});

describe("H1 — the write is spelled in the account's own casing", () => {
  // The confirmed 2026-08-12 root cause: this vendor answers a status write whose casing does not
  // match the account's stored vocabulary with void SUCCESS and silently ignores it. E2 proved
  // `HOLD` lands in 533ms on an upper-case account while `Active` is accepted-and-dropped. These
  // are the tripwires: if someone "simplifies" the builders back to verbatim targets, they fail.

  it("TRIPWIRE: an account reading ACTIVE gets <status>HOLD</status> on the wire, not Hold", () => {
    const before = parseCardDocument(
      fixture("getCardV2.full.xml").replace("<status>Active</status>", "<status>ACTIVE</status>"),
    );
    expect(before.card.status).toBe("ACTIVE"); // the replace actually hit the header field
    const xml = request(before, lockEdits("Hold", before.card.status));
    expect(xml).toContain("<status>HOLD</status>");
    expect(xml).not.toContain("<status>Hold</status>");
  });

  it("unlock on an upper-case account writes ACTIVE — the exact write whose mixed-case twin failed live", () => {
    expect(unlockEdits("HOLD")).toEqual([{ op: "setField", name: "status", value: "ACTIVE" }]);
  });

  it("a lower-case account gets lower-case writes", () => {
    expect(lockEdits("Hold", "active")).toEqual([{ op: "setField", name: "status", value: "hold" }]);
    expect(unlockEdits("hold")).toEqual([{ op: "setField", name: "status", value: "active" }]);
  });

  it("mixed-case and absent observations pass the guide spelling through verbatim", () => {
    // Mixed case is the guide's own spelling — every fixture in this repo — and inventing a
    // transform for it would be exactly the kind of assumption H1 punished.
    expect(setField(lockEdits("Hold", "Active")[0]!).value).toBe("Hold");
    expect(setField(lockEdits("Hold", null)[0]!).value).toBe("Hold");
    expect(setField(unlockEdits(null)[0]!).value).toBe("Active");
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
  it("preserves every field of an edited record, changing only the prompt fields that were asked for", () => {
    const before = doc();
    const drid = before.card.infos.find((i) => i.infoId === "DRID")!;
    expect(drid.lengthCheck).not.toBeNull(); // the fixture carries fields the API never surfaces

    const plan = promptsEdits(before, [
      { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-9999", reportValue: null, remove: false, ...PROMPT_INPUT_UNSET },
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "T-118", remove: false, ...PROMPT_INPUT_UNSET },
    ]);
    const xml = request(before, plan.edits);

    expect(xml).toContain("<matchValue>D-9999</matchValue>");
    // lengthCheck was never mentioned by the operator and must survive the round trip.
    expect(xml).toContain("<lengthCheck>false</lengthCheck>");
    expect(plan.removedInfoIds).toEqual([]);
  });

  it("honours a submission for an id the ACCOUNT allows, which the hardcoded pair never reached", () => {
    // Step 9.1's whole point, on the wire. `ODRD` is in the guide's Info IDs table (p168) and in
    // both real accounts' getPromptTypes, and was unreachable while the editable set was DRID/UNIT
    // — it is also the id Step 9.3's odometer following needs.
    const before = doc();
    expect(before.card.infos.some((i) => i.infoId === "ODRD")).toBe(true); // the fixture must carry one

    const submitted: readonly PromptInput[] = [
      { infoId: "ODRD", validationType: "REPORT_ONLY", matchValue: null, reportValue: "441022", remove: false, ...PROMPT_INPUT_UNSET },
    ];
    expect(request(before, promptsEditsFor(before, submitted, ["DRID", "UNIT", "ODRD"]).edits))
      .toContain("<reportValue>441022</reportValue>");

    // The POSITIVE CONTROL, and the half that makes the assertion above mean anything: the same
    // submission against the old pair must not reach the wire. Without it, a promptsEdits that
    // ignored `editableInfoIds` entirely and edited everything would pass the first expectation.
    //
    // It REFUSES rather than silently dropping the record, and that is the behaviour worth pinning:
    // the untouched-passthrough loop never enters a non-editable id into `seen`, so the append loop
    // would otherwise push a SECOND <infos> with the same infoId — the duplicate shape audit P1-6b
    // says this vendor accepts and ignores.
    expect(() => promptsEditsFor(before, submitted, ["DRID", "UNIT"]))
      .toThrowError(/not editable on this account/);
  });

  it("passes non-editable records through untouched", () => {
    const before = doc();
    const others = before.card.infos.filter((i) => i.infoId !== "DRID" && i.infoId !== "UNIT");
    expect(others.length).toBeGreaterThan(0); // the fixture has to actually exercise this

    const plan = promptsEdits(before, [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-4471", reportValue: null, remove: false, ...PROMPT_INPUT_UNSET }]);
    const xml = request(before, plan.edits);
    for (const other of others) expect(xml).toContain(`<infoId>${other.infoId}</infoId>`);
  });

  it("reports an explicit removal rather than performing one silently", () => {
    const before = doc();
    const plan = promptsEdits(before, [
      { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-4471", reportValue: null, remove: true, ...PROMPT_INPUT_UNSET },
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "T-118", remove: false, ...PROMPT_INPUT_UNSET },
    ]);
    expect(plan.removedInfoIds).toContain("DRID");
    const xml = request(before, plan.edits);
    expect(xml).not.toContain("<infoId>DRID</infoId>");
  });

  it("appends a prompt the card has never had", () => {
    const before = doc("getCardV2.empty.xml");
    const plan = promptsEdits(before, [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-1", reportValue: null, remove: false, ...PROMPT_INPUT_UNSET }]);
    const xml = request(before, plan.edits);
    expect(xml).toContain("<infoId>DRID</infoId>");
    expect(xml).toContain("<matchValue>D-1</matchValue>");
  });

  it("does not remove a REPORT_ONLY prompt when the operator changes nothing", () => {
    const before = doc();
    const plan = promptsEdits(before, [
      { infoId: "DRID", validationType: "REPORT_ONLY", matchValue: null, reportValue: "D-report", remove: false, ...PROMPT_INPUT_UNSET },
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "T-118", remove: false, ...PROMPT_INPUT_UNSET },
    ]);
    const xml = request(before, plan.edits);
    expect(plan.removedInfoIds).toEqual([]);
    expect(xml).toContain("<validationType>REPORT_ONLY</validationType>");
    expect(xml).toContain("<matchValue></matchValue>");
    expect(xml).toContain("<reportValue>D-report</reportValue>");
  });

  it("writes reportValue, not matchValue, when switching EXACT_MATCH to REPORT_ONLY", () => {
    const before = doc();
    const plan = promptsEdits(before, [
      { infoId: "DRID", validationType: "REPORT_ONLY", matchValue: null, reportValue: "D-report", remove: false, ...PROMPT_INPUT_UNSET },
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "T-118", remove: false, ...PROMPT_INPUT_UNSET },
    ]);
    const xml = request(before, plan.edits);
    expect(xml).toContain("<matchValue></matchValue>");
    expect(xml).toContain("<reportValue>D-report</reportValue>");
  });

  it("appends a REPORT_ONLY prompt with its report value, not an empty string", () => {
    const before = doc("getCardV2.empty.xml");
    const plan = promptsEdits(before, [{
      infoId: "DRID", validationType: "REPORT_ONLY", matchValue: null, reportValue: "D-report", remove: false,
      ...PROMPT_INPUT_UNSET,
    }]);
    const xml = request(before, plan.edits);
    expect(xml).toContain("<validationType>REPORT_ONLY</validationType>");
    expect(xml).toContain("<reportValue>D-report</reportValue>");
  });

  it("records before and after for the audit trail", () => {
    const before = doc();
    const plan = promptsEdits(before, [{ infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-9999", reportValue: null, remove: false, ...PROMPT_INPUT_UNSET }]);
    expect(plan.before.find((p) => p.infoId === "DRID")?.matchValue).toBe("D-4471");
    expect(plan.after.find((p) => p.infoId === "DRID")?.matchValue).toBe("D-9999");
  });

  it("refuses a record containing a nested container", () => {
    // A flat record cannot hold `<a><b>x</b></a>`, and flattening it to textContent would keep the
    // value while losing the path — invisibly, because the flattened record is the input to BOTH the
    // request and its expectation. No EFS collection nests today; if one starts, this is where it
    // stops, on the first write, instead of quietly reshaping a card.
    const nestedInfos = fixture("getCardV2.full.xml").replace(
      "<matchValue>D-4471</matchValue>",
      "<matchValue><part>D</part><part>4471</part></matchValue>",
    );
    const before = parseCardDocument(nestedInfos);

    expect(() =>
      promptsEdits(before, [{ infoId: "UNIT", validationType: "EXACT_MATCH", matchValue: "4242", reportValue: null, remove: false, ...PROMPT_INPUT_UNSET }]),
    ).toThrow(/nested container/);
  });
});
