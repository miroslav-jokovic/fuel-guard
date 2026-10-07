import { describe, expect, it } from "vitest";
import { cardLabel, SUMMARY_MAX_LINES, summarizeCardStatusChanges, type SummaryCardChange } from "./cardStatusSummary.js";

/**
 * The daily card status summary's words (Q-F3; F02-F04 PLAN.md chunk 3b).
 *
 * What can be wrong:
 *
 *  - A QUIET DAY SENDS A MESSAGE. No changes must be `null`, which the API reads as "send nothing".
 *  - THE COUNTS COUNT CHANGES, NOT CARDS. A card put on hold twice in a day is one card on hold.
 *  - THE CARD IS NAMED BY ITS LAST FOUR ALONE. 246 of 309 cards share their last four (AUDIT N7), so
 *    the truck and the driver come first whenever EFS knows them.
 *  - THE BELL BECOMES A REPORT. Past `SUMMARY_MAX_LINES` cards the list stops and says how many more.
 */
const change = (cardId: string, from: string, to: string, unit: string | null = null, driver: string | null = null): SummaryCardChange => ({
  cardId,
  from,
  to,
  unit,
  driver,
  last4: cardId.padStart(4, "0").slice(-4),
});

describe("the daily card status summary", () => {
  it("says nothing on a day with no changes", () => {
    expect(summarizeCardStatusChanges([])).toBeNull();
  });

  it("counts cards, not changes, in the owner's own sentence", () => {
    const changes = [
      change("1", "ACTIVE", "HOLD", "887"),
      change("1", "HOLD", "ACTIVE", "887"),
      change("1", "ACTIVE", "HOLD", "887"),
      change("2", "ACTIVE", "HOLD", "990"),
      change("3", "HOLD", "ACTIVE", "991"),
    ];
    expect(summarizeCardStatusChanges(changes)!.title).toBe("Yesterday 2 cards went on hold and 2 came back");
  });

  it("says one card in the singular, and names the other kinds of change", () => {
    expect(summarizeCardStatusChanges([change("1", "HOLD", "ACTIVE")])!.title).toBe("Yesterday 1 card came back");
    expect(summarizeCardStatusChanges([change("1", "ACTIVE", "INACTIVE"), change("2", "ACTIVE", "HOLD")])!.title).toBe(
      "Yesterday 1 card went on hold and 1 card changed in another way",
    );
  });

  it("lists one line per card, by truck, its states in order and in plain words", () => {
    const body = summarizeCardStatusChanges([
      change("2", "ACTIVE", "HOLD", "990", "TEST DRIVER ONE"),
      change("1", "ACTIVE", "HOLD", "887"),
      change("1", "HOLD", "ACTIVE", "887"),
      change("3", "ACTIVE", "FRAUD"),
    ])!.body;
    expect(body.split("\n")).toEqual([
      "Truck 887 · ••••0001: Active → On hold → Active",
      "Truck 990 · TEST DRIVER ONE · ••••0002: Active → On hold",
      "••••0003: Active → Fraud hold",
    ]);
  });

  it("sorts trucks as numbers, so 99 comes before 654", () => {
    const body = summarizeCardStatusChanges([change("1", "ACTIVE", "HOLD", "654"), change("2", "ACTIVE", "HOLD", "99")])!.body;
    expect(body.split("\n").map((l) => l.split(" ·")[0])).toEqual(["Truck 99", "Truck 654"]);
  });

  it("keeps a status it does not know as EFS spelled it", () => {
    expect(summarizeCardStatusChanges([change("1", "ACTIVE", "Suspended")])!.body).toContain("Active → Suspended");
  });

  it(`stops listing after ${SUMMARY_MAX_LINES} cards and says how many more`, () => {
    const many = Array.from({ length: SUMMARY_MAX_LINES + 3 }, (_, i) => change(String(i + 1), "ACTIVE", "HOLD", String(i + 1)));
    const lines = summarizeCardStatusChanges(many)!.body.split("\n");
    expect(lines).toHaveLength(SUMMARY_MAX_LINES + 1);
    expect(lines.at(-1)).toBe("and 3 more cards");
  });

  it("names two cards with the same last four apart by truck and driver", () => {
    const a = cardLabel({ unit: "887", driver: "ANA", last4: "1234" });
    const b = cardLabel({ unit: "990", driver: "BOB", last4: "1234" });
    expect(a).not.toBe(b);
    expect(cardLabel({ unit: null, driver: null, last4: null })).toBe("••••????");
  });
});
