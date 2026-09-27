import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { emptyDraft, type ApplicationDraft } from "./draft";
import type { SectionIssue } from "./useApplicationWizard";
import { useApplicationSending } from "./useApplicationSending";

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
  experience: "Eight years, dry van and reefer.",
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
  employers: [{
    key: "40000000-0000-4000-8000-00000000000a", employer_name: "Old Carrier", usdot_number: "123456",
    address_line1: "12 Depot Rd", city: "Joliet", state: "IL", phone: "555-0100", email: "", position_held: "Driver",
    started_on: "2023-01-01", ended_on: "2025-06-30", operated_cmv: true, dot_regulated: true,
    reason_for_leaving: "Better route", subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_accidents: true, declares_no_violations: true,
  // (b)(9) answered — `emptyDraft` leaves it unanswered since C3c2c1, so a complete draft says No itself.
  licence_ever_denied: false,
  certified: true, signed_name: "Susan Godfrey",
});

function setUp(draft: ApplicationDraft, asOf: string | null) {
  const shown: SectionIssue[][] = [];
  const sending = useApplicationSending(ref("t"), draft, { setIssues: (v) => shown.push(v) }, () => asOf);
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
