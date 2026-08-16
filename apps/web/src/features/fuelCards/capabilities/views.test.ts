import { describe, expect, it } from "vitest";
import type { CapabilityCardContext } from "./types.js";
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
      { uses: 1, scope: { kind: "location", locationId: "442" }, expectedVersion: "", reason: "" },
      context(),
    );
    expect(one.body).toContain("1 purchase");
    expect(one.body).toContain("Loves station 442, Effingham IL");

    const three = overrideGrantView.confirmation(
      { uses: 3, scope: { kind: "all" }, expectedVersion: "", reason: "" },
      context(),
    );
    expect(three.body).toContain("3 purchases");
    expect(three.body).toContain("at any location");
  });

  it("falls back to the location ID it cannot name — that is what a driver is declined at", () => {
    const unknown = overrideGrantView.confirmation(
      { uses: 2, scope: { kind: "location", locationId: "999" }, expectedVersion: "", reason: "" },
      context(),
    );
    expect(unknown.body).toContain("999");
  });

  it("shows the scope change, not only the count — 'anywhere' vs 'one station' is the decision", () => {
    const rows = overrideGrantView.diff(
      cardWith({ overrideUses: 0 }),
      { uses: 2, scope: { kind: "location", locationId: "442" }, expectedVersion: "", reason: "" },
    );
    expect(rows.map((r) => r.label)).toContain("Where");
    expect(rows.find((r) => r.label === "Exception")?.after).toBe("2 purchases");
  });
});

describe("locking says what happens to the DRIVER", () => {
  it("describes the consequence at the pump, never the field name", () => {
    const lock = cardLockView.confirmation({ status: "Hold", expectedVersion: "", reason: "" }, context());
    expect(lock.body).toMatch(/stops working/i);
    expect(lock.body).not.toMatch(/status/i);
  });

  it("treats deactivating as a different, heavier act than holding", () => {
    expect(cardLockView.confirmation({ status: "Inactive", expectedVersion: "", reason: "" }, context()).title)
      .toMatch(/deactivate/i);
    expect(cardLockView.confirmation({ status: "Hold", expectedVersion: "", reason: "" }, context()).title)
      .toMatch(/lock/i);
  });

  /**
   * The 2026-08-12 incident: this account spells its statuses `ACTIVE` and `HOLD` where the guide
   * says `Active` and `Hold`. The label table is consulted only for values we RECOGNISE, so a
   * status EFS invents is shown verbatim rather than blanked or coerced into a neighbour — which is
   * what would hide the next mismatch of that kind.
   */
  it("labels a status it recognises, whatever casing this account sent", () => {
    const rows = cardLockView.diff(cardWith({ status: "ACTIVE" }), { status: "Hold", expectedVersion: "", reason: "" });
    expect(rows[0]!.before).toBe("Active");
    expect(rows[0]!.after).toBe("On hold");
  });

  it("shows a status it does NOT recognise verbatim, never blanked", () => {
    const rows = cardLockView.diff(cardWith({ status: "PENDING_REVIEW" }), { status: "Hold", expectedVersion: "", reason: "" });
    expect(rows[0]!.before).toBe("PENDING_REVIEW");
  });
});

describe("unlocking escalates when EFS has flagged the card", () => {
  it("warns for an ordinary unlock and alarms for a fraud flag", () => {
    expect(cardUnlockView.confirmation({ expectedVersion: "", reason: "" }, context({ status: "Hold" })).tone)
      .toBe("warning");

    const fraud = cardUnlockView.confirmation({ expectedVersion: "", reason: "" }, context({ status: "FRAUD" }));
    expect(fraud.tone).toBe("danger");
    expect(fraud.body).toMatch(/password/i);
  });

  it("recognises the flag through this account's own casing", () => {
    // `efsStatusEquals`, never `===`: an exact comparison shows the mild copy for the one case that
    // most needs the stronger wording.
    expect(cardUnlockView.confirmation({ expectedVersion: "", reason: "" }, context({ status: "FRAUD" })).title)
      .toMatch(/fraud/i);
  });
});

describe("prompts spell out what a removal costs", () => {
  const body = (remove: boolean) => ({
    expectedVersion: "", reason: "", replaceAll: true as const, allowRemoveDriverId: remove,
    prompts: [{ infoId: "DRID" as const, validationType: "EXACT_MATCH" as const, matchValue: "D-1", reportValue: null, remove }],
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
    expect(rows[0]!.label).toBe("DRID");
  });
});

describe("removing an exception says the same thing whichever mechanism sends it", () => {
  it("describes the operator's decision, not our plumbing", () => {
    const copy = overrideClearView.confirmation({ expectedVersion: "", reason: "" }, context({ overrideUses: 2 }));
    expect(copy.title).toMatch(/remove the exception/i);
    expect(copy.body).toMatch(/normal limits/i);
  });

  it("shows the uses being cancelled", () => {
    const rows = overrideClearView.diff(cardWith({ overrideUses: 2 }), { expectedVersion: "", reason: "" });
    expect(rows[0]!.before).toBe("2 purchases");
    expect(rows[0]!.after).toBe("None");
  });
});
