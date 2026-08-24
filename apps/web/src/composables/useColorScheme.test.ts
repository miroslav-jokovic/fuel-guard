import { beforeEach, describe, expect, it } from "vitest";
import { initColorScheme, useColorScheme } from "@/composables/useColorScheme";

/**
 * The colour-scheme preference (D-DS2b).
 *
 * Worth pinning because the whole of dark mode hangs off one CSS property: every themed token is a
 * `light-dark()` pair, and `light-dark()` resolves against the computed `color-scheme` rather than
 * any selector. If this composable stops writing that property, nothing throws and no test fails —
 * the app simply stops honouring the user's choice, silently, in the one place nobody has a
 * screenshot of because it sits behind the login wall.
 */
/**
 * This suite installs its own storage, because the repo's jsdom has none — `localStorage` is
 * undefined bare, on `window` and on `globalThis`. That is worth knowing rather than working
 * around: it means the composable's try/catch is not defensive decoration, it is the path this
 * project's own test run takes, and the "degrades without storage" case below is the one that
 * actually reproduces in CI.
 */
function installStorage(): Storage {
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
  return storage;
}

describe("useColorScheme", () => {
  beforeEach(() => {
    installStorage();
    document.documentElement.style.colorScheme = "";
    useColorScheme().set("system");
  });

  it("follows the operating system until told otherwise", () => {
    const { scheme } = useColorScheme();
    expect(scheme.value).toBe("system");
    // "light dark" is the CSS for "both supported, follow the user" — not the absence of a choice.
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("pins the scheme by writing color-scheme, which is what light-dark() reads", () => {
    const { set } = useColorScheme();
    set("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    set("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("remembers an explicit choice and replays it on the next load", () => {
    useColorScheme().set("dark");
    expect(localStorage.getItem("fg.color-scheme")).toBe("dark");

    document.documentElement.style.colorScheme = "";
    initColorScheme();
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("returns to following the system rather than freezing the current scheme", () => {
    const { set, scheme } = useColorScheme();
    set("dark");
    set("system");
    expect(scheme.value).toBe("system");
    expect(localStorage.getItem("fg.color-scheme")).toBeNull();
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("shares one preference across callers, because the choice is global", () => {
    const a = useColorScheme();
    const b = useColorScheme();
    a.set("dark");
    expect(b.scheme.value).toBe("dark");
  });

  it("cycles system → light → dark → system for a single-control affordance", () => {
    const { cycle, scheme } = useColorScheme();
    expect(scheme.value).toBe("system");
    cycle();
    expect(scheme.value).toBe("light");
    cycle();
    expect(scheme.value).toBe("dark");
    cycle();
    expect(scheme.value).toBe("system");
  });

  it("still applies a choice when storage is unavailable", () => {
    // Safari private mode throws on access; this project's own jsdom has no storage at all. Either
    // way the preference must still take effect for the session rather than throwing on click.
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("storage disabled");
      },
      configurable: true,
    });
    const { set, scheme } = useColorScheme();
    expect(() => set("dark")).not.toThrow();
    expect(scheme.value).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    installStorage();
  });
});
