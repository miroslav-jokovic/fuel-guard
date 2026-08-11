import { describe, expect, it } from "vitest";
import type { CardCapabilities } from "@fuelguard/shared";
import {
  availability,
  cardStatusLabel,
  cardStatusTone,
  compareCardValues,
  freshness,
  limitRows,
  lockConfirmation,
  outcomeNotice,
  overrideConfirmation,
  promptRows,
  promptsConfirmation,
  unlockConfirmation,
  sourceSentence,
  timeRows,
} from "./cardControlModel.js";

const caps = (over: Partial<CardCapabilities> = {}): CardCapabilities => ({
  canLock: false, canUnlock: false, canOverride: false, canSetPrompts: false,
  writeEntitlement: "unknown", blockedBy: null, ...over,
});

describe("card status", () => {
  it("treats Hold as a warning, not a fault — it is the intended, reversible state", () => {
    expect(cardStatusTone("Hold")).toBe("warning");
    expect(cardStatusTone("Active")).toBe("success");
    expect(cardStatusTone("Fraud")).toBe("danger");
  });

  it("renders an unfamiliar status verbatim rather than blanking it", () => {
    // A status EFS invents next year is the single most important fact about that card.
    expect(cardStatusLabel("SomethingNew")).toBe("SomethingNew");
    expect(cardStatusTone("SomethingNew")).toBe("neutral");
  });

  it("labels Hold in words a dispatcher uses", () => {
    expect(cardStatusLabel("Hold")).toBe("On hold");
  });
});

describe("freshness", () => {
  const now = new Date("2026-08-10T12:00:00Z");

  it("is quiet while the mirror is recent", () => {
    expect(freshness("2026-08-10T11:58:00Z", now)).toEqual({ text: "Checked 2 minutes ago.", stale: false });
  });

  it("names the next action once a SWEEP has been missed", () => {
    // Rewritten deliberately. This used to assert that two and a half hours old was stale, which is
    // what put a caution banner on a correctly-working page for most of every day — the sweep runs
    // DAILY. Staleness is now measured against the cadence the server reports, not a fixed hour.
    const missedASweep = freshness("2026-08-09T09:30:00Z", now);
    expect(missedASweep.stale).toBe(true);
    expect(missedASweep.text).toContain("Refresh");

    // Hours old, inside the cadence: a fact, not a warning, and no call to action.
    const withinCadence = freshness("2026-08-10T09:30:00Z", now);
    expect(withinCadence.stale).toBe(false);
    expect(withinCadence.text).not.toContain("Refresh");
  });

  it("counts in days once it is older than a day", () => {
    expect(freshness("2026-08-08T12:00:00Z", now).text).toMatch(/2 days/);
  });

  it("says so plainly when the card has never been read", () => {
    expect(freshness(null, now)).toEqual({ text: "Never checked.", stale: true });
    expect(freshness("not-a-date", now).stale).toBe(true);
  });
});

describe("limit rows", () => {
  it("renders a fuel limit in GALLONS", () => {
    // "gallons for fuel or DEF dispensed and dollar amounts in all other cases" (p36). Getting this
    // backwards tells a manager a 250-gallon cap is $250.
    const [row] = limitRows([{ value: { limitId: "ULSD", limit: 250, hours: 24, minHours: 4 }, origin: "card" }]);
    expect(row!.detail).toBe("250 gal per 24h, 4h between uses");
    expect(row!.label).toBe("Ultra-low-sulphur diesel");
  });

  it("renders a non-fuel limit in DOLLARS", () => {
    const [row] = limitRows([{ value: { limitId: "CADV", limit: 100, hours: 168, minHours: null }, origin: "card" }]);
    expect(row!.detail).toBe("$100 per 168h");
  });

  it("falls back to dollars for a limit id we have never seen", () => {
    // The default direction matters: claiming volume for an unknown product overstates what a driver
    // can buy, dollars understates it. Understating is the safe error.
    const [row] = limitRows([{ value: { limitId: "ZZZZ", limit: 5, hours: null, minHours: null }, origin: "card" }]);
    expect(row!.detail).toBe("$5");
  });
});

