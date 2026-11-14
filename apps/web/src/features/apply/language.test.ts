import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computed, nextTick, watchEffect } from "vue";
import {
  APPLY_LANGUAGE_KEY,
  APPLY_LANGUAGES_OFFERED,
  applyLanguage,
  enterApplyLanguage,
  initialApplyLanguage,
  leaveApplyLanguage,
  localized,
  offersLanguageChoice,
  setApplyLanguage,
} from "./language";

/**
 * The language switch (Q-AW11, C4): what the page opens in, that the choice is kept on the device and
 * put down when the applicant's layout goes, and that a localized object answers every read — a leaf,
 * a branch held at module level, a phrase function, an array of lines — in the current language and
 * makes a computed over it follow the switch.
 */

/** The repo's jsdom has no storage (`useColorScheme.test.ts` installs the same stub, for the same reason). */
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
afterEach(() => leaveApplyLanguage());

describe("which language the page opens in", () => {
  it("is the device's last choice first, then the browser's, then English, when both are offered", () => {
    const both = ["en", "es"] as const;
    expect(initialApplyLanguage("es", "en-US", both)).toBe("es");
    expect(initialApplyLanguage("en", "es-MX", both)).toBe("en");
    expect(initialApplyLanguage(null, "es-419", both)).toBe("es");
    expect(initialApplyLanguage(null, "ES", both)).toBe("es");
    expect(initialApplyLanguage(null, "en-GB", both)).toBe("en");
    expect(initialApplyLanguage("fr", "fr-FR", both)).toBe("en");
    expect(initialApplyLanguage(undefined, undefined, both)).toBe("en");
  });

  it("is English only for now: a phone in Spanish, or one that chose Spanish before, opens in English", () => {
    expect(APPLY_LANGUAGES_OFFERED).toEqual(["en"]);
    expect(offersLanguageChoice()).toBe(false);
    expect(offersLanguageChoice(["en", "es"])).toBe(true);
    expect(initialApplyLanguage("es", "es-MX")).toBe("en");
    expect(initialApplyLanguage(null, "es-419")).toBe("en");
    expect(initialApplyLanguage("en", "en-US")).toBe("en");
  });

  it("keeps a choice on the device and on the document, and puts it down when the layout goes", () => {
    setApplyLanguage("es");
    expect(localStorage.getItem(APPLY_LANGUAGE_KEY)).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    leaveApplyLanguage();
    expect(applyLanguage.value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    // Taken up again only if it is offered: the remembered Spanish opens in English.
    enterApplyLanguage();
    expect(applyLanguage.value).toBe("en");
  });
});

describe("a localized object", () => {
  const en = {
    nav: { next: "Next" },
    greet: (name: string): string => `Hello ${name}`,
    lines: ["one", "two"],
    deep: { er: { word: "cheese" } },
  };
  const es = {
    nav: { next: "Siguiente" },
    greet: (name: string): string => `Hola ${name}`,
    lines: ["uno", "dos"],
    deep: { er: { word: "queso" } },
  };
  const copy = localized({ en, es });

  it("answers a leaf, a phrase function and an array in the current language", () => {
    expect(copy.nav.next).toBe("Next");
    setApplyLanguage("es");
    expect(copy.nav.next).toBe("Siguiente");
    expect(copy.greet("Ana")).toBe("Hola Ana");
    expect(copy.lines).toEqual(["uno", "dos"]);
    expect(copy.deep.er.word).toBe("queso");
  });

  it("lets a branch held at module level follow the switch", () => {
    const nav = copy.nav;
    expect(nav.next).toBe("Next");
    setApplyLanguage("es");
    expect(nav.next).toBe("Siguiente");
  });

  it("is reactive: a computed over it changes with the ref", async () => {
    const label = computed(() => copy.nav.next);
    const seen: string[] = [];
    watchEffect(() => seen.push(label.value));
    setApplyLanguage("es");
    await nextTick();
    expect(seen).toEqual(["Next", "Siguiente"]);
  });

  it("walks like a plain object, so the copy gate reaches every language's words", () => {
    expect(Object.keys(copy)).toEqual(["nav", "greet", "lines", "deep"]);
    setApplyLanguage("es");
    expect(Object.entries(copy.nav)).toEqual([["next", "Siguiente"]]);
  });
});
