import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import type { PartUsageDetailDto, PartUseDto } from "@silvicom/shared";

/**
 * How the shop uses one part (SHOP-PARTS-USAGE-PLAN.md SP-U2). What this card can get wrong that the
 * API's tests cannot see:
 *
 *   · a hand-typed part must say FleetPal cannot name it — "never used" would be a claim about the shop;
 *   · "Again after N days" only inside REPEAT_WITHIN_DAYS, and never on a unit's first use;
 *   · a matched unit links to its page, an unmatched one says "not linked", none says so;
 *   · no price anywhere (D-SPU4).
 */

const use = (over: Partial<PartUseDto> = {}): PartUseDto => ({
  workOrderNumber: 5675,
  workOrderStatus: "CLOSED",
  usedAt: "2026-10-30T15:00:00.000Z",
  unit: { kind: "trailer", id: "66666666-6666-4666-8666-666666666666", number: "T-88" },
  quantity: 2,
  daysSincePreviousOnUnit: null,
  ...over,
});
const detail = ref<PartUsageDetailDto | undefined>(undefined);
const flags = { loading: false, error: false };
const asked = vi.hoisted(() => ({ page: null as null | { value: number } }));

vi.mock("./usePartUsage", async () => {
  const { ref: r, computed } = await import("vue");
  return {
    usePartUsageDetailQuery: (_id: unknown, page: { value: number }) => {
      asked.page = page;
      return {
        data: detail,
        isLoading: computed(() => flags.loading),
        isError: r(flags.error),
        isFetching: r(false),
        refetch: vi.fn(),
      };
    },
  };
});

const PartUsageSection = (await import("./PartUsageSection.vue")).default;
const mountIt = (fromFleetpal = true) =>
  mount(PartUsageSection, {
    props: { partId: "p1", fromFleetpal },
    global: { stubs: { RouterLink: { props: ["to"], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } } },
  });

beforeEach(() => {
  flags.loading = false;
  flags.error = false;
  detail.value = {
    summary: { quantity90d: 311, repairs90d: 93, quantity365d: 1200.5, repairs365d: 380, units365d: 140, firstUsedAt: "2025-03-25T12:00:00.000Z", lastUsedAt: "2026-10-30T15:00:00.000Z" },
    uses: [use()],
    total: 380,
  };
});

describe("how much the shop uses it", () => {
  it("reads quantity on repairs for both windows, the units and the last use", () => {
    const text = mountIt().text();
    expect(text).toContain("311 on 93 repairs");
    expect(text).toContain("1,200.5 on 380 repairs");
    expect(text).toContain("140 in 12 months");
    expect(text).toContain("10/30/2026");
  });

  it("an unused part reads None and Never, not zeros", () => {
    detail.value = { summary: { quantity90d: 0, repairs90d: 0, quantity365d: 0, repairs365d: 0, units365d: 0, firstUsedAt: null, lastUsedAt: null }, uses: [], total: 0 };
    const text = mountIt().text();
    expect(text).toContain("None");
    expect(text).toContain("Never");
    expect(text).toContain("No repair order has used this part yet.");
  });

  it("a hand-typed part says FleetPal cannot name it, and draws no table", () => {
    const w = mountIt(false);
    expect(w.text()).toContain("added here, not in FleetPal");
    expect(w.text()).not.toContain("Where it went");
    expect(w.text()).not.toContain("Never");
  });

  it("shows no price anywhere (D-SPU4)", () => {
    expect(mountIt().text()).not.toMatch(/\$|price/i);
  });
});

describe("where it went", () => {
  // jsdom has no matchMedia → DataTable draws phone cards; every column the test reads is marked on the card.
  it("links a matched unit to its page", () => {
    const link = mountIt().find("a[data-to]");
    expect(JSON.parse(link.attributes("data-to")!)).toEqual({ name: "unit", params: { kind: "trailer", id: "66666666-6666-4666-8666-666666666666" } });
    expect(link.text()).toBe("T-88");
  });

  it("an unmatched unit says not linked, a missing one says so", () => {
    detail.value!.uses = [use({ unit: { kind: null, id: null, number: "999" } }), use({ workOrderNumber: 1, unit: { kind: null, id: null, number: null } })];
    const w = mountIt();
    expect(w.find("a[data-to]").exists()).toBe(false);
    expect(w.text()).toContain("999 · not linked");
    expect(w.text()).toContain("No unit on the repair order");
  });

  it("says 'Again after N days' inside the window only, and never on a first use", () => {
    detail.value!.uses = [
      use({ workOrderNumber: 1, daysSincePreviousOnUnit: 12 }),
      use({ workOrderNumber: 2, daysSincePreviousOnUnit: 1 }),
      use({ workOrderNumber: 3, daysSincePreviousOnUnit: 31 }),
      use({ workOrderNumber: 4, daysSincePreviousOnUnit: null }),
    ];
    const badges = mountIt().findAll('[data-test="again-on-unit"]').map((b) => b.text().replace(/\s+/g, " "));
    expect(badges).toEqual(["Again after 12 days", "Again after 1 day"]);
  });

  it("pages the history with the server's total", async () => {
    const w = mountIt();
    const pager = w.findComponent({ name: "TablePagination" });
    expect(pager.props("total")).toBe(380);
    pager.vm.$emit("update:page", 3);
    await w.vm.$nextTick();
    expect(asked.page!.value).toBe(3);
  });
});

describe("loading and failure use the shared QueryState", () => {
  it("says it is loading, then what failed, with a retry", () => {
    flags.loading = true;
    expect(mountIt().text()).toContain("Loading how this part was used…");
    flags.loading = false;
    flags.error = true;
    const w = mountIt();
    expect(w.text()).toContain("Could not load how this part was used.");
    expect(w.text()).toContain("Retry");
  });
});