describe("prompt rows", () => {
  it("says a prompt must MATCH when it validates at the pump", () => {
    const [row] = promptRows([{
      value: { infoId: "DRID", validationType: "EXACT_MATCH", matchValue: "D-4471", reportValue: null },
      origin: "card",
    }]);
    expect(row!.label).toBe("Driver ID");
    expect(row!.detail).toBe("Must match D-4471");
  });

  it("distinguishes a reporting prompt, which stops nobody", () => {
    const [row] = promptRows([{
      value: { infoId: "TRIP", validationType: "REPORT_ONLY", matchValue: null, reportValue: "T-9" },
      origin: "card",
    }]);
    expect(row!.detail).toBe("Recorded only: T-9");
  });
});

describe("time rows", () => {
  it("uses EFS day numbering — 1 is Sunday, not Monday", () => {
    // Off by one here mislabels every restriction on every card (p37).
    expect(timeRows([{ value: { day: 1, beginTime: null, endTime: null }, origin: "card" }])[0]!.label).toBe("Sunday");
    expect(timeRows([{ value: { day: 7, beginTime: null, endTime: null }, origin: "card" }])[0]!.label).toBe("Saturday");
  });

  it("shows only the time of day, ignoring the meaningless 1970 date", () => {
    const [row] = timeRows([{
      value: { day: 2, beginTime: "1970-01-01T22:00:00-06:00", endTime: "1970-01-01T05:00:00-06:00" },
      origin: "card",
    }]);
    expect(row!.detail).toBe("Blocked 22:00 to 05:00");
  });
});

describe("card trumps policy", () => {
  it("marks a card row enforced and an overridden policy row not", () => {
    const rows = limitRows([
      { value: { limitId: "ULSD", limit: 250, hours: 24, minHours: 0 }, origin: "card" },
      { value: { limitId: "ULSD", limit: 150, hours: 24, minHours: 0 }, origin: "policy-overridden" },
    ]);
    expect(rows[0]).toMatchObject({ originLabel: "Card", enforced: true });
    expect(rows[1]).toMatchObject({ originLabel: "Overridden by card", enforced: false });
  });

  it("keeps a policy rule that the source mode ignores, and says it is not applied", () => {
    // Dropping it silently produces the worst support call: the WEX portal shows a rule, this page
    // does not mention it, and nobody can say which one the pump obeys.
    const [row] = limitRows([{ value: { limitId: "MERC", limit: 50, hours: 24, minHours: 0 }, origin: "policy-ignored" }]);
    expect(row).toMatchObject({ originLabel: "Not applied", enforced: false });
  });

  it("states the source mode in a sentence rather than leaving it to badges", () => {
    expect(sourceSentence("Limits", "CARD", 14)).toBe("Limits come from the card only.");
    expect(sourceSentence("Limits", "POLICY", 14)).toBe("Limits come from policy 14.");
    expect(sourceSentence("Limits", "BOTH", 14)).toContain("Card settings win where they overlap.");
    expect(sourceSentence("Limits", null, null)).toContain("not reported by EFS");
  });
});

describe("write availability", () => {
  it("is available when nothing blocks it", () => {
    expect(availability(caps({ blockedBy: null }), false).mode).toBe("available");
  });

  it("HIDES the panel when the person's role will never allow it", () => {
    // Advertising a capability somebody can never have reads as a taunt.
    expect(availability(caps({ blockedBy: "role" }), false).mode).toBe("hidden");
    expect(availability(caps({ blockedBy: "not_approver" }), false).mode).toBe("hidden");
  });

  it("DISABLES with an explanation when the entitlement has not been checked", () => {
    // The read layer ships first; hiding the actions makes Phase A look like a dead end.
    const notice = availability(caps({ blockedBy: "not_entitled", writeEntitlement: "unknown" }), true);
    expect(notice.mode).toBe("disabled");
    expect(notice.message).toContain("EFS write check");
    expect(notice.actionTo).toBe("/settings/card-control");
  });

  it("says something different when EFS has actually refused", () => {
    const notice = availability(caps({ blockedBy: "not_entitled", writeEntitlement: "denied" }), true);
    expect(notice.message).toContain("WEX representative");
    // Nothing for an admin to click: the next step is a phone call, not a settings page.
    expect(notice.actionTo).toBeUndefined();
  });

  it("offers the settings link only to an admin", () => {
    expect(availability(caps({ blockedBy: "not_enabled" }), false).actionTo).toBeUndefined();
    expect(availability(caps({ blockedBy: "not_enabled" }), true).actionTo).toBe("/settings/card-control");
  });

  it("explains the kill switch without pointing anywhere", () => {
    expect(availability(caps({ blockedBy: "kill_switch" }), true)).toMatchObject({
      mode: "disabled", message: "Card actions are paused.",
    });
  });
});

