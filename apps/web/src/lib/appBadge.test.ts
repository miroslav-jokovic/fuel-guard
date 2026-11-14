import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useAppBadge } from "@/lib/appBadge";
import { syncThemeColor } from "@/composables/useColorScheme";

/** The installed app's icon number and title-bar colour (INSTALLED-APP-PLAN D-IA1, D-IA3). */
afterEach(() => vi.unstubAllGlobals());

function harness(start: number) {
  const setAppBadge = vi.fn(async () => {});
  const clearAppBadge = vi.fn(async () => {});
  vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });
  const count = ref(start);
  const w = mount(defineComponent({ setup() { useAppBadge(count); return () => h("div"); } }));
  return { setAppBadge, clearAppBadge, count, w };
}

describe("the number on the app icon", () => {
  it("is the count it is given, follows it, and is cleared at zero", async () => {
    const { setAppBadge, clearAppBadge, count } = harness(3);
    expect(setAppBadge).toHaveBeenLastCalledWith(3);
    count.value = 5;
    await nextTick();
    expect(setAppBadge).toHaveBeenLastCalledWith(5);
    count.value = 0;
    await nextTick();
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
  });

  it("is cleared when the signed-in shell goes away", () => {
    const { clearAppBadge, w } = harness(4);
    w.unmount();
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a browser without the Badging API", () => {
    vi.stubGlobal("navigator", {});
    expect(() => mount(defineComponent({ setup() { useAppBadge(ref(2)); return () => h("div"); } }))).not.toThrow();
  });
});

describe("the title bar's colour", () => {
  it("becomes the page's own background in one tag, replacing the per-OS pair", () => {
    document.head.innerHTML = '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f7f8"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121214">';
    document.documentElement.style.backgroundColor = "rgb(18, 18, 20)";
    syncThemeColor();
    const tags = document.querySelectorAll('meta[name="theme-color"]');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.getAttribute("content")).toBe("rgb(18, 18, 20)");
    expect(tags[0]!.hasAttribute("media")).toBe(false);
  });

  it("leaves the pair alone when the page has no background yet", () => {
    document.head.innerHTML = '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f7f8"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121214">';
    document.documentElement.style.backgroundColor = "";
    syncThemeColor();
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2);
  });
});
