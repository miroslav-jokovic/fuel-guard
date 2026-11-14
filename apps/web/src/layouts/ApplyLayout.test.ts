import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ApplyLayout from "./ApplyLayout.vue";
import { APPLY_LANGUAGE_KEY, applyLanguage, setApplyLanguage } from "@/features/apply/language";
import { APPLY_COPY_ES } from "@/features/apply/es/strings.es";
import { APPLY_COPY_EN } from "@/features/apply/strings";

/**
 * The applicant's layout and the page's language (Q-AW11, C4; English only since the owner's 2026-11-13
 * ruling): a device that chose Spanish opens in English with no switch in the header, the chrome still
 * follows the page's language, and the language is put down when the layout goes — so an office screen
 * in the same browser is English.
 */

function installStorage(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

beforeEach(() => {
  installStorage();
  applyLanguage.value = "en";
});
afterEach(() => {
  applyLanguage.value = "en";
});

const mountLayout = () => mount(ApplyLayout, { props: { carrier: null }, slots: { default: "<p>body</p>" } });

describe("the applicant's layout and the page's language", () => {
  it("opens in English on a device that chose Spanish last time, and offers no switch", () => {
    localStorage.setItem(APPLY_LANGUAGE_KEY, "es");
    const w = mountLayout();
    expect(applyLanguage.value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(w.find("header").text()).toContain(APPLY_COPY_EN.layout.untitled);
    expect(w.find("footer").text()).toContain(APPLY_COPY_EN.layout.collectedFor);
    expect(w.find("header button").exists()).toBe(false);
  });

  it("follows the page's language in its chrome, and puts the language down when the layout goes", async () => {
    const w = mountLayout();
    setApplyLanguage("es");
    await w.vm.$nextTick();
    expect(w.find("footer").text()).toContain(APPLY_COPY_ES.layout.processedBy);
    w.unmount();
    expect(applyLanguage.value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
