import { describe, it, expect } from "vitest";
import {
  applyFraudAttempt,
  cardFraudKey,
  describeFraudIncident,
  failedPromptOf,
  foldFraudAttempts,
  type FraudAttempt,
} from "./cardFraud.js";
import { classifyDeclineReason } from "./declineReason.js";

// The 13 declines that kept `location_mismatch` over 2026-09-02..10-02 — every one of them, verbatim
// from production (CARD-FRAUD-ALERTS-PLAN.md §1). Card numbers are padded to a full PAN shape so they
// key as full cards, as the real rows do.
const rows: Array<[string, string, string, string, string, string]> = [
  ["2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", "INVALID TRUCKSTOP|Merchant Position Too Far|"],
  ["2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", "INVALID TRUCKSTOP|Failed restrictions|"],
  ["2026-09-11T21:04:00Z", "07967", "555", "JACKSONVILLE", "FL", "INACTIVE CARD|Non-Active Card|"],
  ["2026-10-01T22:50:00Z", "07967", "555", "JACKSONVILLE", "FL", "INACTIVE CARD IN0535688009|Non-Active Card|"],
  ["2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", "INVALID INFORMATION|ODOMETER|171662 IN0851404194||"],
  ["2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", "INVALID INFORMATION|ODOMETER|171662 IN0851404457||"],
  ["2026-09-23T00:16:00Z", "27564", "729", "SOUTH BEND", "IN", "INACTIVE CARD IN0851565240|Non-Active Card|"],
  ["2026-09-27T12:46:00Z", "27564", "729", "SOUTH BEND", "IN", "INACTIVE CARD IN0854141423|Non-Active Card|"],
  ["2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460568||"],
  ["2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460506||"],
  ["2026-09-26T22:42:00Z", "37977", "799", "FRANKLIN", "KY", "INACTIVE CARD IN0532837915|Non-Active Card|"],
  ["2026-09-22T20:45:00Z", "77960", "739", "WAYLAND", "MO", "INACTIVE CARD IN0845001699|Non-Active Card|"],
  ["2026-09-23T13:36:00Z", "87149", "735", "HARRISONBURG", "VA", "INACTIVE CARD|Non-Active Card|"],
];
const card = (tail: string) => `70830500307${tail}`;
const production: FraudAttempt[] = rows.map(([at, tail, unit, city, state, desc], i) => ({
  id: `d${String(i).padStart(2, "0")}`,
  source: "decline",
  at,
  cardRef: card(tail),
  vehicleId: `veh-${unit}`,
  unit,
  city,
  state,
  reason: classifyDeclineReason(null, desc).category,
  failedPrompt: failedPromptOf(desc),
  truck: null,
}));

describe("failedPromptOf — the EFS pump prompt an invalid-info decline failed", () => {
  it("reads the prompt from the description's second field, ignoring the trailing reference", () => {
    expect(failedPromptOf("INVALID INFORMATION|ODOMETER|171662 IN0851404194||")).toBe("odometer");
    expect(failedPromptOf("INVALID INFORMATION|ODOMETER IN0828164576|")).toBe("odometer");
    expect(failedPromptOf("INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460568||")).toBe("driver_id");
    expect(failedPromptOf("INVALID INFORMATION|UNIT NUMBER|")).toBe("unit_number");
  });
  it("is null for anything that is not a prompt we can name", () => {
    expect(failedPromptOf("INACTIVE CARD|Non-Active Card|")).toBeNull();
    expect(failedPromptOf(null)).toBeNull();
  });
});

describe("foldFraudAttempts — the 13 production attempts", () => {
  const incidents = foldFraudAttempts(production);
  const of = (tail: string) => incidents.filter((i) => i.cardRef === card(tail));

  it("become 7 incidents on 5 cards, not 13 alerts", () => {
    expect(incidents).toHaveLength(7);
    expect(new Set(incidents.map((i) => i.cardRef)).size).toBe(5);
  });

  it("…27564 South Bend: one incident for 09-22/23 that names the failed odometer prompt, and a new one on 09-27, 4.5 days later", () => {
    const [first, second] = of("27564");
    expect(first!.attemptIds).toEqual(["d04", "d05", "d06"]);
    expect(first!.failedPrompts).toEqual(["odometer"]);
    // The second 19:24 attempt is more of the same; 00:16 is the first try on a card already turned off.
    expect(first!.steps.map((s) => s.step)).toEqual(["opened", "inactive_card"]);
    expect(second!.attemptIds).toEqual(["d07"]);
    expect(second!.steps.map((s) => s.step)).toEqual(["opened"]);
  });

  it("…37977 Franklin: the driver-ID failure opens it, and the return 19 hours later interrupts again", () => {
    const [only] = of("37977");
    expect(of("37977")).toHaveLength(1);
    expect(only!.failedPrompts).toEqual(["driver_id"]);
    expect(only!.steps.map((s) => s.step)).toEqual(["opened", "returned"]);
    expect(only!.places).toEqual([{ city: "FRANKLIN", state: "KY", attempts: 3, firstAt: "2026-09-26T03:47:00Z", lastAt: "2026-09-26T22:42:00Z" }]);
  });

  it("…07967 Jacksonville: back eleven hours later is a return; back twenty days later is a new incident", () => {
    const [sept, oct] = of("07967");
    expect(sept!.steps.map((s) => s.step)).toEqual(["opened", "returned"]);
    expect(oct!.openedAt).toBe("2026-10-01T22:50:00Z");
  });

  it("is the same whatever order the history arrives in", () => {
    const shuffled = [...production].reverse();
    expect(foldFraudAttempts(shuffled)).toEqual(incidents);
  });
});

