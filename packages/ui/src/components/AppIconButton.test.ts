import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppIconButton from "./AppIconButton.vue";
import { UserIcon } from "../icons";

/**
 * An icon that opens a page is a LINK (TRUCK-CARD-ROUTE-PLAN D-TC1): a `<button>` pushing a route would
 * lose middle-click and "open in new tab". And an icon alone is a guess, so its words ride as both the
 * accessible name and the hover tooltip, in link and button form alike.
 */
describe("AppIconButton", () => {
  const RouterLink = { props: ["to"], template: `<a :href="String(to)"><slot /></a>` };
  const mountWith = (props: Record<string, unknown>) =>
    mount(AppIconButton, { props: { icon: UserIcon, label: "Open driver", ...props }, global: { stubs: { RouterLink } } });

  it("renders a link to `to`, named and titled by its label", () => {
    const a = mountWith({ to: "/drivers/d1" }).find("a");
    expect(a.attributes("href")).toBe("/drivers/d1");
    expect(a.attributes("aria-label")).toBe("Open driver");
    expect(a.attributes("title")).toBe("Open driver");
  });

  it("stays a button, named and titled, without `to`", () => {
    const w = mountWith({});
    expect(w.find("a").exists()).toBe(false);
    expect(w.find("button").attributes("aria-label")).toBe("Open driver");
    expect(w.find("button").attributes("title")).toBe("Open driver");
  });

  it("falls back to a disabled button when disabled, since a link cannot be disabled", () => {
    const w = mountWith({ to: "/drivers/d1", disabled: true });
    expect(w.find("a").exists()).toBe(false);
    expect(w.find("button").attributes("disabled")).toBeDefined();
  });

  it("says a toggle's state as aria-pressed only when it is one (D-TC7)", () => {
    expect(mountWith({ pressed: true }).find("button").attributes("aria-pressed")).toBe("true");
    expect(mountWith({ pressed: false }).find("button").attributes("aria-pressed")).toBe("false");
    expect(mountWith({}).find("button").attributes("aria-pressed")).toBeUndefined();
  });
});