describe("confirmation copy — the last thing between a person and a pump", () => {
  it("names the numbers in an override confirmation", () => {
    // A generic "grant an override?" is how somebody grants nine when they meant one.
    const one = overrideConfirmation(1, "Loves #442, Effingham IL");
    expect(one.body).toContain("1 purchase");
    expect(one.body).toContain("Loves #442, Effingham IL");

    const three = overrideConfirmation(3, null);
    expect(three.body).toContain("3 purchases");
    expect(three.body).toContain("at any location");
  });

  it("says what happens to the DRIVER, not what happens to the record", () => {
    const lock = lockConfirmation("Hold");
    expect(lock.body).toMatch(/stops working/i);
    expect(lock.body).not.toMatch(/status/i);
  });

  it("treats deactivating as a different, heavier act than holding", () => {
    expect(lockConfirmation("Inactive").title).toMatch(/deactivate/i);
    expect(lockConfirmation("Hold").title).toMatch(/lock/i);
  });

  it("escalates an unlock when EFS has flagged the card for fraud", () => {
    expect(unlockConfirmation(false).tone).toBe("warning");
    const fraud = unlockConfirmation(true);
    expect(fraud.tone).toBe("danger");
    expect(fraud.body).toMatch(/password/i);
  });

  it("spells out what removing the Driver ID prompt costs", () => {
    const removing = promptsConfirmation(true);
    expect(removing.tone).toBe("danger");
    expect(removing.body).toMatch(/anyone holding it can fuel/i);
    expect(promptsConfirmation(false).tone).toBe("warning");
  });
});

describe("outcomeNotice — a 200 is not a success", () => {
  it("reports a clean success plainly", () => {
    expect(outcomeNotice({ status: "succeeded" }, "Card locked")).toEqual({
      kind: "success",
      title: "Card locked",
    });
  });

  it("never dresses an unverified write up as either a success or a failure", () => {
    // The write went out and nobody knows what happened. Retrying could apply it twice, so the copy
    // sends the operator to the WEX portal instead.
    const notice = outcomeNotice({ status: "sent" }, "Card locked");
    expect(notice.kind).toBe("warning");
    expect(notice.title).toMatch(/not confirmed/i);
    expect(notice.message).toMatch(/could apply it twice/i);
  });

  it("says a drifted write worked AND that something else moved", () => {
    const notice = outcomeNotice({ status: "drift_detected", driftFields: ["/policyNumber"] }, "Card locked");
    expect(notice.kind).toBe("warning");
    expect(notice.title).toContain("Card locked");
    expect(notice.message).toContain("policyNumber");
  });

  it("quotes the vendor's own words on a refusal", () => {
    // EFS fault strings carry the reference number WEX support asks for; dropping it costs a round
    // trip through the vendor.
    const notice = outcomeNotice(
      { status: "failed", faultMessage: "Not Allowed 109491436176" },
      "Card locked",
    );
    expect(notice.kind).toBe("error");
    expect(notice.message).toContain("109491436176");
  });
});

