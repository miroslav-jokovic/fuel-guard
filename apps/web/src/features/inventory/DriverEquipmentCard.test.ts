import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * The driver page's Equipment card (DE2b). What it can get wrong that the page's gate test cannot see:
 * asking for somebody else's tablets, losing "since when" the API now answers for a driver's list, and
 * not flagging the tablet of a driver who has left — the page where that matters most.
 */
const asked: Array<{ value: Record<string, unknown> }> = [];
const rows = ref<unknown[]>([]);
vi.mock("./useAssets", () => ({
  useAssetsQuery: (f: { value: Record<string, unknown> }) => {
    asked.push(f);
    return { data: ref({ assets: rows.value, total: rows.value.length }), isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() };
  },
}));

const DriverEquipmentCard = (await import("./DriverEquipmentCard.vue")).default;
const tablet = (notReturned: boolean) => ({
  id: "a-1",
  displayNo: "A-0412",
  name: "Cab tablet",
  assetTypeName: "Tablet",
  imei: "490154203237518",
  holder: { kind: "driver", id: "d-1", label: "Dana Reyes", inferredDriverName: null, since: "2026-10-29T15:00:00.000Z", notReturned },
});
const render = () => mount(DriverEquipmentCard, { props: { driverId: "d-1" }, global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } } });

describe("the driver's Equipment card (DE2b)", () => {
  it("asks for this driver's equipment and nobody else's", () => {
    render();
    expect(asked.at(-1)!.value).toEqual({ driverId: "d-1", page: 1 });
  });

  it("shows the number, the IMEI's last five and since when", () => {
    rows.value = [tablet(false)];
    const text = render().text();
    expect(text).toContain("A-0412");
    expect(text).toContain("IMEI …37518");
    expect(text).toContain("since 10/29/2026");
    expect(text).not.toContain("Not returned");
  });

  it("flags the tablet of a driver who has left", () => {
    rows.value = [tablet(true)];
    expect(render().text()).toContain("Not returned");
  });

  it("says so when the driver holds nothing", () => {
    rows.value = [];
    expect(render().text()).toContain("No tablet or other equipment is with this driver.");
  });
});
