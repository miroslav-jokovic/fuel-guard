import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppAvatarStack from "./AppAvatarStack.vue";

const people = ["Ana Ruiz", "Ben Admin", "Cara Ruiz", "Dan Ortega", "Eve Lin"].map((label, i) => ({ id: `id-${i}`, label }));

/** D-CHATUI24: a header's faces — the first few, then how many more, named by the caller. */
describe("AppAvatarStack", () => {
  it("shows three faces and +2 for five people, each coloured by their id", () => {
    const w = mount(AppAvatarStack, { props: { people, label: "5 people" } });
    expect(w.text()).toBe("ARBACR+2");
    expect(w.attributes("aria-label")).toBe("5 people");
    expect(w.findAll(".bg-surface-muted")).toHaveLength(1); // only the +2 is neutral
  });

  it("counts from `total` when it holds only the first few", () => {
    const w = mount(AppAvatarStack, { props: { people: people.slice(0, 2), total: 9, label: "9 people" } });
    expect(w.text()).toBe("ARBA+7");
  });

  it("draws no counter when everyone fits", () => {
    expect(mount(AppAvatarStack, { props: { people: people.slice(0, 3), label: "3" } }).text()).not.toContain("+");
  });
});