describe("effective config — the card/policy merge, as an operator reads it", () => {
  const prompt = (infoId: string, matchValue: string | null) => ({
    infoId, validationType: "EXACT_MATCH", matchValue, reportValue: null,
  });
  const limit = (limitId: string, value: number) => ({
    limitId, limit: value, hours: 24, minHours: null,
  });

  it("keeps a losing policy row visible rather than dropping it", () => {
    // Silently omitting it produces the worst support call there is: the operator can see the rule in
    // the WEX portal, cannot see it here, and has no way to tell which one is real.
    const rows = promptRows([
      { value: prompt("DRID", "D-4471"), origin: "card" },
      { value: prompt("DRID", "POLICY-DEFAULT"), origin: "policy-overridden" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.enforced).toBe(true);
    expect(rows[1]!.enforced).toBe(false);
    expect(rows[1]!.originLabel.toLowerCase()).toMatch(/overridden|policy/);
  });

  it("marks a policy row that never applied at all", () => {
    // `infoSource: CARD` means policy prompts are ignored entirely — a different fact from "the card
    // happened to override this one", and the badge has to say so.
    const rows = promptRows([{ value: prompt("UNIT", "3182"), origin: "policy-ignored" }]);
    expect(rows[0]!.enforced).toBe(false);
  });

  it("renders fuel limits in GALLONS and everything else in DOLLARS", () => {
    // Getting this backwards makes a 100-gallon cap look like a $100 cap — roughly a factor of four,
    // in the direction that reads as "this truck is over budget" when it is not.
    const [fuel] = limitRows([{ value: limit("ULSD", 250), origin: "card" }]);
    const [cash] = limitRows([{ value: limit("CADV", 100), origin: "card" }]);
    expect(fuel!.detail).toMatch(/gal/i);
    expect(cash!.detail).toContain("$");
    expect(cash!.detail).not.toMatch(/gal/i);
  });

  it("states the source in words, naming the policy number", () => {
    expect(sourceSentence("Prompts", "BOTH", 14)).toMatch(/policy 14/i);
    expect(sourceSentence("Limits", "CARD", 14)).toMatch(/card/i);
  });

  it("labels a time restriction by its day name, not its number", () => {
    // The guide numbers 1 = Sunday, NOT 0 = Sunday. An off-by-one here shows a Saturday curfew on a
    // Friday and nobody notices until a driver is declined.
    const rows = timeRows([
      { value: { day: 1, beginTime: "1970-01-01T22:00:00-06:00", endTime: "1970-01-01T05:00:00-06:00" }, origin: "card" },
    ]);
    expect(rows[0]!.label).toMatch(/sunday/i);
  });
});

describe("status rendering when EFS sends its own casing", () => {
  it("gives ACTIVE the same badge as Active", () => {
    // Before this, every card in a fleet reporting upper-case statuses got a neutral grey badge — the
    // one visual signal the page exists to give, switched off across the board.
    expect(cardStatusTone("ACTIVE")).toBe("success");
    expect(cardStatusTone("HOLD")).toBe("warning");
    expect(cardStatusTone("INACTIVE")).toBe("neutral");
    expect(cardStatusLabel("HOLD")).toBe("On hold");
  });

  it("still shows a status it has no label for, verbatim and untoned", () => {
    expect(cardStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(cardStatusTone("SOMETHING_NEW")).toBe("neutral");
  });
});

describe("freshness — an alarm that fires every day is not an alarm", () => {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

  it("stays quiet inside the sweep cadence", () => {
    // The sweep is DAILY by design. Calling three hours old "stale" meant a correctly-working page
    // demanded a refresh for roughly 23 hours out of every 24 — which is how a real warning gets
    // ignored. 26h = one daily sweep plus grace.
    const three = freshness(at(180), new Date(), 26 * 60);
    expect(three.stale).toBe(false);
    expect(three.text).toBe("Checked 3 hours ago.");
    expect(three.text).not.toMatch(/refresh/i);
  });

  it("speaks up once a sweep has actually been missed", () => {
    const late = freshness(at(27 * 60), new Date(), 26 * 60);
    expect(late.stale).toBe(true);
    expect(late.text).toMatch(/Refresh to see current settings/);
  });

  it("honours a tighter cadence when the server runs one", () => {
    // An org sweeping every 6 hours should hear about a 9-hour-old mirror.
    expect(freshness(at(9 * 60), new Date(), 8 * 60).stale).toBe(true);
    expect(freshness(at(3 * 60), new Date(), 8 * 60).stale).toBe(false);
  });

  it("still treats never-checked as stale", () => {
    expect(freshness(null).stale).toBe(true);
    expect(freshness(null).text).toBe("Never checked.");
  });
});

describe("sorting the card list", () => {
  it("keeps blanks at the BOTTOM in both directions", () => {
    // The rule worth a test: a card with no driver is not "the smallest driver". Sorting blanks to
    // the top of an ascending list buries every card that HAS one under a wall of dashes.
    expect(compareCardValues(null, "Dana", "asc")).toBeGreaterThan(0);
    expect(compareCardValues(null, "Dana", "desc")).toBeGreaterThan(0);
    expect(compareCardValues("Dana", null, "asc")).toBeLessThan(0);
    expect(compareCardValues("Dana", null, "desc")).toBeLessThan(0);
  });

  it("orders units the way a human reads them", () => {
    // Plain string ordering puts unit 10 before unit 9. A yard does not.
    expect(compareCardValues("9", "10", "asc")).toBeLessThan(0);
    expect(compareCardValues(9, 10, "asc")).toBeLessThan(0);
  });

  it("reverses on desc, and treats two blanks as equal", () => {
    expect(compareCardValues("Ann", "Bob", "asc")).toBeLessThan(0);
    expect(compareCardValues("Ann", "Bob", "desc")).toBeGreaterThan(0);
    expect(compareCardValues(null, "", "asc")).toBe(0);
  });
});
