import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * A truck's Toll tags card (TOLLS-PER-TRUCK-PLAN.md TL2). What a reader relies on: the tag on the
 * truck now with since when, on the company's clock; a tag it carried before with where it is now; the
 * full history on demand with a voided entry crossed out and its reason; and no verb offered to a
 * reader who cannot keep the truck's file.
 */
const perms = vi.hoisted(() => ({ view: true, manage: true }));
const data = vi.hoisted(() => ({ tags: [] as unknown[] }));
vi.mock("./useTollTags", () => ({
  useTollTagsQuery: () => ({ data: ref(data.tags), isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() }),
}));
vi.mock("@/composables/useOrgTimezone", async () => {
  const { computed } = await import("vue");
  return { useOrgTimezone: () => ({ zone: computed(() => "America/Chicago"), isResolved: computed(() => true) }) };
});
// The dialog is stubbed, but its module still loads with the card.
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ canView: () => perms.view, can: () => perms.manage }) }));

const TruckTollTagsCard = (await import("./TruckTollTagsCard.vue")).default;

const entry = (id: string, vehicleId: string, unitNumber: string, validFrom: string, validTo: string | null, voided: string | null = null) => ({
  id, vehicleId, unitNumber, validFrom, validTo, voidedAt: voided ? "2026-06-16T00:00:00Z" : null, voidReason: voided,
});
const ON_THIS = {
  id: "t-1", provider: "ezpass", tagNumber: "00812345678", issuer: "NTTA", note: null, retiredAt: null, retiredReason: null,
  currentVehicleId: "v-654",
  history: [
    entry("a-3", "v-702", "702", "2026-06-15T05:00:00Z", null, "typed the wrong truck"),
    entry("a-2", "v-654", "654", "2026-06-10T14:00:00Z", null),
  ],
};
const BEFORE = {
  id: "t-2", provider: "ktag", tagNumber: "KT0000777", issuer: null, note: null, retiredAt: null, retiredReason: null,
  currentVehicleId: "v-702",
  history: [entry("b-2", "v-702", "702", "2026-06-05T14:00:00Z", null), entry("b-1", "v-654", "654", "2026-06-01T14:00:00Z", "2026-06-05T14:00:00Z")],
};

const render = () =>
  mount(TruckTollTagsCard, {
    props: { vehicleId: "v-654", unitNumber: "654" },
    global: { stubs: { KebabMenu: { template: "<div><slot /></div>" }, TollTagDialog: true } },
  });

beforeEach(() => {
  perms.view = true;
  perms.manage = true;
  data.tags = [BEFORE, ON_THIS];
});

describe("a truck's toll tags", () => {
  it("lists the tag on the truck first, since when on the company's clock, then the one it carried before and where it is now", () => {
    const rows = render().findAll("[data-test=toll-tag-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("E-ZPass 00812345678");
    expect(rows[0]!.text()).toContain("On this truck since 06/10/2026 9:00 AM");
    expect(rows[1]!.text()).toContain("K-TAG KT0000777");
    expect(rows[1]!.text()).toContain("Now on unit 702");
  });

  it("shows the whole history on demand, a voided entry crossed out with its reason and no void offered on it", async () => {
    const w = render();
    const first = w.findAll("[data-test=toll-tag-row]")[0]!;
    await first.findAll("button").find((b) => b.text() === "History")!.trigger("click");
    await flushPromises();
    const hist = w.find("[data-test=toll-tag-history]");
    expect(hist.text()).toContain("Voided: typed the wrong truck");
    expect(hist.find(".line-through").text()).toContain("Unit 702");
    expect(hist.findAll("[data-test=toll-entry-void]")).toHaveLength(1);
  });

  it("says plainly when the truck has no tag, and what that costs", () => {
    data.tags = [];
    expect(render().text()).toContain("Its tolls cannot be charged to it until one is.");
  });

  it("offers no verb to a reader who cannot keep the truck's file", () => {
    perms.manage = false;
    const w = render();
    expect(w.find("[data-test=toll-tag-add]").exists()).toBe(false);
    expect(w.find("[data-test=toll-tag-move]").exists()).toBe(false);
  });

  it("renders nothing for a reader without the equipment section", () => {
    perms.view = false;
    expect(render().find("[data-test=toll-tags-card]").exists()).toBe(false);
  });
});
