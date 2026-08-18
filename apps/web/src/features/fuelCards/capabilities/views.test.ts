import { describe, expect, it } from "vitest";
import { PROMPT_INPUT_UNSET } from "@fuelguard/shared";
import type { CapabilityCardContext } from "./types.js";
import { cardDeactivateView } from "./cardDeactivate.view.js";
import { cardLockView } from "./cardLock.view.js";
import { cardUnlockView } from "./cardUnlock.view.js";
import { overrideClearView } from "./overrideClear.view.js";
import { overrideGrantView } from "./overrideGrant.view.js";
import { promptsSetView } from "./promptsSet.view.js";

/**
 * The confirmation copy — the last thing between a person and a pump.
 *
 * Re-homed from `cardControlModel.test.ts` in Step 6.4, when that file's five hand-written
 * confirmation builders were deleted: the drawer reads views now, so the assertions have to be
 * about views or they are testing dead code. The cases are the ones that name NUMBERS or escalate a
 * TONE, because an override confirmation that says "2 purchases" while granting three is worse than
 * no confirmation at all.
 *
 * The diffs are asserted here too, which the old file could not do — `cardControlModel.ts` had no
 * diff to assert. Every operation showing what will change before it commits is Step 6.2's exit
 * criterion, and it is only true if each `diff` actually returns rows.
 */

const cardWith = (over: Partial<CapabilityCardContext["card"]> = {}): CapabilityCardContext["card"] => ({
  status: "Active", infos: [], limits: [],
  overrideUses: 0, overrideAllLocations: false, locationOverrideId: null, ...over,
});

const context = (over: Partial<CapabilityCardContext["card"]> = {}): CapabilityCardContext => ({
  maskedRef: "••••7671",
  card: cardWith(over),
  locationLabel: (id) => (id === "442" ? "Loves station 442, Effingham IL" : null),
});

describe("granting an exception names the numbers", () => {
  it("says how many purchases and where, rather than 'grant an override?'", () => {
    // A generic confirmation is how somebody grants nine when they meant one.
    const one = overrideGrantView.confirmation(
      { uses: 1, scope: { kind: "location", locationId: "442" }, limits: [], allowHandEnter: false, expectedVersion: "" },
      context(),
    );
    expect(one.body).toContain("1 purchase");
    expect(one.body).toContain("Loves station 442, Effingham IL");

    const three = overrideGrantView.confirmation(
      { uses: 3, scope: { kind: "all" }, limits: [], allowHandEnter: false, expectedVersion: "" },
      context(),
    );
    expect(three.body).toContain("3 purchases");
    expect(three.body).toContain("at any location");
  });

  it("falls back to the location ID it cannot name — that is what a driver is declined at", () => {
    const unknown = overrideGrantView.confirmation(
      { uses: 2, scope: { kind: "location", locationId: "999" }, limits: [], allowHandEnter: false, expectedVersion: "" },
      context(),
    );
    expect(unknown.body).toContain("999");
  });

  it("shows the scope change, not only the count — 'anywhere' vs 'one station' is the decision", () => {
    const rows = overrideGrantView.diff(
      cardWith({ overrideUses: 0 }),
      { uses: 2, scope: { kind: "location", locationId: "442" }, limits: [], allowHandEnter: false, expectedVersion: "" },
    );
    expect(rows.map((r) => r.label)).toContain("Where");
    expect(rows.find((r) => r.label === "Exception")?.after).toBe("2 purchases");
  });
});

describe("locking says what happens to the DRIVER", () => {
  it("describes the consequence at the pump, never the field name", () => {
    const lock = cardLockView.confirmation({ status: "Hold", clearException: false, expectedVersion: "" }, context());
    expect(lock.body).toMatch(/stops working/i);
    expect(lock.body).not.toMatch(/status/i);
  });

  /**
   * Step 8.1 moved deactivation out of this view and into `cardDeactivate.view.ts` with the status.
   * The case is kept — the two acts must still read differently — but it now asks the two views it
   * takes to express them, which is the thing that changed.
   */
  it("treats deactivating as a different, heavier act than holding", () => {
    expect(cardDeactivateView.confirmation({ expectedVersion: "" }, context()).title)
      .toMatch(/deactivate/i);
    expect(cardLockView.confirmation({ status: "Hold", clearException: false, expectedVersion: "" }, context()).title)
      .toMatch(/lock/i);
  });

  it("says a HELD card is being retired, not that it is about to stop working", () => {
    // The sentence Step 8.1 was written for. A card on Hold already declines fuel, so the ordinary
    // copy's "stops working at every location immediately" is false of it — and the claim that
    // matters is the one the step's own Verify names: it never becomes spendable on the way.
    const held = cardDeactivateView.confirmation({ expectedVersion: "" }, context({ status: "HOLD" }));
    expect(held.title).toMatch(/retire/i);
    expect(held.body).toMatch(/nothing changes at the pump/i);
    expect(held.body).not.toMatch(/stops working at every location/i);
  });

  it("asks for the last four before it will retire anything", () => {
    // Absent on every other view, which `deactivation is the only capability that asks…` below pins.
    expect(cardDeactivateView.confirmation({ expectedVersion: "" }, context()).typeToConfirm?.label)
      .toMatch(/last four/i);
  });

  /**
   * The 2026-08-12 incident: this account spells its statuses `ACTIVE` and `HOLD` where the guide
   * says `Active` and `Hold`. The label table is consulted only for values we RECOGNISE, so a
   * status EFS invents is shown verbatim rather than blanked or coerced into a neighbour — which is
   * what would hide the next mismatch of that kind.
   */
  it("labels a status it recognises, whatever casing this account sent", () => {
    const rows = cardLockView.diff(cardWith({ status: "ACTIVE" }), { status: "Hold", clearException: false, expectedVersion: "" });
    expect(rows[0]!.before).toBe("Active");
    expect(rows[0]!.after).toBe("On hold");
  });

  it("shows a status it does NOT recognise verbatim, never blanked", () => {
    const rows = cardLockView.diff(cardWith({ status: "PENDING_REVIEW" }), { status: "Hold", clearException: false, expectedVersion: "" });
    expect(rows[0]!.before).toBe("PENDING_REVIEW");
  });
});

