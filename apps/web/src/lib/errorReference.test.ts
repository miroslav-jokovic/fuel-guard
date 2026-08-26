import { describe, it, expect } from "vitest";
import { errorReference } from "./errorReference";

const AT = "2026-08-25T23:04:20.921Z";

describe("errorReference (Q-UI1)", () => {
  it("quotes when and where, which are the two facts always available", () => {
    expect(errorReference({ at: AT, path: "/fuel-spend", eventId: null })).toBe(
      "2026-08-25T23:04:20.921Z  ·  /fuel-spend",
    );
  });

  it("adds the Sentry id when there genuinely is one", () => {
    expect(errorReference({ at: AT, path: "/idling", eventId: "abc123" })).toBe(
      "2026-08-25T23:04:20.921Z  ·  /idling  ·  abc123",
    );
  });

  it("omits a missing path rather than leaving a dangling separator", () => {
    expect(errorReference({ at: AT, path: null, eventId: null })).toBe(AT);
    expect(errorReference({ at: AT, eventId: "e1" })).toBe(`${AT}  ·  e1`);
  });

  it("never invents an id: an explicit null stays absent", () => {
    // The measured trap this exists for — captureException() returns a real-looking id even with no
    // client, so the reference must come from lastEventId() behind a getClient() gate, never from
    // the return value of a capture call.
    const ref = errorReference({ at: AT, path: "/x", eventId: null });
    expect(ref).not.toMatch(/[0-9a-f]{32}/);
  });

  it("falls back to the live Sentry lookup when no override is given", () => {
    // No Sentry.init in the test environment, so getClient() is undefined and the id is absent.
    // This is the same code path a preview build takes.
    expect(errorReference({ at: AT, path: "/x" })).toBe(`${AT}  ·  /x`);
  });
});
