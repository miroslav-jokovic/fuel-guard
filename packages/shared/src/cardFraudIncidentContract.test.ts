import { describe, it, expect } from "vitest";
import { INCIDENT_ALLOWED_TRANSITIONS, incidentStory, isIncidentTransitionAllowed } from "./cardFraudIncidentContract.js";
import { ANOMALY_ALLOWED_TRANSITIONS } from "./anomaly.js";
import { CARD_FRAUD_INCIDENT_STATUSES } from "./findingQueue.js";

describe("an incident's workflow (chunk 8c2), derived from a fill case's", () => {
  it("allows exactly what a fill case allows, between the statuses an incident has", () => {
    for (const s of CARD_FRAUD_INCIDENT_STATUSES) {
      expect(INCIDENT_ALLOWED_TRANSITIONS[s]).toEqual(
        ANOMALY_ALLOWED_TRANSITIONS[s].filter((t) => (CARD_FRAUD_INCIDENT_STATUSES as readonly string[]).includes(t)),
      );
    }
  });
  it("opens to investigate or close, closes from investigating, and reopens only to investigating", () => {
    expect(isIncidentTransitionAllowed("open", "dismissed")).toBe(true);
    expect(isIncidentTransitionAllowed("investigating", "resolved")).toBe(true);
    expect(isIncidentTransitionAllowed("resolved", "investigating")).toBe(true);
    expect(isIncidentTransitionAllowed("resolved", "dismissed")).toBe(false);
    expect(isIncidentTransitionAllowed("investigating", "open")).toBe(false);
  });
});

describe("an incident in plain sentences (chunk 8c3)", () => {
  const d = {
    id: "i", status: "open" as const, version: 1, disposition: null, resolutionNote: null, cardLast4: "7967", unitNumber: "555",
    openedAt: "2026-10-05T14:10:00Z", lastAttemptAt: "2026-10-05T16:00:00Z", level: "alert" as const, attemptCount: 3,
    fuelTaken: false, failedPrompts: [] as Array<"odometer" | "driver_id">,
    places: [{ city: "Jacksonville", state: "FL", attempts: 2, firstAt: "", lastAt: "" }, { city: "Baldwin", state: "FL", attempts: 1, firstAt: "", lastAt: "" }],
    lastTruck: { at: "2026-10-05T14:00:00Z", city: "Lake City", state: "FL", milesToStation: 59.6 },
    attempts: [],
  };
  it("names the card, every place, where the truck was, and whether fuel was taken", () => {
    expect(incidentStory(d)).toEqual([
      "Card ••••7967 was tried 3 times in Jacksonville, FL and Baldwin, FL.",
      "Samsara had truck 555 in Lake City, FL, 60 mi from the station.",
      "No fuel was taken.",
    ]);
  });
  it("says once, fuel taken, and each failed prompt; and nothing about the truck when Samsara had none", () => {
    expect(incidentStory({ ...d, attemptCount: 1, places: [d.places[0]!], lastTruck: null, fuelTaken: true, failedPrompts: ["odometer", "driver_id"] }))
      .toEqual(["Card ••••7967 was tried once in Jacksonville, FL.", "Fuel was taken.", "The odometer prompt failed.", "The driver ID prompt failed."]);
  });
});
