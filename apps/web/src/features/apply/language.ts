import { ref } from "vue";

/**
 * The applicant's page in two languages (APPLICATION-FLOW-V2-PLAN Q-AW11 ruled EN+ES; AW13, batch C4;
 * owner 2026-10-21).
 *
 * ── WHAT A LANGUAGE IS HERE ───────────────────────────────────────────────────────────────────
 * One ref, `applyLanguage`, and one object per language with the same keys. `APPLY_COPY` stays the
 * single thing sixty-nine components read (`strings.ts`, A3: "strings here make it a second object") —
 * it is now a view over whichever object the ref names, so no component changed to get Spanish and no
 * component can get it half-way. The view is a `Proxy` whose every read re-picks the language, which is
 * why a template reading `APPLY_COPY.nav.next` re-renders when the ref changes: the read touched the
 * ref. A module-level `const copy = APPLY_COPY.partOne` keeps working for the same reason — it holds a
 * view of that branch, not a copy of one language's words. ⚠ The one thing that does NOT follow the
 * switch is a leaf captured at setup (`const label = APPLY_COPY.nav.next`), so `ApplyPage` keys the
 * screen chain by language and a switch remounts it; the page's own state sits above that key.
 *
 * ── WHAT STAYS ENGLISH, ON PURPOSE ────────────────────────────────────────────────────────────
 * The legal instruments — the e-sign consent, the six permissions, the text-message consent, the
 * packet, the handbook, the FCRA summary — are served by the API in the words counsel approved, and
 * are signed in those words. Q-AW11: they stay English, with a reading aid in Spanish
 * (`APPLY_COPY.englishDocuments`) until counsel approves a translation. The schema's own messages
 * (`packages/shared`'s "at least 18") are English too; they are reached only past the screen's own
 * blank-field sentences, which are translated.
 *
 * ── WHERE THE CHOICE LIVES ────────────────────────────────────────────────────────────────────
 * On the device (`localStorage`), chosen by a switch in the page's header, defaulting to the browser's
 * language the first time. It is the APPLICANT's page's language: `ApplyLayout` takes it up on mount
 * and puts it down on unmount, so the office's screens that share this copy (the review drawer's
 * summary) stay English whatever a recruiter once chose on an applicant's link in the same browser.
 */

export const APPLY_LANGUAGES = ["en", "es"] as const;
export type ApplyLanguage = (typeof APPLY_LANGUAGES)[number];
export const APPLY_LANGUAGE_KEY = "silvicom-apply-language";

export const isApplyLanguage = (v: unknown): v is ApplyLanguage =>
  typeof v === "string" && (APPLY_LANGUAGES as readonly string[]).includes(v);

/** What the page opens in: this device's last choice, else the browser's language, else English. */
export function initialApplyLanguage(stored: string | null | undefined, browser: string | null | undefined): ApplyLanguage {
  if (isApplyLanguage(stored)) return stored;
  return (browser ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

/** English until the applicant's layout mounts; see the header. */
export const applyLanguage = ref<ApplyLanguage>("en");

const setDocumentLanguage = (lang: ApplyLanguage): void => {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
};

export function rememberedApplyLanguage(): ApplyLanguage {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(APPLY_LANGUAGE_KEY);
  } catch {
    // Storage blocked (a private window): the browser's language decides, and nothing is remembered.
  }
  return initialApplyLanguage(stored, typeof navigator === "undefined" ? null : navigator.language);
}

export function setApplyLanguage(lang: ApplyLanguage): void {
  applyLanguage.value = lang;
  try {
    localStorage.setItem(APPLY_LANGUAGE_KEY, lang);
  } catch {
    // Not remembered; still switched.
  }
  setDocumentLanguage(lang);
}

/** `ApplyLayout` on mount: the device's choice takes effect. */
export function enterApplyLanguage(): void {
  applyLanguage.value = rememberedApplyLanguage();
  setDocumentLanguage(applyLanguage.value);
}

/** `ApplyLayout` on unmount: the rest of the product is English. */
export function leaveApplyLanguage(): void {
  applyLanguage.value = "en";
  setDocumentLanguage("en");
}

/**
 * The shape of a copy object with its words widened: an English literal becomes `string`, a phrase
 * function keeps its arguments, an array of lines stays an array. This is the type every language's
 * object satisfies, and the type `APPLY_COPY` has — so a Spanish object missing a key, or carrying one
 * English has not, fails `vue-tsc` before any runtime test sees it.
 */
export type Localized<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : T extends readonly (infer U)[]
      ? readonly Localized<U>[]
      : T extends object
        ? { readonly [K in keyof T]: Localized<T[K]> }
        : T;

function viewOver<T extends object>(current: () => T, shape: T): T {
  return new Proxy(shape, {
    get(_shape, key) {
      const now = current();
      const value = Reflect.get(now, key, now) as unknown;
      // Branches are views too, so a branch held at module level follows the switch. Leaves — words,
      // phrase functions, arrays of lines — are the current language's own and are handed over as is.
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return viewOver(() => Reflect.get(current(), key) as object, Reflect.get(shape, key) as object);
      }
      return value;
    },
  }) as T;
}

/** One object per language in, one object out: every read answers in `applyLanguage`'s. */
export function localized<T extends object>(versions: Record<ApplyLanguage, T>): T {
  return viewOver(() => versions[applyLanguage.value] ?? versions.en, versions.en);
}
