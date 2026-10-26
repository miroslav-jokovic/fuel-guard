import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ApplyLayout from "./ApplyLayout.vue";
import { APPLY_LANGUAGE_KEY, applyLanguage } from "@/features/apply/language";
import { APPLY_COPY_ES } from "@/features/apply/es/strings.es";
import { APPLY_COPY_EN } from "@/features/apply/strings";

/**
 * The applicant's layout and the page's language (Q-AW11, C4): the device's choice is taken up when the
 * layout mounts, the header's switch flips it and the chrome follows, and the choice is put down when
 * the layout goes — so an office screen in the same browser is English again.
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
  it("opens in the language this device chose last time, and the chrome is in it", () => {
    localStorage.setItem(APPLY_LANGUAGE_KEY, "es");
    const w = mountLayout();
    expect(applyLanguage.value).toBe("es");
    expect(w.find("header").text()).toContain(APPLY_COPY_ES.layout.untitled);
    expect(w.find("footer").text()).toContain(APPLY_COPY_ES.layout.collectedFor);
    expect(w.find("header button").text()).toBe(APPLY_COPY_ES.layout.switchTo);
  });

  it("switches on the header's button, keeps the choice, and the chrome follows", async () => {
    const w = mountLayout();
    expect(w.find("header button").text()).toBe(APPLY_COPY_EN.layout.switchTo);
    await w.find("header button").trigger("click");
    expect(applyLanguage.value).toBe("es");
    expect(localStorage.getItem(APPLY_LANGUAGE_KEY)).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(w.find("footer").text()).toContain(APPLY_COPY_ES.layout.processedBy);
    await w.find("header button").trigger("click");
    expect(applyLanguage.value).toBe("en");
    expect(w.find("footer").text()).toContain(APPLY_COPY_EN.layout.processedBy);
  });

  it("puts the language down when the layout goes", () => {
    localStorage.setItem(APPLY_LANGUAGE_KEY, "es");
    const w = mountLayout();
    expect(applyLanguage.value).toBe("es");
    w.unmount();
    expect(applyLanguage.value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
