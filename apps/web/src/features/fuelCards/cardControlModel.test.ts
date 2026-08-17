import { describe, expect, it } from "vitest";
import { EFS_EDITABLE_INFO_IDS } from "@fuelguard/shared";
import type { CardCapabilities } from "@fuelguard/shared";
import {
  activeOverrides,
  availability,
  cardStatusLabel,
  cardAssignmentRank,
  cardStatusTone,
  compareCardValues,
  freshness,
  limitRows,
  autoRollClause,
  locationRows,
  outcomeNotice,
  overrideFreshness,
  payrollRows,
  overrideScopeLabel,
  relativeAge,
  promptRows,
  sourceSentence,
  timeRows,
} from "./cardControlModel.js";

// `availability()` answers from the ACCOUNT-level facts only, so the per-capability map is empty
// here on purpose rather than mirrored from `blockedBy` — a fixture that agreed with itself by
// construction would hide a reader that had started using the wrong one of the two.
const caps = (over: Partial<CardCapabilities> = {}): CardCapabilities => ({
  canLock: false, canUnlock: false, canDeactivate: false, canOverride: false, canSetPrompts: false,
  writeEntitlement: "unknown", blockedBy: null, capabilityStates: {}, environment: null,
  // Not read by `availability()` — it answers from account-level facts — but required by the type.
  editableInfoIds: EFS_EDITABLE_INFO_IDS,
  ...over,
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

  it("explains an endpoint change and tells an admin to re-run the connection check", () => {
    const notice = availability(caps({ blockedBy: "endpoint_changed", writeEntitlement: "confirmed" }), true);

    expect(notice).toMatchObject({
      mode: "disabled",
      message: "The EFS connection changed since this company was checked. An admin needs to re-run the connection check before card actions work again.",
      actionTo: "/settings/card-control",
    });
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

  it("names an idempotent replay rather than claiming a fresh outcome (audit P1-2)", () => {
    const notice = outcomeNotice({ status: "succeeded", idempotent: true }, "Card locked");
    expect(notice.title).toBe("Already done");
    expect(notice.message).toContain("earlier attempt");
  });

  it("never asserts 'not changed' for a status it does not recognise", () => {
    const notice = outcomeNotice({ status: "some_new_status" }, "Card locked");
    expect(notice.kind).toBe("warning");
    expect(notice.message).toMatch(/history/i);
    expect(notice.message).not.toMatch(/not changed/i);
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

describe("unassigned cards sink to the bottom", () => {
  const card = (over: Partial<{ driverName: string | null; driverIdPrompt: string | null; unitPrompt: string | null }> = {}) =>
    ({ driverName: null, driverIdPrompt: null, unitPrompt: null, ...over });

  it("counts a card with ANY of driver, driver id or unit as assigned", () => {
    expect(cardAssignmentRank(card({ driverName: "Dana" }))).toBe(0);
    expect(cardAssignmentRank(card({ driverIdPrompt: "8311" }))).toBe(0);
    expect(cardAssignmentRank(card({ unitPrompt: "711" }))).toBe(0);
  });

  it("counts nothing, and whitespace, as unassigned", () => {
    expect(cardAssignmentRank(card())).toBe(1);
    expect(cardAssignmentRank(card({ driverName: "   ", unitPrompt: "" }))).toBe(1);
  });

  it("ignores the fuel_cards link", () => {
    // 17 of this account's cards are unlinked purely because two physical cards share a last four.
    // That is FuelGuard's own attribution guess failing, and says nothing about whether a driver is
    // using the card — sinking those would hide working cards.
    expect(cardAssignmentRank(card({ driverIdPrompt: "0225" }))).toBe(0);
  });
});

describe("account-wide overrides (B3)", () => {
  const card = (over: Partial<Parameters<typeof activeOverrides>[0][number]> = {}) => ({
    id: "c1", maskedRef: "•••• 7671", last4: "7671", driverName: null, unitPrompt: null,
    status: "ACTIVE", overrideUses: null, overrideAllLocations: null, locationOverrideId: null,
    ...over,
  });

  it("lists only cards with uses remaining — zero and null are not exceptions", () => {
    const rows = activeOverrides([
      card({ id: "a", last4: "1111", overrideUses: 2, overrideAllLocations: true }),
      card({ id: "b", last4: "2222", overrideUses: 0, overrideAllLocations: true }), // spent
      card({ id: "c", last4: "3333" }), // never had one
      // Scope residue with no uses left is configuration noise, not free fuel (p194: 0 = none left).
      card({ id: "d", last4: "4444", overrideUses: 0, locationOverrideId: "442013" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
    expect(rows[0]).toMatchObject({ uses: 2, scopeLabel: "Any location" });
  });

  it("orders by card number — the same order as the inventory below the panel", () => {
    const rows = activeOverrides([
      card({ id: "high", last4: "9020", overrideUses: 1, overrideAllLocations: true }),
      card({ id: "low", last4: "0114", overrideUses: 3, overrideAllLocations: true }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["low", "high"]);
  });

  it("says WHERE the exception applies, and prefers the location id when both scopes are armed", () => {
    expect(overrideScopeLabel(false, "442013")).toBe("Location #442013");
    expect(overrideScopeLabel(true, null)).toBe("Any location");
    // The conflicting state a WEX-portal edit can leave behind. The pump honours the id (see
    // overrideGrantEdits' docblock) — claiming "any location" here is the lie that strands a driver.
    expect(overrideScopeLabel(true, "442013")).toBe("Location #442013");
    // Uses remain but neither scope is armed: reported honestly, never guessed.
    expect(overrideScopeLabel(null, null)).toBe("Scope not reported");
    expect(overrideScopeLabel(false, null)).toBe("Scope not reported");
  });
});

describe("override staleness (Step 7.8)", () => {
  /**
   * The incident, in one fixture (`docs/22` H4). Production card ••••7550 / unit 651 showed
   * "Override: 1 use left" for NINE HOURS after EFS had retired it: the exception was consumed 38
   * minutes after the sync that recorded it, and nothing re-read the card until a manual refresh.
   *
   * A stale `status` is tolerable; the card page is not the authority on whether a card is locked.
   * A stale override count is the number that says whether a driver can take another free tank, and
   * it decrements without us.
   */
  const NOW = new Date("2026-08-15T02:02:00.000Z");
  const CYCLE = 26 * 60; // EFS_CARD_SYNC_HOURS 24, plus the two-hour grace the API sends

  it("says how old the read is, on a row that is NOT stale — which is the nine-hour case", () => {
    // 2026-08-14 17:12Z, the sync that recorded `override_uses = 1`. Nine hours old: well inside a
    // 26-hour cycle, so nothing here was "stale" by the page's own threshold. The fix is not a
    // louder warning — it is that the age is on screen at all.
    const state = overrideFreshness({ detailSyncedAt: "2026-08-14T17:12:00.000Z" }, NOW, CYCLE);

    expect(state.known).toBe(true);
    expect(state.stale).toBe(false);
    expect(state.ageText).toBe("read 8 hours ago");
  });

  it("stops asserting the count once the read is older than a sync cycle", () => {
    const state = overrideFreshness({ detailSyncedAt: "2026-08-12T02:02:00.000Z" }, NOW, CYCLE);

    expect(state.known).toBe(false);
    expect(state.stale).toBe(true);
    expect(state.ageText).toBe("read 3 days ago");
  });

  it("distinguishes a card nothing has ever read from a card read too long ago", () => {
    // Different sentences because they send somebody to different places: one needs a refresh, the
    // other needs the sweep looked at. Collapsing them into "stale" loses the actionable half — and
    // the never-read case is also what Step 7.5's `card_never_read` refuses a write against.
    const never = overrideFreshness({ detailSyncedAt: null }, NOW, CYCLE);

    expect(never.neverRead).toBe(true);
    expect(never.known).toBe(false);
    expect(never.ageText).toBe("never read from EFS");
    expect(overrideFreshness({ detailSyncedAt: "2026-08-12T02:02:00.000Z" }, NOW, CYCLE).neverRead).toBe(false);
  });

  it("hangs off the DETAIL clock, not the roster clock the page shows above it", () => {
    /**
     * `synced_at` moves on every sweep because the roster pass touches every row; `detail_synced_at`
     * moves only when the card's document was re-read. The override SCOPE — any location, or one
     * truck stop — has no writer but the detail pass, so the override statement as a whole is only
     * ever as fresh as this. Feeding the roster clock in here would report a fresh page over a
     * document from last week.
     */
    // Bound to a variable rather than cast: TypeScript's excess-property check only fires on a fresh
    // object literal, so this passes BOTH clocks in with no `as` anywhere — which is the point, since
    // a cast here would be hiding the very shape the case is about.
    const row = { detailSyncedAt: "2026-08-01T02:02:00.000Z", syncedAt: NOW.toISOString() };
    const state = overrideFreshness(row, NOW, CYCLE);

    expect(state.known).toBe(false);
  });

  it("annotates a stale exception instead of dropping it from the account-wide panel", () => {
    // "We last read this two days ago" is not the same answer as "no". Filtering stale rows out
    // would make the panel quietest exactly when the mirror is worst — the opposite of what an
    // auditor asking "who can currently buy outside their limits" needs from it.
    const rows = activeOverrides(
      [{
        id: "a", maskedRef: "•••• 7550", last4: "7550", driverName: null, unitPrompt: "651",
        status: "ACTIVE", overrideUses: 1, overrideAllLocations: true, locationOverrideId: null,
        detailSyncedAt: "2026-08-12T02:02:00.000Z",
      }],
      NOW,
      CYCLE,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.uses).toBe(1); // the LAST KNOWN count is still the row's identity
    expect(rows[0]!.freshness.known).toBe(false); // …and the panel must not assert it
  });
});

describe("relativeAge", () => {
  const NOW = new Date("2026-08-15T12:00:00.000Z");

  it("is the ONE age formatter — freshness() reads the same words back", () => {
    // The two used to be one implementation. Extracting it is what stops the card page saying
    // "Checked 9 hours ago" in one line and "read 9 hrs ago" in the next.
    const at = "2026-08-15T03:00:00.000Z";
    expect(relativeAge(at, NOW)).toBe("9 hours ago");
    expect(freshness(at, NOW, 26 * 60).text).toBe("Checked 9 hours ago.");
  });

  it("has no clock to report for a missing or unparseable timestamp", () => {
    // Null rather than a guess: "we have no clock for this" is a different sentence on the card page
    // ("Never checked.") than on the override badge ("never read from EFS"), so the caller decides.
    expect(relativeAge(null, NOW)).toBeNull();
    expect(relativeAge(undefined, NOW)).toBeNull();
    expect(relativeAge("not a date", NOW)).toBeNull();
  });

  it("does not report a negative age for a clock that is ahead", () => {
    expect(relativeAge("2026-08-15T12:05:00.000Z", NOW)).toBe("just now");
  });
});

describe("the parity gate (Step 7.4) — every parsed field is reachable by exactly one row", () => {
  /**
   * Step 7.4's Verify, in its own words: *"feed the scan JSON into the pure renderers and assert
   * every observed field is reachable by exactly one row and no row renders `undefined` or `—`.
   * This is the parity gate — mechanical, not eyeballed."*
   *
   * ── The one substitution I had to make, said out loud ────────────────────────────────────────
   * The scan JSON comes from Step 7.6, which needs a live account. So the input here is a card
   * document built from the FIELDS THE WSDL DECLARES, every one populated. That is the same
   * substitution Step 7.3 makes and it has the same shape of limitation: it proves no DECLARED field
   * is dropped between the parser and the screen, and it cannot prove anything about a field
   * production sends undeclared. When `docs/25` exists, this fixture should be replaced by it.
   */
  const merged = <T>(value: T) => ({ value, origin: "card" as const });

  it("renders every prompt field, with no placeholder standing in for a value that exists", () => {
    const rows = promptRows([
      merged({ infoId: "UNIT", validationType: "EXACT_MATCH", matchValue: "3182", reportValue: null }),
      merged({ infoId: "DRID", validationType: "REPORT_ONLY", matchValue: null, reportValue: "D-4471" }),
    ]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.detail, `${row.label} rendered a placeholder`).not.toMatch(/undefined|^—$/);
      expect(row.label).not.toBe("");
    }
    expect(rows[0]!.detail).toContain("3182");
    expect(rows[1]!.detail).toContain("D-4471");
  });

  it("renders auto-roll, which the API has always sent and nothing displayed", () => {
    const [row] = limitRows([merged({
      limitId: "ULSD", limit: 500, hours: 24, minHours: null, autoRollMap: 100, autoRollMax: 3,
    })]);
    expect(row!.detail).toContain("auto-roll 100");
    expect(row!.detail).toContain("daily max 3");
  });

  it("says `autoRollMax = 0` means NO DAILY MAXIMUM, never the number zero", () => {
    /**
     * The trap this clause exists for (guide p138). "Daily max 0" reads as a card that can buy
     * nothing — the safest-sounding wrong answer, and the one an operator acts on by raising a limit
     * that was never set.
     */
    const [row] = limitRows([merged({
      limitId: "ULSD", limit: 500, hours: null, minHours: null, autoRollMap: 100, autoRollMax: 0,
    })]);
    expect(row!.detail).toContain("no daily maximum");
    expect(row!.detail).not.toMatch(/daily max 0/);
  });

  it("says nothing about auto-roll when EFS reported neither field", () => {
    // Null is "EFS did not report it", which is different from zero and must not be rendered as one.
    const [row] = limitRows([merged({ limitId: "ULSD", limit: 500, hours: null, minHours: null })]);
    expect(row!.detail).not.toContain("auto-roll");
    expect(row!.detail).not.toContain("daily max");
    expect(autoRollClause({ limitId: "X", limit: 1, hours: null, minHours: null })).toBe("");
  });

  it("caps a fleet-sized blocklist and SAYS how many it hid", () => {
    /**
     * Measured, not hypothetical: the production inventory found **7,948 blocked locations on policy
     * 1**. The first version of this renderer had no cap, so a card carrying that list would have put
     * eight thousand rows into the card page's table.
     *
     * The count is the fact worth having. A table that quietly showed 25 of 7,948 would read as
     * "this card is blocked from 25 places", which is the silent-truncation failure the plan's own
     * "no silent caps" rule exists for.
     */
    const many = Array.from({ length: 7948 }, (_, i) => String(500000 + i));
    const rows = locationRows([], many);

    expect(rows.length).toBeLessThan(30);
    const last = rows.at(-1)!;
    expect(last.label).toContain("7,923 more");
    expect(last.detail).toContain("7,948");
  });

  it("does not add a summary row when everything fits", () => {
    // The positive control. A "+0 more" row on every card is noise that trains people to skip the
    // one time the number matters.
    const rows = locationRows(["41"], ["442013", "442014"]);
    expect(rows.map((r) => r.key)).not.toContain("blk-more");
  });

  it("keeps the blocklist and the allowlist apart, because they mean opposite things", () => {
    // `locations` is "a list of locations that this card is BLOCKED from using" (p36). One table
    // labelled "Locations" would be read as "where this card works" and be wrong for half its rows.
    const rows = locationRows(["41"], ["442013"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.detail).toMatch(/may fuel/i);
    expect(rows[1]!.detail).toMatch(/BLOCKED/);
    for (const row of rows) expect(row.detail).not.toMatch(/undefined|^—$/);
  });

  it("shows only the payroll capabilities EFS actually reported", () => {
    // A null is "EFS said nothing", NOT "not allowed" — rendering it as a denial would be a
    // confident wrong answer about whether a card can draw cash.
    const rows = payrollRows({
      status: "ACTIVE", use: "BOTH", atm: "ALLOW", check: null, ach: null, wire: null, debit: "DISALLOW",
    });
    expect(rows.map((r) => r.label)).toEqual(["Payroll status", "Payroll use", "ATM cash", "Debit"]);
    for (const row of rows) expect(row.detail).not.toMatch(/undefined|^—$/);
  });

  it("renders NO rows at all when EFS reported no payroll capability", () => {
    // The positive control: an empty table with its own sentence beats seven rows of "—".
    expect(payrollRows({
      status: null, use: null, atm: null, check: null, ach: null, wire: null, debit: null,
    })).toEqual([]);
  });

  it("names all FOUR sources, including the one the payload used to drop", () => {
    // `locationSource` was parsed, stored and selected — and the payload carried three of four, so
    // the page could say where prompts, limits and time rules came from and not location rules.
    for (const source of ["CARD", "POLICY", "BOTH"]) {
      expect(sourceSentence("Location rules", source, 14)).not.toMatch(/not reported/);
    }
    expect(sourceSentence("Location rules", null, 14)).toMatch(/not reported/);
  });
});
