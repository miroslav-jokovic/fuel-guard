import { describe, expect, it } from "vitest";
import { matchStatusCasing } from "./efsCardCatalog.js";

/**
 * H1 (confirmed 2026-08-12, QA card ••••7671): EFS applies a status write ONLY when its casing
 * matches the account's stored vocabulary — `HOLD` landed in 533ms on an upper-case account,
 * `Active` was answered with the same void success and silently ignored. This helper is the fix;
 * these are its edges. The recipe-level and wire-level proofs live in efsCardEdits.test.ts and
 * efsCardControl.test.ts — this file pins the transform itself.
 */
describe("matchStatusCasing", () => {
  it("imitates an upper-case account", () => {
    expect(matchStatusCasing("ACTIVE", "Hold")).toBe("HOLD");
    expect(matchStatusCasing("HOLD", "Active")).toBe("ACTIVE");
    expect(matchStatusCasing("HOLD", "Inactive")).toBe("INACTIVE");
  });

  it("imitates a lower-case account", () => {
    expect(matchStatusCasing("active", "Hold")).toBe("hold");
    expect(matchStatusCasing("hold", "Active")).toBe("active");
  });

  it("passes the target through verbatim for a mixed-case account — the guide's own spelling", () => {
    expect(matchStatusCasing("Active", "Hold")).toBe("Hold");
    expect(matchStatusCasing("Hold", "Active")).toBe("Active");
  });

  it("passes the target through verbatim when there is nothing to imitate", () => {
    expect(matchStatusCasing(null, "Hold")).toBe("Hold");
    expect(matchStatusCasing(undefined, "Active")).toBe("Active");
    expect(matchStatusCasing("", "Hold")).toBe("Hold");
    expect(matchStatusCasing("   ", "Hold")).toBe("Hold");
    // A letterless observation (digits, punctuation) is upper- AND lower-case at once; neither
    // transform is evidence, so neither is applied.
    expect(matchStatusCasing("123", "Hold")).toBe("Hold");
  });

  it("trims before judging — vendor padding must not disable the imitation", () => {
    expect(matchStatusCasing(" ACTIVE ", "Hold")).toBe("HOLD");
  });
});
