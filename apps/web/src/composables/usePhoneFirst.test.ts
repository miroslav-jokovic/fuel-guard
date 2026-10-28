import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { AppButton } from "@silvicom/ui";
import { buildNavGroups } from "@/lib/nav";
import { usePhoneFirst } from "./usePhoneFirst";

/**
 * The shell's half of the touch floor (DESIGN-SYSTEM-CONTRACT.md §9 rule 1): a shop page is 48 px
 * while it is touched — a coarse pointer, or a window below `md` — and a desk keeps its 36.
 */
enableAutoUnmount(afterEach);

function setPointer({ coarse, narrow }: { coarse: boolean; narrow: boolean }) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (media: string) => ({
      matches: media.includes("coarse") ? coarse : media.includes("max-width") ? narrow : false,
      media, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
}

async function buttonAt(path: string) {
  const page = { render: () => h(AppButton, {}, { default: () => "Go" }) };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/shop/units", component: page },
      { path: "/vehicles", component: page },
    ],
  });
  const Shell = defineComponent({
    setup() {
      usePhoneFirst(ref(buildNavGroups("admin", null)));
      return () => h(RouterView);
    },
  });
  await router.push(path);
  const w = mount(Shell, { global: { plugins: [router] } });
  await flushPromises();
  return w.find("button").classes();
}

describe("the shop's touch floor", () => {
  it("is 48 px on a shop page under a coarse pointer — a tablet at any width", async () => {
    setPointer({ coarse: true, narrow: false });
    expect(await buttonAt("/shop/units")).toContain("h-12");
  });

  it("is 48 px on a shop page in a phone-wide window, whatever the pointer", async () => {
    setPointer({ coarse: false, narrow: true });
    expect(await buttonAt("/shop/units")).toContain("h-12");
  });

  it("keeps the desk's 36 px on a shop page with a mouse, and everywhere outside the shop", async () => {
    setPointer({ coarse: false, narrow: false });
    expect(await buttonAt("/shop/units")).toContain("h-9");
    setPointer({ coarse: true, narrow: true });
    expect(await buttonAt("/vehicles")).toContain("h-9");
  });
});
