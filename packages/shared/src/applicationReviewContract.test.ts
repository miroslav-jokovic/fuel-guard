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
  applicationSentAt: null,
  reviewRequestedAt: null,
  approvedAt: null,
  signingOpenedAt: null,
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
      applicationSentAt: "2026-09-11T09:00:00Z",
      reviewRequestedAt: "2026-09-11T10:00:00Z",
      approvedAt: "2026-09-11T12:00:00Z",
      signingOpenedAt: "2026-09-11T12:30:00Z",
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
  it("§9 P5: lets the office edit from its own send until filing", () => {
    expect(applicationIsEditable(phases())).toBe(false);
    // EM-1: while the applicant is still filling it in — the recruiter on the phone.
    expect(applicationIsEditable(phases({ applicationSentAt: "w" }))).toBe(true);
    expect(applicationIsEditable(phases({ reviewRequestedAt: "x" }))).toBe(true);
    // EM-4: after approval too — the service refuses once the driver has marked the packet.
    expect(applicationIsEditable(phases({ reviewRequestedAt: "x", approvedAt: "y" }))).toBe(true);
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
      expect(applicationEditSchema.safeParse({ path: ["cdl_number"], value, revision: 3 }).success).toBe(true);
    }
  });

  it("§9 P5: refuses an edit that does not say which revision of the draft it was made against", () => {
    expect(applicationEditSchema.safeParse({ path: ["cdl_number"], value: "X" }).success).toBe(false);
    expect(applicationEditSchema.safeParse({ op: "remove_employer", key: "k1" }).success).toBe(false);
    expect(applicationEditSchema.safeParse({ op: "remove_employer", key: "k1", revision: 0 }).success).toBe(true);
  });
});