describe("applyFraudAttempt — the reducer the live scorer calls", () => {
  const a = (o: Partial<FraudAttempt>): FraudAttempt => ({ ...production[4]!, ...o });

  it("a re-scored attempt is a no-op, never a second message", () => {
    const { incident } = applyFraudAttempt(null, a({}));
    const again = applyFraudAttempt(incident, a({}));
    expect(again).toEqual({ incident, step: null, duplicate: true });
  });

  it("a new place outranks every other step, and one attempt takes one step only", () => {
    const { incident } = applyFraudAttempt(null, a({ failedPrompt: null }));
    const r = applyFraudAttempt(incident, a({ id: "x", at: "2026-09-22T21:00:00Z", city: "ELKHART", failedPrompt: "odometer", reason: "card_not_active" }));
    expect(r.step).toBe("new_place");
    expect(r.incident.steps).toHaveLength(2);
  });

  it("fuel leaving the pump is its own step, above a new place", () => {
    const { incident } = applyFraudAttempt(null, a({}));
    const r = applyFraudAttempt(incident, a({ id: "f", source: "fill", reason: null, at: "2026-09-22T22:00:00Z", city: "ELKHART" }));
    expect(r.step).toBe("fuel_taken");
    expect(r.incident.fuelTaken).toBe(true);
  });

  it("the join window is inclusive at 72 hours and opens a new incident one minute past it", () => {
    const { incident } = applyFraudAttempt(null, a({}));
    expect(applyFraudAttempt(incident, a({ id: "y", at: "2026-09-25T19:24:00Z" })).incident.key).toBe(incident.key);
    expect(applyFraudAttempt(incident, a({ id: "z", at: "2026-09-25T19:25:00Z" })).incident.key).not.toBe(incident.key);
  });

  it("a return needs the full six hours at that place", () => {
    const { incident } = applyFraudAttempt(null, a({ failedPrompt: null, reason: "card_not_active" }));
    expect(applyFraudAttempt(incident, a({ id: "r1", at: "2026-09-23T01:23:00Z", failedPrompt: null, reason: "card_not_active" })).step).toBeNull();
    expect(applyFraudAttempt(incident, a({ id: "r2", at: "2026-09-23T01:24:00Z", failedPrompt: null, reason: "card_not_active" })).step).toBe("returned");
  });

  it("a closed incident is never joined", () => {
    const { incident } = applyFraudAttempt(null, a({}));
    const r = applyFraudAttempt({ ...incident, closed: true }, a({ id: "n", at: "2026-09-22T20:00:00Z" }));
    expect(r.step).toBe("opened");
    expect(r.incident.key).not.toBe(incident.key);
  });

  it("history arriving late joins but interrupts nobody", () => {
    const { incident } = applyFraudAttempt(null, a({ at: "2026-09-23T00:16:00Z" }));
    const r = applyFraudAttempt(incident, a({ id: "old", at: "2026-09-22T10:00:00Z", city: "ELKHART" }));
    expect(r.step).toBeNull();
    expect(r.incident.lastAttemptAt).toBe("2026-09-23T00:16:00Z");
    expect(r.incident.attemptIds).toContain("old");
  });
});

describe("cardFraudKey", () => {
  it("a full card number is the card; a masked ref only counts together with its truck", () => {
    expect(cardFraudKey(card("27564"), "veh-729")).toBe(card("27564"));
    expect(cardFraudKey("XXXXXXXXXXXX7564", "veh-729")).not.toBe(cardFraudKey("XXXXXXXXXXXX7564", "veh-730"));
  });
});

describe("describeFraudIncident — the words a person reads", () => {
  it("South Bend reads as what happened, where the truck was, and which prompt failed", () => {
    const [first] = foldFraudAttempts(production).filter((i) => i.cardRef === card("27564"));
    const withTruck = { ...first!, lastTruck: { at: "2026-09-23T00:10:00Z", city: "Memphis", state: "TN", milesToStation: 495.5 } };
    const { title, body } = describeFraudIncident(withTruck, "America/Chicago");
    expect(title).toBe("Card …27564 used away from its truck");
    expect(body).toBe(
      "Card …27564 was tried 3 times in South Bend, IN, where truck 729 was not. " +
        "Samsara had truck 729 in Memphis, TN at 09/22/2026 7:10 PM, 496 mi away. It failed the odometer prompt.",
    );
    expect(body.length).toBeLessThan(300);
  });

  it("says fuel was bought when an attempt was approved, and leaves out what was not measured", () => {
    const { incident } = applyFraudAttempt(null, { ...production[12]!, source: "fill", reason: null });
    const { title, body } = describeFraudIncident(incident, "America/Chicago");
    expect(title).toBe("Fuel bought on card …87149 away from its truck");
    expect(body).toBe("Card …87149 bought fuel in Harrisonburg, VA while truck 735 was elsewhere.");
  });
});
