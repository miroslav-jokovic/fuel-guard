import type { Surface } from "@silvicom/shared";

/** The workspace's home: its one sidebar entry. */
export const ADS_HOME_KEY = "ads.overview";
/**
 * Settings is the one tab with its own grant (`admin.recruiting.ads`, a card on Settings too), so it is not a child
 * of the home in the catalogue and is named here — the single fact this file adds. Its catalogue label is the
 * Settings card's ("Ads control"); inside the workspace the tab says what it is among its neighbours.
 */
export const ADS_SETTINGS_KEY = "admin.recruiting.ads";

export interface AdsWorkspaceTab { surface: Surface; path: string; label: string }

/**
 * The tabs, DERIVED from the catalogue: the home, then its children in catalogue order, then Settings. A screen added
 * to the catalogue with `parent: "ads.overview"` is a tab without an edit here.
 */
export function adsWorkspaceTabs(surfaces: readonly Surface[]): AdsWorkspaceTab[] {
  const home = surfaces.find((s) => s.key === ADS_HOME_KEY);
  const settings = surfaces.find((s) => s.key === ADS_SETTINGS_KEY);
  const children = surfaces.filter((s) => s.parent === ADS_HOME_KEY && !s.path.includes(":"));
  return [
    ...(home ? [{ surface: home, path: home.path, label: home.label }] : []),
    ...children.map((s) => ({ surface: s, path: s.path, label: s.label })),
    ...(settings ? [{ surface: settings, path: settings.path, label: "Settings" }] : []),
  ];
}
