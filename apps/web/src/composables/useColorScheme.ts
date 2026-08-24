import { computed, ref } from "vue";

/**
 * The colour-scheme preference (D-DS2b).
 *
 * ── Why this writes `color-scheme` and not a class ──────────────────────────────────────────────
 * Every themed token is a `light-dark()` pair, and `light-dark()` resolves against the element's
 * computed `color-scheme` — not against a selector. So the entire toggle is one CSS property on
 * `<html>`. There is no `.dark` class, no `@custom-variant`, and no `dark:` variant anywhere in
 * apps/web; that is the whole reason D-DS2 was built this way.
 *
 * Setting the property also tells the browser which scheme is active, so native form controls,
 * scrollbars, `Highlight` and the rest follow without being restyled. A class could never do that.
 *
 * ── "system" is a real state, not the absence of one ────────────────────────────────────────────
 * `color-scheme: light dark` means "both supported, follow the user's OS". `light` or `dark` alone
 * pins it. So the three states map onto one property with no extra machinery, and clearing the
 * stored preference genuinely returns to following the system rather than freezing whatever the
 * system happened to be at the time.
 */
export type ColorScheme = "system" | "light" | "dark";

const STORAGE_KEY = "fg.color-scheme";
const SCHEMES: readonly ColorScheme[] = ["system", "light", "dark"];

function read(): ColorScheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SCHEMES.includes(stored as ColorScheme) ? (stored as ColorScheme) : "system";
  } catch {
    // Safari in private mode throws on localStorage access rather than returning null.
    return "system";
  }
}

/** Module-level so every caller shares one value — the preference is global, not per-component. */
const scheme = ref<ColorScheme>(read());

function paint(value: ColorScheme) {
  const root = document.documentElement;
  root.style.colorScheme = value === "system" ? "light dark" : value;
}

/**
 * Applied before mount so the first paint is already correct. `index.html` cannot do this — the
 * preference lives in localStorage and the token layer defaults to `light dark`, so a system-follow
 * user sees the right scheme immediately and only an explicit override needs replaying.
 */
export function initColorScheme() {
  paint(scheme.value);
}

export function useColorScheme() {
  function set(value: ColorScheme) {
    scheme.value = value;
    paint(value);
    try {
      if (value === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // A preference that cannot be stored still applies for this session.
    }
  }

  return {
    scheme: computed(() => scheme.value),
    set,
    /** Cycles system → light → dark → system, for a single-control affordance. */
    cycle: () => set(SCHEMES[(SCHEMES.indexOf(scheme.value) + 1) % SCHEMES.length]!),
  };
}
