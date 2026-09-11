import { describe, expect, it } from "vitest";
import {
  APPLICATION_REVIEW_STATES,
  applicationAwaitsSignature,
  applicationEditSchema,
  applicationIsEditable,
  applicationPathSchema,
  applicationReviewState,
} from "./applicationReviewContract.js";

/**
 * Where an application has got to, read from its phase timestamps (F4).
 *
 * ⚠ The assertion worth having is the LAST one: a certified application has every earlier stamp set
 * too, so a reading that walks forwards answers "awaiting review" for a document that was filed a
 * week ago. That is the classic shape of this bug and it is why the function reads in reverse.
 */

const phases = (over: Partial<Parameters<typeof applicationReviewState>[0]> = {}) => ({
  reviewRequestedAt: null,
  approvedAt: null,
  submittedAt: null,
  ...over,
});

describe("where an application has got to", () => {
  it("is still being filled in until the driver sends it", () => {
    expect(applicationReviewState(phases())).toBe("filling");
  });

  it("waits for the office once the driver has sent it", () => {
    expect(applicationReviewState(phases({ reviewRequestedAt: "2026-09-11T10:00:00Z" }))).toBe("awaiting_review");
  });

  it("goes back to the driver once the office approves", () => {
    expect(applicationReviewState(phases({
      reviewRequestedAt: "2026-09-11T10:00:00Z",
      approvedAt: "2026-09-11T12:00:00Z",
    }))).toBe("approved");
  });

  it("reads the LAST thing that happened, not the first", () => {
    // Every earlier stamp is still set on a filed application. A forward reading calls this
    // "awaiting review" and puts a signed document back in the office's queue.
    expect(applicationReviewState({
      reviewRequestedAt: "2026-09-11T10:00:00Z",
      approvedAt: "2026-09-11T12:00:00Z",
      submittedAt: "2026-09-11T13:00:00Z",
    })).toBe("certified");
  });

  it("covers every state it declares", () => {
    const reached = new Set([
      applicationReviewState(phases()),
      applicationReviewState(phases({ reviewRequestedAt: "x" })),
      applicationReviewState(phases({ reviewRequestedAt: "x", approvedAt: "y" })),
      applicationReviewState(phases({ reviewRequestedAt: "x", approvedAt: "y", submittedAt: "z" })),
    ]);
    expect([...reached].sort()).toEqual([...APPLICATION_REVIEW_STATES].sort());
  });
});

describe("who may do what, and when", () => {
  it("lets the office edit only between the driver sending and the driver signing", () => {
    expect(applicationIsEditable(phases())).toBe(false);
    expect(applicationIsEditable(phases({ reviewRequestedAt: "x" }))).toBe(true);
    // ⚠ Not after approval: the driver has been told to sign THAT document, and an answer changing
    // underneath them between being asked and signing is the one thing this whole flow exists to stop.
    expect(applicationIsEditable(phases({ reviewRequestedAt: "x", approvedAt: "y" }))).toBe(false);
    expect(applicationIsEditable(phases({ reviewRequestedAt: "x", approvedAt: "y", submittedAt: "z" }))).toBe(false);
  });

  it("lets the driver certify only once it is approved and not already filed", () => {
    expect(applicationAwaitsSignature(phases({ reviewRequestedAt: "x" }))).toBe(false);
    expect(applicationAwaitsSignature(phases({ reviewRequestedAt: "x", approvedAt: "y" }))).toBe(true);
    // `submitted_at` is what makes a second certification impossible.
    expect(applicationAwaitsSignature(phases({ reviewRequestedAt: "x", approvedAt: "y", submittedAt: "z" }))).toBe(false);
  });
});

describe("addressing one answer", () => {
  it("takes the path the validator produces, mixed keys and row numbers", () => {
    expect(applicationPathSchema.safeParse(["employers", 0, "city"]).success).toBe(true);
    expect(applicationPathSchema.safeParse(["cdl_number"]).success).toBe(true);
  });

  it("refuses a path that addresses nothing, or reaches deeper than the contract goes", () => {
    expect(applicationPathSchema.safeParse([]).success).toBe(false);
    expect(applicationPathSchema.safeParse(["a", "b", "c", "d"]).success).toBe(false);
    expect(applicationPathSchema.safeParse(["employers", -1, "city"]).success).toBe(false);
  });

  it("does not narrow the value, because which type is legal depends on the path", () => {
    // A boolean at `declares_no_accidents`, a string at `employers.0.city`, an array at `addresses`.
    // Narrowing here would restate the contract; the service re-parses the whole document instead.
    for (const value of ["Joliet", true, 4, null, ["a"], { k: 1 }]) {
      expect(applicationEditSchema.safeParse({ path: ["cdl_number"], value }).success).toBe(true);
    }
  });
});
