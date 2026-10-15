import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import BulkActionBar from "./BulkActionBar.vue";

describe("BulkActionBar", () => {
  it("renders nothing while no row is ticked", () => {
    const w = mount(BulkActionBar, { props: { count: 0 }, slots: { default: "<button>Retire</button>" } });
    expect(w.find('[aria-label="Bulk actions"]').exists()).toBe(false);
  });

  it("says how many are ticked, shows the page's actions, and ends with one Clear", () => {
    const w = mount(BulkActionBar, {
      props: { count: 1204 },
      slots: { default: "<button>Retire</button>", note: "Set capability:" },
    });
    const bar = w.get('[aria-label="Bulk actions"]');
    expect(bar.text()).toContain("1,204 selected");
    expect(bar.text()).toContain("Set capability:");
    expect(bar.findAll("button").map((b) => b.text())).toEqual(["Retire", "Clear"]);
  });

  it("asks the page to empty the selection when Clear is pressed", async () => {
    const w = mount(BulkActionBar, { props: { count: 2 } });
    await w.get("button").trigger("click");
    expect(w.emitted("clear")).toHaveLength(1);
  });
});