describe("unlocking escalates when EFS has flagged the card", () => {
  it("warns for an ordinary unlock and alarms for a fraud flag", () => {
    expect(cardUnlockView.confirmation({ expectedVersion: "" }, context({ status: "Hold" })).tone)
      .toBe("warning");

    const fraud = cardUnlockView.confirmation({ expectedVersion: "" }, context({ status: "FRAUD" }));
    expect(fraud.tone).toBe("danger");
    expect(fraud.body).toMatch(/password/i);
  });

  it("recognises the flag through this account's own casing", () => {
    // `efsStatusEquals`, never `===`: an exact comparison shows the mild copy for the one case that
    // most needs the stronger wording.
    expect(cardUnlockView.confirmation({ expectedVersion: "" }, context({ status: "FRAUD" })).title)
      .toMatch(/fraud/i);
  });
});

describe("prompts spell out what a removal costs", () => {
  const body = (remove: boolean) => ({
    expectedVersion: "", replaceAll: true as const, allowRemoveDriverId: remove,
    prompts: [{ infoId: "DRID", validationType: "EXACT_MATCH" as const, matchValue: "D-1", reportValue: null, remove, ...PROMPT_INPUT_UNSET }],
  });

  it("names what the fleet loses when the Driver ID prompt goes", () => {
    const removing = promptsSetView.confirmation(body(true), context());
    expect(removing.tone).toBe("danger");
    expect(removing.body).toMatch(/anyone holding it can fuel/i);
    expect(promptsSetView.confirmation(body(false), context()).tone).toBe("warning");
  });

  it("says the removal in words, not by an empty cell", () => {
    const rows = promptsSetView.diff(cardWith({ infos: [] }), body(true));
    expect(rows[0]!.after).toMatch(/removed/i);
  });

  it("shows one row per prompt the request MENTIONS, not per prompt the card has", () => {
    // A prompt the request does not name is untouched — removal has to be authored, never inferred
    // from omission — so listing the card's others would show rows that are not part of the decision.
    const rows = promptsSetView.diff(
      cardWith({ infos: [{ infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "3182" }] as never }),
      body(false),
    );
    expect(rows).toHaveLength(1);
    // Step 9.6: by NAME, not the vendor's four-character code. An operator about to stop the pump
    // asking who is fuelling should read "Driver ID", not a code they have to translate.
    expect(rows[0]!.label).toBe("Driver ID");
  });

  it("names an unknown info id by its raw code rather than showing nothing", () => {
    // `infoLabel` falls back to the id for a code the guide's table does not carry, so an id we have
    // not catalogued degrades to what this row showed before 9.6 — never to a blank label.
    const rows = promptsSetView.diff(
      cardWith({ infos: [] as never }),
      { expectedVersion: "", replaceAll: true, allowRemoveDriverId: false,
        prompts: [{ infoId: "ZZZZ", validationType: "REPORT_ONLY", matchValue: null, reportValue: "x",
          remove: false, ...PROMPT_INPUT_UNSET }] } as never,
    );
    expect(rows[0]!.label).toBe("ZZZZ");
  });
});

describe("removing an exception says the same thing whichever mechanism sends it", () => {
  it("describes the operator's decision, not our plumbing", () => {
    const copy = overrideClearView.confirmation({ expectedVersion: "" }, context({ overrideUses: 2 }));
    expect(copy.title).toMatch(/remove the exception/i);
    expect(copy.body).toMatch(/normal limits/i);
  });

  it("shows the uses being cancelled", () => {
    const rows = overrideClearView.diff(cardWith({ overrideUses: 2 }), { expectedVersion: "" });
    expect(rows[0]!.before).toBe("2 purchases");
    expect(rows[0]!.after).toBe("None");
  });
});
