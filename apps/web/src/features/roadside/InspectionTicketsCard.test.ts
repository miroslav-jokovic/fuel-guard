import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import type { RoadsideCitationAction, RoadsideCitationDto } from "@silvicom/shared";

/**
 * The Tickets card (IC4, R-ADJ1). What it can get wrong: offer acts to a reader who cannot act, act over the
 * wrong row, default the follow-up to the browser's day, or keep asking about a ticket the court has decided.
 */

const data = ref<{ tickets: RoadsideCitationDto[]; courtResultFiled: boolean } | undefined>(undefined);
const sent: RoadsideCitationAction[] = [];
vi.mock("./useRoadsideInspections", () => ({
  useInspectionCitationsQuery: () => ({ data, isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  useActOnCitation: () => ({ mutate: (input: RoadsideCitationAction) => sent.push(input), reset: vi.fn(), isPending: ref(false), error: ref(null) }),
  RepairDecisionError: class extends Error {},
}));
let canAct = true;
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => canAct }) }));
// The org is in Los Angeles; the test runs at 2026-10-20 04:00 UTC, which is still 10-19 there.
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Los_Angeles") }) }));

const Card = (await import("./InspectionTicketsCard.vue")).default;

const ticket = (o: Partial<RoadsideCitationDto> = {}): RoadsideCitationDto => ({
  violationId: "v-1", code: "392.2-SLLS1", description: "Speeding", citationNumber: "E061", courtResults: [], action: null, ...o,
});
const card = async () => {
  const w = mount(Card, { props: { inspectionId: "insp-1", inspectionDate: "2026-06-01" }, global: { stubs: { AppDateField: { props: ["modelValue"], template: "<input data-test='ticket-follow-up' :value='modelValue' />" } } } });
  await flushPromises();
  return w;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T04:00:00Z"));
  sent.length = 0;
  canAct = true;
  data.value = { tickets: [ticket()], courtResultFiled: false };
});

describe("the Tickets card", () => {
  it("asks for the court result and records a request, following up 30 days on the carrier's day", async () => {
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Get the court result");
    await w.get("[data-test='ticket-requested']").trigger("click");
    expect(w.get("[data-test='ticket-follow-up']").attributes("value")).toBe("2026-11-18");
    await w.get("[data-test='ticket-form']").trigger("submit");
    expect(sent).toEqual([{ action: "requested_from_court", violationId: "v-1", basedOn: null, followUpOn: "2026-11-18", note: undefined }]);
  });

  it("records 'not contested' over the act the page showed, after saying what paying means", async () => {
    data.value = { tickets: [ticket({ action: { id: "c-7", kind: "requested_from_court", followUpOn: "2026-10-01", note: null, actedBy: "Jane", actedAt: "2026-09-01T00:00:00Z" } })], courtResultFiled: false };
    const w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Follow up with the court");
    await w.get("[data-test='ticket-not-contested']").trigger("click");
    expect(w.get("[data-test='ticket-form']").text()).toContain("keeps its full CSA weight");
    await w.get("[data-test='ticket-form']").trigger("submit");
    expect(sent).toEqual([{ action: "not_contested", violationId: "v-1", basedOn: "c-7", note: undefined }]);
  });

  it("offers nothing once the court has decided, or a court result is on file", async () => {
    data.value = { tickets: [ticket({ courtResults: ["Not Guilty/Dismissed"] })], courtResultFiled: false };
    let w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Not Guilty/Dismissed");
    expect(w.find("[data-test='ticket-actions']").exists()).toBe(false);
    data.value = { tickets: [ticket()], courtResultFiled: true };
    w = await card();
    expect(w.get("[data-test='ticket-badge']").text()).toBe("Court result on file");
    expect(w.find("[data-test='ticket-actions']").exists()).toBe(false);
  });

  it("offers no act to a reader who only views safety, and sends 'upload' to the Documents card", async () => {
    let w = await card();
    await w.get("[data-test='ticket-result']").trigger("click");
    expect(w.emitted("fileResult")).toHaveLength(1);
    canAct = false;
    w = await card();
    expect(w.find("[data-test='ticket-actions']").exists()).toBe(false);
  });

  it("is not drawn for an inspection with no ticket", async () => {
    data.value = { tickets: [], courtResultFiled: false };
    expect((await card()).find("[data-test='tickets-card']").exists()).toBe(false);
  });
});
