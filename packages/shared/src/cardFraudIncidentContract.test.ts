import { describe, it, expect } from "vitest";
import { INCIDENT_ALLOWED_TRANSITIONS, isIncidentTransitionAllowed } from "./cardFraudIncidentContract.js";
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
