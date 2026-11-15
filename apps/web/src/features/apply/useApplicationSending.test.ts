import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { emptyDraft, type ApplicationDraft } from "./draft";
import type { SectionIssue } from "./useApplicationWizard";
import { useApplicationSending } from "./useApplicationSending";
import { APPLY_COPY } from "./strings";
import { CARRIER_ANSWERS } from "@/testing/carrierAnswers";

/**
 * C3c1: a v2 application that PARSES can still be one filing refuses — at the office, after approval,
 * where the applicant can no longer fix it. So both acts run filing's own rules first: the hand-off
 * (first visit) and the certification (second). A legacy link is asked nothing new.
 */
const acts = vi.hoisted(() => ({ handOff: vi.fn(), submit: vi.fn() }));
vi.mock("./useApplication", () => ({
  useRequestReview: () => ({ mutateAsync: acts.handOff, isPending: ref(false) }),
  useSubmitApplication: () => ({ mutateAsync: acts.submit, isPending: ref(false) }),
}));

const AS_OF = "2026-09-26";

/** Complete for §391.21(b), and with fifteen months since its one job ended — a gap to explain. */
const complete = (): ApplicationDraft => ({
  ...emptyDraft(),
  // §9 P8: the carrier's seven required answers — a complete application gives them.
  questionnaire: { ...CARRIER_ANSWERS },
  experience: "Eight years, dry van and reefer.",
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ key: "00000000-0000-4000-8000-000000000016", line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
  employers: [{
    key: "40000000-0000-4000-8000-00000000000a", employer_name: "Old Carrier", usdot_number: "123456",
    address_line1: "12 Depot Rd", city: "Joliet", state: "IL", phone: "555-0100", email: "", position_held: "Driver",
    started_on: "2023-01-01", ended_on: "2025-06-30", operated_cmv: true, dot_regulated: true,
    reason_for_leaving: "Better route", subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_accidents: true, declares_no_violations: true,
  // (b)(9) answered — `emptyDraft` leaves it unanswered since C3c2c1, so a complete draft says No itself.
  licence_ever_denied: false, licence_suspended: false,
  certified: true, signed_name: "Susan Godfrey",
});

function setUp(draft: ApplicationDraft, asOf: string | null, saved?: () => Promise<boolean>) {
  const shown: SectionIssue[][] = [];
  const sending = useApplicationSending(ref("t"), draft, { setIssues: (v) => shown.push(v) }, () => asOf, saved);
  return { sending, shown };
}

beforeEach(() => {
  acts.handOff.mockReset().mockResolvedValue({});
  acts.submit.mockReset().mockResolvedValue({});
  vi.stubGlobal("scrollTo", () => {});
});

describe("before the hand-off and the certification, on a v2 link", () => {
  it("hands nothing to the office while a gap is unexplained, and names it", async () => {
    const { sending, shown } = setUp(complete(), AS_OF);
    await sending.sendForReview();
    expect(acts.handOff).not.toHaveBeenCalled();
    expect(shown.at(-1)!.map((i) => i.say)).toEqual(["Tell us what you were doing from 06/30/2025 to 09/26/2026"]);
  });

  it("certifies nothing either", async () => {
    const { sending } = setUp(complete(), AS_OF);
    await sending.send();
    expect(acts.submit).not.toHaveBeenCalled();
  });

  it("hands it over once the gap is explained", async () => {
    const draft = complete();
    draft.employment_gaps = [{ from: "2025-06-30", to: "2026-09-26", explanation: "Looking for work" }];
    const { sending } = setUp(draft, AS_OF);
    await sending.sendForReview();
    expect(acts.handOff).toHaveBeenCalledTimes(1);
    await sending.send();
    expect(acts.submit).toHaveBeenCalledTimes(1);
    // And the explanation travels in the document that is filed.
    expect(acts.submit.mock.calls[0]![0].application.employment_gaps).toEqual([
      { from: "2025-06-30", to: "2026-09-26", explanation: "Looking for work" },
    ]);
  });

  it("asks a legacy link nothing new", async () => {
    const { sending } = setUp(complete(), null);
    await sending.sendForReview();
    expect(acts.handOff).toHaveBeenCalledTimes(1);
  });
});

/**
 * 2026-11-15: the hand-over carries no answers — the office opens the SAVED draft — so it waits for the
 * last answers to be saved, and does not happen when they cannot be. Before this a driver who pressed
 * Send inside the autosave's five seconds was told the carrier had an application the server did not.
 */
describe("the hand-over waits for the answers to be saved", () => {
  const sendable = (): ApplicationDraft => ({
    ...complete(),
    employers: [{ ...complete().employers[0]!, ended_on: "" }],
  });

  it("saves first, then hands over", async () => {
    const order: string[] = [];
    acts.handOff.mockImplementation(async () => { order.push("hand-over"); return {}; });
    const { sending } = setUp(sendable(), AS_OF, async () => { order.push("saved"); return true; });
    await sending.sendForReview();
    expect(order).toEqual(["saved", "hand-over"]);
    expect(sending.handedOver.value).toBe(true);
  });

  it("hands nothing over when the answers could not be saved, and says so", async () => {
    for (const saved of [async () => false, async () => { throw new Error("offline"); }]) {
      acts.handOff.mockClear();
      const { sending } = setUp(sendable(), AS_OF, saved);
      await sending.sendForReview();
      expect(acts.handOff).not.toHaveBeenCalled();
      expect(sending.handedOver.value).toBe(false);
      expect(sending.sendError.value).toBe(APPLY_COPY.handoff.notSaved);
    }
  });

  it("keeps the Send button busy while the answers are on their way", async () => {
    let land!: (v: boolean) => void;
    const { sending } = setUp(sendable(), AS_OF, () => new Promise<boolean>((resolve) => { land = resolve; }));
    const pressed = sending.sendForReview();
    await Promise.resolve();
    expect(sending.handingOver.value).toBe(true);
    expect(acts.handOff).not.toHaveBeenCalled();
    land(true);
    await pressed;
    expect(acts.handOff).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a save when the document is incomplete: the refusal comes first", async () => {
    const saved = vi.fn(async () => true);
    const { sending } = setUp(complete(), AS_OF, saved);
    await sending.sendForReview();
    expect(saved).not.toHaveBeenCalled();
  });
});
