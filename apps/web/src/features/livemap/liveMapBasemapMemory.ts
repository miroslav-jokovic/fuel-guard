/**
 * The basemap choice, remembered for the window (Q-DR36 candidate (a), HANDOFF-2026-11-10 §10.4
 * gap 1; M3).
 *
 * ── WHY REMEMBER IT NOW, WHEN D-DR6'S NOTE SAID NOT TO ────────────────────────────────────────────
 * The basemap was deliberately not remembered: D-DR6's panel memory had left a dispatcher opening
 * the map weeks later with a panel stored closed and no visible way back, and a basemap stored
 * weeks ago is the same trap. The vector trial changes the arithmetic. If it becomes the default
 * with "Map (classic)" kept as the way back for two weeks (D-DR33), a dispatcher who needs the
 * classic map would pick it on every page load, several times a shift, for two weeks — and the
 * vector map's fallback on a style error (gap 5) has nowhere to leave a reader if nothing is kept.
 *
 * ── WHY THE WINDOW, NOT THE DEVICE ───────────────────────────────────────────────────────────────
 * `sessionStorage`: it survives a reload and a deploy's forced refresh in that tab, which is what
 * "I picked this an hour ago" needs, and it dies with the tab, so nothing picked during the trial
 * lingers for months the way a device preference would. That is the difference from D-DR6's trap:
 * the longest anything is remembered is one tab's life.
 *
 * ── WHY A CHOICE THAT IS NO LONGER OFFERED IS DROPPED ────────────────────────────────────────────
 * The trial entry exists only where the build names an environment (`vectorTrialOffered`), and
 * either the trial ends or "Map (classic)" goes after two weeks. A remembered key the menu no longer
 * lists would put the map on a basemap the reader cannot see named anywhere and cannot pick again;
 * so the memory is read against what the menu offers today, and anything else falls back.
 *
 * ⚠ Storage is taken as a parameter so the rules are tested without a browser; the default is the
 * window's, or nothing where there is none (Safari private mode throws on access, so that is a
 * read inside a try, not a feature test).
 */
import { BASEMAP_CHOICES } from "@silvicom/shared";
import { VECTOR_TRIAL_CHOICE, vectorTrialOffered } from "@/composables/vectorBasemap";

export const BASEMAP_MEMORY_KEY = "livemap:basemap";

type BasemapStorage = Pick<Storage, "getItem" | "setItem">;

function windowStorage(): BasemapStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The keys the basemap menu offers in this build: the catalogue, plus the trial where it is on. */
export function offeredBasemaps(): readonly string[] {
  const keys = BASEMAP_CHOICES.map((c) => c.key);
  return vectorTrialOffered() ? [...keys, VECTOR_TRIAL_CHOICE.key] : keys;
}

/**
 * The basemap this window last picked, if the menu still offers it; `fallback` otherwise, including
 * when there is no storage or reading it throws.
 */
export function rememberedBasemap<T extends string>(
  offered: readonly string[],
  fallback: T,
  storage: BasemapStorage | null = windowStorage(),
): T {
  try {
    const stored = storage?.getItem(BASEMAP_MEMORY_KEY);
    return stored !== null && stored !== undefined && offered.includes(stored) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Keeps the choice for this window. A storage that refuses (quota, private mode) is not an error. */
export function rememberBasemap(choice: string, storage: BasemapStorage | null = windowStorage()): void {
  try {
    storage?.setItem(BASEMAP_MEMORY_KEY, choice);
  } catch {
    /* a map that cannot be remembered still draws */
  }
}
