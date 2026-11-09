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
});
