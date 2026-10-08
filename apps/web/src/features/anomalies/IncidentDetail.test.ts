import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { CardFraudIncidentDetail } from "@silvicom/shared";

/**
 * The incident drawer (F02-F04 chunk 8c3). What only a mount can show: the story in words, who sees the
 * actions (Q-F11 (a): fuel managers, the rule the API enforces), and that a close carries the verdict,
 * the note and the version the person read — or is refused here before it reaches the API.
 */
const state = { incident: null as CardFraudIncidentDetail | null, calls: [] as unknown[] };
vi.mock("./useCardFraudIncident", () => ({
  useCardFraudIncident: () => ({ data: computed(() => state.incident), isLoading: ref(false), isError: ref(false), error: ref(null) }),
  useCardFraudIncidentTransition: () => ({
    mutateAsync: async (v: unknown) => { state.calls.push(v); },
    isPending: ref(false),
  }),
}));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};
import IncidentDetail from "./IncidentDetail.vue";
import { useToastStore } from "@/stores/toast";

const open = (o: Partial<CardFraudIncidentDetail> = {}): CardFraudIncidentDetail => ({
  id: "i1", status: "open", version: 4, disposition: null, resolutionNote: null, cardLast4: "7967", unitNumber: "555",
  openedAt: "2026-10-05T14:10:00Z", lastAttemptAt: "2026-10-05T16:00:00Z", level: "alert", attemptCount: 2, fuelTaken: false,
  failedPrompts: [], places: [{ city: "Jacksonville", state: "FL", attempts: 2, firstAt: "", lastAt: "" }], lastTruck: null,
  attempts: [{ source: "decline", attemptedAt: "2026-10-05T14:10:00Z", step: "opened" }, { source: "decline", attemptedAt: "2026-10-05T16:00:00Z", step: null }],
  ...o,
});
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text() === text);

beforeEach(() => {
  setActivePinia(createPinia());
  state.incident = open();
  state.calls = [];
  session.role = "admin";
});

describe("the incident drawer", () => {
  it("tells what happened in words, and lists each attempt", async () => {
    const w = mount(IncidentDetail, { props: { id: "i1" } });
    expect(w.text()).toContain("Card ••••7967 was tried 2 times in Jacksonville, FL.");
    expect(w.text()).toContain("No fuel was taken.");
    expect(w.findAll("li")).toHaveLength(2);
    expect(w.text()).toContain("First try");
  });

  it("closes in two clicks with the verdict, the note and the version read", async () => {
    const w = mount(IncidentDetail, { props: { id: "i1" } });
    await button(w, "False alarm")!.trigger("click");
    await w.find("textarea").setValue("Driver was at the pump with the truck");
    await button(w, "Dismiss")!.trigger("click");
    await flushPromises();
    expect(state.calls).toEqual([
      { id: "i1", status: "dismissed", version: 4, note: "Driver was at the pump with the truck", disposition: "false_positive" },
    ]);
    expect(w.emitted("changed")).toHaveLength(1);
  });

  it("refuses a close without a verdict, before the API, and says why", async () => {
    const w = mount(IncidentDetail, { props: { id: "i1" } });
    await w.find("textarea").setValue("note");
    await button(w, "Resolve")!.trigger("click");
    await flushPromises();
    expect(state.calls).toEqual([]);
    expect(useToastStore().toasts.map((t) => t.title)).toEqual(["Pick a verdict and write a note"]);
  });

  it("shows no actions to a safety manager, who sees incidents but does not manage fuel", async () => {
    session.role = "safety_manager";
    const w = mount(IncidentDetail, { props: { id: "i1" } });
    expect(button(w, "Resolve")).toBeUndefined();
    expect(button(w, "Dismiss")).toBeUndefined();
  });

  it("shows a closed incident's verdict and offers to reopen it", async () => {
    state.incident = open({ status: "dismissed", disposition: "false_positive", resolutionNote: "At the pump" });
    const w = mount(IncidentDetail, { props: { id: "i1" } });
    expect(w.text()).toContain("At the pump");
    await button(w, "Reopen")!.trigger("click");
    await flushPromises();
    expect(state.calls).toEqual([{ id: "i1", status: "investigating", version: 4, note: undefined, disposition: undefined }]);
  });
});
