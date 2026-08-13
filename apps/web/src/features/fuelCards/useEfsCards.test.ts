import { describe, expect, it } from "vitest";
import { EfsCardQueryError, shouldRetryEfsCardQuery } from "./useEfsCards.js";

describe("EFS card-detail query retries", () => {
  it("a 429 is not retried", () => {
    const error = new EfsCardQueryError(429, "rate_limited", "Too many requests just now — try again in a minute");

    expect(shouldRetryEfsCardQuery(0, error)).toBe(false);
    expect(error.message).toBe("Too many requests just now — try again in a minute");
  });
});
