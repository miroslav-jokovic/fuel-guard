import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertEchoFidelity, serializeSetCardRequest, type CardEdit } from "../lib/efsCardEcho.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { PROMPT_INPUT_UNSET, type PromptInput } from "@fuelguard/shared";
import {
  lockEdits, overrideClearEdits, overrideGrantEdits, overrideLimitsBefore,
  promptsEdits as promptsEditsFor, unlockEdits,
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
    const xml = request(before, overrideGrantEdits(before, 2, { kind: "all" }, []));
    expect(xml).toContain("<override>2</override>");
    expect(xml).toContain("<overrideAllLocations>true</overrideAllLocations>");
  });

  /**
   * `handEnter` is a PERMANENT card field (string(7) ALLOW/DISALLOW/POLICY, no override scope in the
   * guide or the WSDL). Three properties, and the middle one is the dangerous one.
   */
  it("writes handEnter ALLOW only when the operator asked", () => {
    const before = doc("getCardV2.full.xml");
    const xml = request(before, overrideGrantEdits(before, 1, { kind: "all" }, [], true));
    expect(xml).toContain("<handEnter>ALLOW</handEnter>");
  });

  it("NEVER EDITS handEnter when unticked — an unticked box is 'not asked', not 'take it away'", () => {
    /**
     * The expensive direction: granting a tank of fuel must not silently revoke hand entry on a card
     * that had it.
     *
     * ⚠ The assertion is on the EDIT LIST and on the value being UNCHANGED — not on the string
     * `DISALLOW` being absent from the request. The first draft asserted that and failed, correctly:
     * `getCardV2.full.xml` already carries `<handEnter>DISALLOW</handEnter>` and the echo faithfully
     * sends it back, which is the echo doing its job. "The field is not in the request" and "we did
     * not change the field" are different claims, and only the second one is the property here.
     */
    const before = doc("getCardV2.full.xml");
    const edits = overrideGrantEdits(before, 1, { kind: "all" }, [], false);
    expect(edits.some((e) => e.name === "handEnter")).toBe(false);
    // Echoed back exactly as the card had it — `full.xml` holds DISALLOW, and it stays DISALLOW.
    expect(before.card.handEnter).toBe("DISALLOW");
    expect(request(before, edits)).toContain("<handEnter>DISALLOW</handEnter>");
    // And the ALLOW the ticked path would have written is nowhere in it.
    expect(request(before, edits)).not.toContain("<handEnter>ALLOW</handEnter>");
  });

  it("defaults to not touching it at all, so a caller that forgets changes nothing", () => {
    const before = doc("getCardV2.full.xml");
    // Same arity as every pre-10.3 call site. The default has to be the SAFE direction.
    expect(overrideGrantEdits(before, 1, { kind: "all" }, []).some((e) => e.name === "handEnter"))
      .toBe(false);
  });

  it("single location: the 6-digit id, all-locations false, override = uses", () => {
    const before = doc();
    const xml = request(before, overrideGrantEdits(before, 1, { kind: "location", locationId: "442013" }, []));
    expect(xml).toContain("<locationOverride>442013</locationOverride>");
    expect(xml).toContain("<overrideAllLocations>false</overrideAllLocations>");
    expect(xml).toContain("<override>1</override>");
  });

  it("clears a stale single-location id when granting an all-locations override", () => {
    // The one inference in efsCardEdits.ts, and the reason it is tested rather than argued about:
    // a card already carrying last week's truck stop must not end up asserting both scopes at once.
    const before = doc("getCardV2.overridden.xml");
    expect(before.card.locationOverrideId).not.toBeNull();
    const xml = request(before, overrideGrantEdits(before, 3, { kind: "all" }, []));
    expect(xml).toContain("<locationOverride>0</locationOverride>");
    expect(xml).toContain("<overrideAllLocations>true</overrideAllLocations>");
  });

  it("does not touch locationOverride on a card that never had one", () => {
    const before = doc(); // locationOverride is "0" — already the no-id value
    const edits = overrideGrantEdits(before, 1, { kind: "all" }, []);
    expect(edits.some((e) => e.name === "locationOverride")).toBe(false);
  });

  it("a product-limit override sends the p194 limits array, in sequence position", () => {
    // The guide's own worked example, verbatim: "if you want to allow ULSD for 1000 gallons, you would
    // put <hours>1</hours><limit>1000</limit><limitId>ULSD</limitId><minHours>0</minHours>".
    const before = doc();
    const xml = request(before, overrideGrantEdits(before, 1, { kind: "all" }, [
      { limitId: "ULSD", limit: 1000, hours: 1, minHours: 0 },
    ]));

    // Exact bytes, in WSCardLimitv2's declared field order — not four separate contains().
    expect(xml).toContain("<limits><hours>1</hours><limit>1000</limit><limitId>ULSD</limitId><minHours>0</minHours></limits>");
    // Exactly one record: the override REPLACES the card's limits, it does not add to them.
    expect(xml.match(/<limits>/g)).toHaveLength(1);
    expect(xml).toContain("<override>1</override>");
    expect(xml).toContain("<overrideAllLocations>true</overrideAllLocations>");
    // In sequence: after <infos>, before <locationGroups>. WSCardv2's <sequence> is ordered, and this
    // vendor answers a shape it did not expect with a void success (audit W3).
    expect(xml.indexOf("<limits>")).toBeGreaterThan(xml.indexOf("<infos>"));
    expect(xml.indexOf("<limits>")).toBeLessThan(xml.indexOf("<locationGroups>"));
  });

  it("names every pre-existing limit in removals — and the guard is what makes that necessary", () => {
    // ⚠ THE STEP 10.1 PLAN ERROR. It specified `removals: []`, which passes on a card whose <limits>
    // is already empty — the one card Step 10.4 proves on — and is refused on every card that has any.
    //
    // getCardV2.full.xml carries ULSD 250 and CADV 100. The override mentions only ULSD, so BOTH are
    // omissions as far as the guard is concerned: CADV disappears entirely, and ULSD is rebuilt.
    const before = doc();
    const edits = overrideGrantEdits(before, 1, { kind: "all" }, [
      { limitId: "ULSD", limit: 1000, hours: 1, minHours: 0 },
    ]);
    const replace = edits.find((e) => e.op === "replaceAll" && e.name === "limits");
    expect(replace?.op === "replaceAll" && replace.removals).toEqual(["ULSD", "CADV"]);

    // The fix sends.
    expect(() => request(before, edits)).not.toThrow();

    // THE POSITIVE CONTROL: the same edit list with removals emptied — the plan as written — is
    // refused. Without this assertion the one above passes whether or not removals does anything.
    const asPlanned = edits.map((e) =>
      (e.op === "replaceAll" && e.name === "limits" ? { ...e, removals: [] } : e));
    expect(() => request(before, asPlanned)).toThrow(/drops <limits> record "CADV"/);
  });

  it("survives a card whose limit record carries the auto-roll fields the override omits", () => {
    // The SECOND reason removals cannot be empty, independent of the first. getCardV2.autoRoll.xml's
    // ULSD record has autoRollMap and autoRollMax; p194's override record has four fields and neither.
    // The guard's field-drop branch reads an omitted field as a DELETED field, so "reuse the existing
    // record and change the amount" is not a way round this — naming the id is.
    const before = doc("getCardV2.autoRoll.xml");
    const edits = overrideGrantEdits(before, 1, { kind: "all" }, [
      { limitId: "ULSD", limit: 1000, hours: 1, minHours: 0 },
    ]);
    expect(() => request(before, edits)).not.toThrow();
    expect(request(before, edits)).not.toContain("autoRoll");

    // POSITIVE CONTROL: unnamed, it is the field-drop refusal rather than the record-drop one.
    const unnamed = edits.map((e) =>
      (e.op === "replaceAll" && e.name === "limits" ? { ...e, removals: ["DEF"] } : e));
    expect(() => request(before, unnamed)).toThrow(/<autoRollMap>.*from <limits> record "ULSD"/);
  });

  it("introduces the limits collection on a card that has none — Step 10.4's empty-limits card", () => {
    // The case the reserved QA card exists to prove, run offline first because that card is consumed
    // by its first use (docs/24 §3.3) and the sequence position cannot be re-proven on it afterwards.
    //
    // Built by stripping <limits> from a full card rather than using getCardV2.empty.xml: the QA card
    // is a card with the OTHER collections and no limits, so a fixture with no collections at all
    // cannot show where the new one lands. `empty.xml` has no <locationGroups> to land before.
    const before = parseCardDocument(
      fixture("getCardV2.full.xml").replace(/\s*<limits>[\s\S]*?<\/limits>/g, ""),
    );
    expect(before.card.limits).toHaveLength(0);
    const xml = request(before, overrideGrantEdits(before, 1, { kind: "all" }, [
      { limitId: "ULSD", limit: 1000, hours: 1, minHours: 0 },
    ]));
    expect(xml).toContain("<limitId>ULSD</limitId>");
    expect(xml.indexOf("<limits>")).toBeGreaterThan(xml.indexOf("<infos>"));
    expect(xml.indexOf("<limits>")).toBeLessThan(xml.indexOf("<locationGroups>"));

    // Nothing to remove, so nothing is named — the ONE shape the plan's `removals: []` was right for,
    // and the reason the error would have passed 10.4 and failed on the first real card.
    const replace = overrideGrantEdits(before, 1, { kind: "all" }, [
      { limitId: "ULSD", limit: 1000, hours: 1, minHours: 0 },
    ]).find((e) => e.op === "replaceAll");
    expect(replace?.op === "replaceAll" && replace.removals).toEqual([]);
  });

  it("multiple products in one override — the portal's Save and Add Another", () => {
    const before = doc();
    const xml = request(before, overrideGrantEdits(before, 2, { kind: "all" }, [
      { limitId: "ULSD", limit: 1000, hours: 1, minHours: 0 },
      { limitId: "DEF", limit: 50, hours: 24, minHours: 0 },
    ]));
    expect(xml.match(/<limits>/g)).toHaveLength(2);
    expect(xml).toContain("<limitId>DEF</limitId>");
  });

  it("a scope-only override leaves the card's limits completely alone", () => {
    // The ordinary case, and the boundary that matters: no limits submitted means no limits EDIT, so
    // the records are echoed byte-identical rather than rebuilt from a typed view.
    const before = doc();
    const edits = overrideGrantEdits(before, 2, { kind: "all" }, []);
    expect(edits.some((e) => e.name === "limits")).toBe(false);
    const xml = request(before, edits);
    expect(xml).toContain("<limitId>CADV</limitId>");
    expect(xml).toContain("<limit>250</limit>"); // ULSD, untouched
  });

  it("records the limits the override deleted, so a failed restore is recoverable", () => {
    // Step 10.1's half of the §1.2 question. Nothing in the guide promises EFS restores these when the
    // override is cleared; this is what makes the answer survivable whichever way 10.4 goes.
    expect(overrideLimitsBefore(doc())).toEqual([
      { hours: "24", limit: "250", limitId: "ULSD", minHours: "4" },
      { hours: "168", limit: "100", limitId: "CADV", minHours: "0" },
    ]);
    expect(overrideLimitsBefore(doc("getCardV2.empty.xml"))).toEqual([]);
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

  it("carries an ACCRUAL_CHECK prompt's accrual value onto the wire, to the byte", () => {
    // Step 9.3's Verify. The guide gives one sentence on this field — "For the accrual check method
    // for odometer or hubometer, this is the accrual value" (p36, p135, p138) — and `value` was
    // hardcoded to "0", so odometer following could be selected and silently configured with no
    // accrual at all. Production carries exactly that shape on both policies (docs/25 Q3).
    const before = doc();
    const submitted: readonly PromptInput[] = [
      { infoId: "ODRD", validationType: "ACCRUAL_CHECK", matchValue: null, reportValue: null,
        ...PROMPT_INPUT_UNSET, value: 1800, remove: false },
    ];
    const xml = request(before, promptsEditsFor(before, submitted, ["ODRD"]).edits);

    expect(xml).toContain("<validationType>ACCRUAL_CHECK</validationType>");
    expect(xml).toContain("<value>1800</value>");
    // The POSITIVE CONTROL: the fixture's own ODRD record already carries <value>1500</value>, so
    // asserting only the presence of 1800 would pass against a builder that echoed the old record
    // untouched and ignored the submission entirely.
    expect(xml).not.toContain("<value>1500</value>");
  });

  it("writes the guide's own \"0\" for every non-accrual combination", () => {
    // The second half of the vendor's sentence: "For all other info ids/validation type combos just
    // leave as <value/> or <value>0</value>". Written for EVERY record rather than only the accrual
    // one, because `replaceAll` means a record's fields are whatever this request says they are — a
    // prompt switched OFF ACCRUAL_CHECK while keeping a stale accrual would carry a number the
    // operator cannot see and did not ask for.
    const before = doc();
    const submitted: readonly PromptInput[] = [
      { infoId: "ODRD", validationType: "REPORT_ONLY", matchValue: null, reportValue: "441022",
        ...PROMPT_INPUT_UNSET, value: 1800, remove: false },
    ];
    const xml = request(before, promptsEditsFor(before, submitted, ["ODRD"]).edits);
    expect(xml).toContain("<value>0</value>");
    expect(xml).not.toContain("<value>1800</value>");
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
