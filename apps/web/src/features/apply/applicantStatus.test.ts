import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ApplyWaitScreen from "@/features/apply/ApplyWaitScreen.vue";
import { applicantStages } from "@/features/apply/applicantStages";
import { setApplyLanguage } from "@/features/apply/language";
import type { ApplyPhases } from "@/features/apply/useApplication";

/**
 * §13 SP1: the wait screens show where the application stands (four stages from the served phases) and
 * what the applicant still owes — kinds, with the videos linked — in the page's language. The "nothing
 * more to do" note goes when something is owed.
 */
const P = (over: Partial<ApplyPhases> = {}): ApplyPhases => ({
  consentedAt: "2026-11-01T00:00:00Z", releasesCompletedAt: null, reviewRequestedAt: null, approvedAt: null,
  submittedAt: null, applicationSentAt: null, signingOpenedAt: null, ...over,
} as ApplyPhases);

const mountWait = (props: Record<string, unknown>) => mount(ApplyWaitScreen, {
  props: { heading: "H", body: "B", note: "Nothing more to do.", token: "tok", carrier: "acme freight", ...props },
  global: { stubs: { SmsOptInCard: true } },
});
const states = (w: ReturnType<typeof mount>) =>
  ["permissions", "application", "review", "visit"].map((s) => w.find(`[data-testid="stage-${s}"]`).attributes("data-state"));

afterEach(() => setApplyLanguage("en"));

describe("applicantStages", () => {
  it("is all later but the first before the permissions are signed", () => {
    expect(applicantStages(P()).map((s) => s.state)).toEqual(["current", "later", "later", "later"]);
  });

  it("walks the four as the phases fill in", () => {
    expect(applicantStages(P({ releasesCompletedAt: "x" })).map((s) => s.state)).toEqual(["done", "current", "later", "later"]);
    expect(applicantStages(P({ releasesCompletedAt: "x", reviewRequestedAt: "x" })).map((s) => s.state)).toEqual(["done", "done", "current", "later"]);
    expect(applicantStages(P({ releasesCompletedAt: "x", reviewRequestedAt: "x", approvedAt: "x" })).map((s) => s.state)).toEqual(["done", "done", "done", "current"]);
    expect(applicantStages(P({ releasesCompletedAt: "x", reviewRequestedAt: "x", approvedAt: "x", submittedAt: "x" })).map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("counts an approval as the application handed over, whatever the stamp says", () => {
    expect(applicantStages(P({ releasesCompletedAt: "x", approvedAt: "x" }))[1]!.state).toBe("done");
  });
});

describe("the wait screen's status", () => {
  it("shows the stages, keeps the note when nothing is owed, and names the carrier", () => {
    const w = mountWait({ phases: P({ releasesCompletedAt: "x", reviewRequestedAt: "x" }) });
    expect(states(w)).toEqual(["done", "done", "current", "later"]);
    expect(w.find('[data-testid="stage-review"]').text()).toContain("Acme freight reads it");
    expect(w.find('[data-testid="wait-note"]').exists()).toBe(true);
    expect(w.find('[data-testid="applicant-owes"]').exists()).toBe(false);
  });

  it("lists what is owed in the order served, links the videos on this token, and drops the note", () => {
    const w = mountWait({ phases: P({ releasesCompletedAt: "x", approvedAt: "x" }), owes: ["drug_test", "videos", "trip"] });
    expect(w.findAll('[data-testid^="owes-"]').map((li) => li.attributes("data-testid"))).toEqual(["owes-drug_test", "owes-videos", "owes-trip"]);
    expect(w.find('[data-testid="owes-videos"] a').attributes("href")).toBe("/apply/tok/videos");
    expect(w.find('[data-testid="owes-drug_test"]').text()).toContain("call them");
    expect(w.find('[data-testid="wait-note"]').exists()).toBe(false);
  });

  it("reads as before on a bundle without phases", () => {
    const w = mountWait({});
    expect(w.find('[data-testid="applicant-status"]').exists()).toBe(false);
    expect(w.find('[data-testid="wait-note"]').exists()).toBe(true);
  });

  it("speaks Spanish when the page does", () => {
    setApplyLanguage("es");
    const w = mountWait({ phases: P({ releasesCompletedAt: "x" }), owes: ["videos"] });
    expect(w.text()).toContain("En qué va su solicitud");
    expect(w.text()).toContain("Abrir los videos");
    expect(w.text()).not.toContain("Where your application is");
  });
});
