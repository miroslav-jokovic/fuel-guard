import { describe, expect, it } from "vitest";
import { isNoSuchObject } from "./recordedGone.js";

describe("what counts as Meta saying an object does not exist (Q-AD35)", () => {
  it("only code 100 with subcode 33: code 100 alone is any bad request, and subcode 33 under another code is not this refusal", () => {
    expect(isNoSuchObject({ code: 100, subcode: 33 })).toBe(true);
    expect(isNoSuchObject({ code: 100, subcode: null })).toBe(false);
    expect(isNoSuchObject({ code: 100, subcode: 1487 })).toBe(false);
    expect(isNoSuchObject({ code: 190, subcode: 33 })).toBe(false);
    expect(isNoSuchObject({ code: null, subcode: null })).toBe(false);
  });
});
