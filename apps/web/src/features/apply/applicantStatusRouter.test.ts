import { emptyDraft } from "./draft";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { shallowMount } from "@vue/test-utils";
import ApplyPhaseRouter from "@/features/apply/ApplyPhaseRouter.vue";
import ApplyWaitScreen from "@/features/apply/ApplyWaitScreen.vue";

/**
 * §13 SP1: every wait screen the phase chain opens is handed the served phases and what is owed — the
 * chain is where a screen could be left out, so the hand-off is pinned here, branch by branch.
 */
vi.mock("@/features/apply/useScreenEvents", () => ({ provideScreenEvents: () => {} }));
vi.mock("@/features/apply/linkMemo", () => ({ useLinkMemo: () => ({ heading: "", body: "" }) }));

const PHASES = { consentedAt: "x", releasesCompletedAt: "x", reviewRequestedAt: null, approvedAt: null, submittedAt: null, applicationSentAt: null, signingOpenedAt: null };
const invitation = { isLoading: ref(false), isError: ref(false), data: ref({ carrier: "Acme", phases: PHASES, owes: ["videos"] }) };
const OFF = {
  submitted: false, awaitingReview: false, expectationsNeeded: false, ceremonyAvailable: false, esignConsent: null,
  consentNeeded: false, consenting: false, consentFailed: false, partOneNeeded: false, partOneInputs: null,
  refreshPartOne: async () => null, isPartOneLink: false, identityNeeded: false, ceremonyNeeded: false, releases: [],
  waitingForApplication: false, awaitingOffice: false, locked: false, awaitingSignature: false, packetStops: [],
  packetAdopted: null, sending: false, sendError: null, sendIssues: [],
  // F5: no question from the office is open, which is nearly every application.
  ask: { asking: ref(false), open: ref([]), opened: ref([]), sending: ref(null), failed: ref(null), answering: ref(null) } as never,
};

describe("the phase chain's wait screens", () => {
  it.each(["awaitingReview", "waitingForApplication", "awaitingOffice"])("%s is handed the phases and what is owed", (flag) => {
    const w = shallowMount(ApplyPhaseRouter, {
      props: { token: "tok", invitation: invitation as never, draft: {} as never, ...OFF, [flag]: true },
      global: { renderStubDefaultSlot: true },
    });
    const screen = w.findComponent(ApplyWaitScreen);
    expect(screen.exists()).toBe(true);
    expect(screen.props("phases")).toEqual(PHASES);
    expect(screen.props("owes")).toEqual(["videos"]);
  });

  /** F5 (0607): while the office waits on an answer, the wait screen is its questions. */
  it("⚠ shows the office's questions in place of the wait screen while one is open", () => {
    const q = { id: "q1", path: ["experience"], question: "How many years on a flatbed?", askedAt: "x", answeredAt: null, withdrawnAt: null };
    const w = shallowMount(ApplyPhaseRouter, {
      props: {
        token: "tok", invitation: invitation as never, draft: emptyDraft(), ...OFF, awaitingReview: true,
        ask: { ...(OFF.ask as object), asking: ref(true), open: ref([q]) } as never,
      },
      global: { renderStubDefaultSlot: true },
    });
    expect(w.findComponent(ApplyWaitScreen).exists()).toBe(false);
    const screen = w.findComponent({ name: "AskAgainScreen" });
    expect(screen.props("questions")).toEqual([q]);
    expect(Object.keys(screen.props("labels") as object)).toEqual(["q1"]);
  });
});
