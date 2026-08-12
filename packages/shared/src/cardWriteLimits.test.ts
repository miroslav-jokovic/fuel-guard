import { describe, expect, it } from "vitest";
import {
  CARD_OVERRIDE_STEP_UP_ABOVE_USES,
  CARD_WRITE_BUCKETS,
  CARD_WRITE_LIMITS,
  cardWriteBucket,
} from "./cardWriteLimits.js";

/**
 * The limiter's route table is matched on pathnames, which means it can silently stop covering a
 * route that gets renamed. These cases ARE the coupling: if `routes/fuelCards/control.ts` moves a
 * path, one of them goes red rather than a spend control quietly switching itself off.
 */

describe("cardWriteBucket", () => {
  const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

  it.each([
    ["POST", `/api/fuel-cards/${id}/lock`, "card_status"],
    ["POST", `/api/fuel-cards/${id}/unlock`, "card_status"],
    ["POST", `/api/fuel-cards/${id}/override`, "card_override"],
    ["DELETE", `/api/fuel-cards/${id}/override`, "card_override"],
    ["POST", `/api/fuel-cards/${id}/prompts`, "card_prompts"],
  ])("%s %s → %s", (method, path, bucket) => {
    expect(cardWriteBucket(method, path)).toBe(bucket);
  });

  it("meters grant and clear in the SAME bucket", () => {
    // Alternating grant/clear would otherwise get twice the budget of either one alone.
    expect(cardWriteBucket("POST", `/api/fuel-cards/${id}/override`))
      .toBe(cardWriteBucket("DELETE", `/api/fuel-cards/${id}/override`));
  });

  it("ignores reads entirely", () => {
    expect(cardWriteBucket("GET", "/api/fuel-cards")).toBeNull();
    expect(cardWriteBucket("GET", `/api/fuel-cards/${id}`)).toBeNull();
    expect(cardWriteBucket("GET", `/api/fuel-cards/${id}/history`)).toBeNull();
    // A refresh is a read of the vendor, not a write of the card.
    expect(cardWriteBucket("POST", `/api/fuel-cards/${id}/refresh`)).toBeNull();
  });

  it("cannot be slipped past with a query string or doubled slashes", () => {
    expect(cardWriteBucket("POST", `/api/fuel-cards/${id}/lock?x=1`)).toBe("card_status");
    expect(cardWriteBucket("POST", `//api//fuel-cards//${id}//lock`)).toBe("card_status");
  });
});

describe("the numbers", () => {
  it("keeps overrides tighter than status changes in both dimensions", () => {
    // An override is the only action here that hands out fuel. If this ever inverts, somebody has
    // made overrides cheaper than locking a stolen card.
    expect(CARD_WRITE_LIMITS.card_override.perMinute).toBeLessThan(CARD_WRITE_LIMITS.card_status.perMinute);
    expect(CARD_WRITE_LIMITS.card_override.perDay).toBeLessThan(CARD_WRITE_LIMITS.card_status.perDay);
  });

  it("fails CLOSED for the two buckets that can cost money or blind the pump", () => {
    expect(CARD_WRITE_LIMITS.card_override.onCounterFailure).toBe("closed");
    expect(CARD_WRITE_LIMITS.card_prompts.onCounterFailure).toBe("closed");
    // Status stays open: locking a card is the safe direction and a 2am theft response must not be
    // blocked by a bookkeeping table being down.
    expect(CARD_WRITE_LIMITS.card_status.onCounterFailure).toBe("open");
  });

  it("defines a limit for every bucket", () => {
    for (const bucket of CARD_WRITE_BUCKETS) {
      expect(CARD_WRITE_LIMITS[bucket].perMinute).toBeGreaterThan(0);
      expect(CARD_WRITE_LIMITS[bucket].perDay).toBeGreaterThanOrEqual(CARD_WRITE_LIMITS[bucket].perMinute);
      expect(CARD_WRITE_LIMITS[bucket].label).not.toBe("");
    }
  });

  it("puts the step-up threshold inside the vendor's 1–9 range", () => {
    expect(CARD_OVERRIDE_STEP_UP_ABOVE_USES).toBeGreaterThanOrEqual(1);
    expect(CARD_OVERRIDE_STEP_UP_ABOVE_USES).toBeLessThan(9);
  });
});

describe("case-insensitive matching (audit P1-5)", () => {
  it("buckets /API/FUEL-CARDS/... exactly like the lowercase spelling", () => {
    // Express routes case-insensitively by default, so this spelling REACHES the handler; a
    // null here meant "no bucket, allow" — the caps silently skipped for anyone who typed /API/.
    expect(cardWriteBucket("POST", "/API/Fuel-Cards/abc-123/Override")).toBe("card_override");
    expect(cardWriteBucket("POST", "/API/FUEL-CARDS/abc-123/LOCK")).toBe("card_status");
    expect(cardWriteBucket("DELETE", "/Api/Fuel-Cards/abc-123/Override")).toBe("card_override");
  });
});
