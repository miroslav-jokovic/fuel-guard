import { describe, it, expect, vi, beforeEach } from "vitest";
import { effectScope, ref } from "vue";
import { APPLICATION_RELEASE_ORDER, type AuthorizationPurpose } from "@fuelguard/shared";
import type { ApplyRelease } from "@/features/apply/useApplication";
import { useSigningCeremony } from "./useSigningCeremony";

/**
 * The ceremony (A5, D-APP7).
 *
 * The property that matters is not that it signs — it is that it cannot sign MORE than one document
 * per act and cannot skip one. FCRA §604(b)(2) makes each instrument its own document, courts read
 * "solely" literally, and a UI that let somebody jump ahead would produce a half-signed set that
 * looked complete.
 */

const signed = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/features/apply/useApplication", () => ({ signRelease: signed.fn }));

const release = (purpose: AuthorizationPurpose): ApplyRelease => ({
  purpose,
  version: "v1",
  title: `${purpose} title`,
  citation: "cite",
  body: `${purpose} body`,
  intent: `I authorize ${purpose}.`,
  draft: false,
});

const ALL = APPLICATION_RELEASE_ORDER.map(release);

const run = (releases: ApplyRelease[] = ALL, already: AuthorizationPurpose[] = []) =>
  effectScope().run(() =>
    useSigningCeremony(ref("t".repeat(43)), ref(releases), ref(already)),
  )!;

describe("adopting a signature", () => {
  beforeEach(() => {
    signed.fn.mockReset();
    signed.fn.mockResolvedValue({ signedCount: 1, completed: false });
  });

  it("happens once, before any instrument is shown", () => {
    const c = run();
    expect(c.adopted.value).toBe(false);
    expect(c.current.value).not.toBeNull();
    c.adoptedName.value = "Susan Godfrey";
    expect(c.adopt()).toBe(true);
    expect(c.adopted.value).toBe(true);
  });

  it("refuses a name that is not one", () => {
    const c = run();
    c.adoptedName.value = " ";
    expect(c.adopt()).toBe(false);
    expect(c.adopted.value).toBe(false);
  });
});

describe("signing", () => {
  beforeEach(() => {
    signed.fn.mockReset();
    signed.fn.mockResolvedValue({ signedCount: 1, completed: false });
  });

  it("presents the four in APPLICATION_RELEASE_ORDER, one at a time", async () => {
    const c = run();
    c.adoptedName.value = "Susan Godfrey";
    c.adopt();

    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(c.current.value!.purpose);
      expect(c.position.value).toBe(i + 1);
      expect(c.total.value).toBe(4);
      await c.sign();
    }
    expect(seen).toEqual([...APPLICATION_RELEASE_ORDER]);
    expect(c.complete.value).toBe(true);
    expect(c.current.value).toBeNull();
  });

  it("sends the adopted name and the purpose, and nothing about the wording", async () => {
    const c = run();
    c.adoptedName.value = "  Susan Godfrey  ";
    c.adopt();
    await c.sign();
    expect(signed.fn).toHaveBeenCalledWith("t".repeat(43), "fcra_disclosure", "Susan Godfrey");
  });

  /** The one that matters: one act, one document, and no way to reach the next without the last. */
  it("does not advance when the signature fails", async () => {
    signed.fn.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "sign_failed" }));
    const c = run();
    c.adoptedName.value = "Susan Godfrey";
    c.adopt();

    await c.sign();
    expect(c.position.value).toBe(1);
    expect(c.current.value!.purpose).toBe("fcra_disclosure");
    expect(c.error.value).toBeTruthy();
    expect(c.complete.value).toBe(false);
  });

  /** A double-tap or a second tab. The server already has the signature; do not scold the driver. */
  it("moves on when the server says this one was already signed", async () => {
    signed.fn.mockRejectedValueOnce(Object.assign(new Error("dupe"), { code: "release_already_signed" }));
    const c = run();
    c.adoptedName.value = "Susan Godfrey";
    c.adopt();

    await c.sign();
    expect(c.position.value).toBe(2);
    expect(c.error.value).toBeNull();
  });

  /**
   * Q-H3, at the ceremony. A driver who cannot sign because the carrier has not published its wording
   * has done nothing wrong and can do nothing about it, so it is named as the carrier's problem.
   */
  it("names a draft-wording refusal as the carrier's problem, not the driver's", async () => {
    signed.fn.mockRejectedValueOnce(Object.assign(new Error("409"), { code: "disclosure_not_final" }));
    const c = run();
    c.adoptedName.value = "Susan Godfrey";
    c.adopt();

    await c.sign();
    expect(c.carrierProblem.value).toBe(true);
    expect(c.error.value).toBeNull();
    expect(c.position.value).toBe(1);
  });

  /** A resumed session (D-APP1): the two already given are not asked for again. */
  it("asks only for the instruments this link has not already collected", async () => {
    const c = run(ALL, ["fcra_disclosure", "psp"]);
    c.adoptedName.value = "Susan Godfrey";
    c.adopt();

    expect(c.total.value).toBe(2);
    expect(c.current.value!.purpose).toBe("previous_employer");
    await c.sign();
    expect(c.current.value!.purpose).toBe("drug_alcohol");
    await c.sign();
    expect(c.complete.value).toBe(true);
  });

  it("is complete from the start when every instrument is already signed", () => {
    const c = run(ALL, [...APPLICATION_RELEASE_ORDER]);
    expect(c.total.value).toBe(0);
    expect(c.complete.value).toBe(true);
  });
});
