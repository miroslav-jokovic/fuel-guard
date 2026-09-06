import { describe, it, expect } from "vitest";
import {
  FINDING_QUEUE_STATES,
  ANOMALY_QUEUE_STATE,
  EXCEPTION_QUEUE_STATE,
  anomalyStatusesIn,
  exceptionStatusesIn,
  closeOfAnomaly,
  closeOfException,
  type FindingQueueState,
} from "./findingQueue.js";
import { ANOMALY_STATUSES, ANOMALY_DISPOSITIONS } from "./constants.js";
import { FUEL_EXCEPTION_STATUSES } from "./fuelSpend/exceptions.js";

/**
 * C7a's verification, as §5 specifies it: the full cross-product of `ANOMALY_STATUSES` ×
 * `FUEL_EXCEPTION_STATUSES` over the axis, the round trip, the two mappings D-FUI7 names as wrong
 * asserted unrepresentable, and every `ANOMALY_DISPOSITIONS` value surviving the contract intact.
 */

describe("the shared queue axis", () => {
  it("places every status from both vocabularies, leaving nothing to a page's default", () => {
    for (const s of ANOMALY_STATUSES) expect(FINDING_QUEUE_STATES).toContain(ANOMALY_QUEUE_STATE[s]);
    for (const s of FUEL_EXCEPTION_STATUSES) expect(FINDING_QUEUE_STATES).toContain(EXCEPTION_QUEUE_STATE[s]);
  });

  // The round trip, both directions, over the whole cross-product.
  it("round-trips every status through its queue state and back", () => {
    for (const s of ANOMALY_STATUSES) expect(anomalyStatusesIn(ANOMALY_QUEUE_STATE[s])).toContain(s);
    for (const s of FUEL_EXCEPTION_STATUSES) expect(exceptionStatusesIn(EXCEPTION_QUEUE_STATE[s])).toContain(s);
  });

  it("partitions each vocabulary — every status in exactly one state, none in two", () => {
    const anomalies = FINDING_QUEUE_STATES.flatMap((s) => anomalyStatusesIn(s));
    const exceptions = FINDING_QUEUE_STATES.flatMap((s) => exceptionStatusesIn(s));
    expect([...anomalies].sort()).toEqual([...ANOMALY_STATUSES].sort());
    expect([...exceptions].sort()).toEqual([...FUEL_EXCEPTION_STATUSES].sort());
  });

  // `working` is the union of what the two models need, not the intersection. The anomaly model has
  // no vendor dispute, so it is empty there — empty, not wrong.
  it("gives the vendor-dispute state to exceptions only, and leaves it empty for anomalies", () => {
    expect(exceptionStatusesIn("working")).toEqual(["disputed"]);
    expect(anomalyStatusesIn("working")).toEqual([]);
  });

  it("treats all three of each vocabulary's closes as closed", () => {
    expect(anomalyStatusesIn("closed").sort()).toEqual(["dismissed", "resolved", "superseded"]);
    expect(exceptionStatusesIn("closed").sort()).toEqual(["credited", "dismissed", "resolved_by_reingest"]);
  });
});

describe("how a finding closed — the discriminated union D-FUI7 requires", () => {
  // The two mappings D-FUI7 names so nobody writes them. An anomaly resolved as `confirmed` is a TRUE
  // finding that recovered nothing: `resolved → credited` would invent money nobody collected, and
  // `resolved → dismissed` would delete a true positive from the precision figure.
  it("never lets an anomaly close with money, however it was resolved", () => {
    for (const status of ANOMALY_STATUSES) {
      for (const d of [...ANOMALY_DISPOSITIONS, null]) {
        const close = closeOfAnomaly(status, d);
        expect(close?.via).not.toBe("money");
      }
    }
  });

  it("never lets an exception close with a disposition, so no ground truth is invented for it", () => {
    for (const status of FUEL_EXCEPTION_STATUSES) {
      expect(closeOfException(status, 100)?.via).not.toBe("disposition");
    }
  });

  it("carries every disposition through the contract intact, inconclusive included", () => {
    for (const d of ANOMALY_DISPOSITIONS) {
      expect(closeOfAnomaly("resolved", d)).toEqual({ via: "disposition", disposition: d });
    }
  });

  // A `resolved` case nobody labelled has no ground truth, and `inconclusive` is the value the
  // vocabulary already defines as exactly that — excluded from precision. Inventing a fourth state
  // would put a row with no answer into the precision denominator.
  it("reads an unlabelled close as inconclusive rather than inventing a state", () => {
    expect(closeOfAnomaly("resolved", null)).toEqual({ via: "disposition", disposition: "inconclusive" });
  });

  // D-FUI7's one clean correspondence, and it gets its own arm precisely so it cannot be smuggled in
  // as a disposition or as a money outcome of zero: nobody decided anything.
  it("closes superseded and resolved_by_reingest the same way, as the one thing both models share", () => {
    expect(closeOfAnomaly("superseded", null)).toEqual({ via: "reingest" });
    expect(closeOfException("resolved_by_reingest", 500)).toEqual({ via: "reingest" });
  });

  it("carries the credited amount and refuses to carry a dismissed one", () => {
    expect(closeOfException("credited", 261.55)).toEqual({ via: "money", outcome: "credited", amountUsd: 261.55 });
    // E3: identified, claimed and recovered are three numbers, never one. A dismissed finding's face
    // value is not money, so the contract has nowhere to put it.
    expect(closeOfException("dismissed", 261.55)).toEqual({ via: "money", outcome: "dismissed", amountUsd: null });
  });

  // Binds the exhaustive switches to the maps, so the two ways of saying "closed" cannot drift.
  it("closes exactly the statuses the axis calls closed, in both vocabularies", () => {
    for (const s of ANOMALY_STATUSES) {
      expect(closeOfAnomaly(s, "confirmed") !== null).toBe(ANOMALY_QUEUE_STATE[s] === "closed");
    }
    for (const s of FUEL_EXCEPTION_STATUSES) {
      expect(closeOfException(s, 1) !== null).toBe(EXCEPTION_QUEUE_STATE[s] === "closed");
    }
  });

  it("has no close while a finding is still in the queue", () => {
    for (const state of ["open", "investigating", "working"] as FindingQueueState[]) {
      for (const s of anomalyStatusesIn(state)) expect(closeOfAnomaly(s, "confirmed")).toBeNull();
      for (const s of exceptionStatusesIn(state)) expect(closeOfException(s, 1)).toBeNull();
    }
  });
});
