import { SURFACE_GROUPS } from "@silvicom/shared";
import { LAYER_LABELS, type AccessLayer } from "./layers";
import { SECTION_LABELS } from "./labels";
import type { SurfaceCatalogueEntry } from "./usePermissions";

/**
 * The row models the two tabs build and the two row lists render.
 *
 * The lists (`SectionRows`, `ScreenRows`) are deliberately ignorant of layers, defaults and
 * reachability — they draw what they are handed. Everything that DECIDES what a row shows lives in
 * the tab that knows whose answers these are, and the helpers here are the parts both tabs decide
 * the same way.
 */

/** The marker beside a control. Tones are the three the layer vocabulary needs and no more. */
export interface RowTag {
  label: string;
  tone: "neutral" | "info" | "brand";
}

/** A row on the Roles tab is either the shipped answer (no tag) or this organisation's (tagged). */
export const CHANGED_TAG: RowTag = { label: "Changed", tone: "info" };

/** A row on the People tab always says which of the three layers answered (D-SURF6). */
export function layerTag(layer: AccessLayer): RowTag {
  return {
    label: LAYER_LABELS[layer],
    tone: layer === "user" ? "brand" : layer === "role" ? "info" : "neutral",
  };
}

export interface ScreenRowModel {
  key: string;
  label: string;
  allowed: boolean;
  inherited: boolean;
  /** `false` when the principal's SECTION access does not reach this screen (D-SURF2). */
  reachable: boolean;
  /** What the section would have to be for the screen to be offered: "Fuel · Manage". */
  need: string;
  tag?: RowTag;
  reset?: string;
}

export interface ScreenGroupModel {
  key: string;
  label: string;
  rows: ScreenRowModel[];
}

/** "Fuel · Manage" — the section and level a screen sits behind, in the reader's words. */
export function needLabel(s: SurfaceCatalogueEntry): string {
  if (!s.section) return "";
  return `${SECTION_LABELS[s.section]} · ${s.level === "manage" ? "Manage" : "View"}`;
}

/**
 * The catalogue folded into the sidebar's own groups, in the sidebar's own order.
 *
 * A group in which NO screen is reachable is left out and named instead, so a technician's page
 * does not list Recruitment, Finance and Settings as fifteen rows of "needs a section they do not
 * hold". A group with SOME unreachable screens keeps them, each saying what it needs — that is the
 * D-SURF2 explanation at the cell, and the one place an admin learns why a tick is missing.
 */
export function groupScreens(
  surfaces: SurfaceCatalogueEntry[],
  row: (s: SurfaceCatalogueEntry) => ScreenRowModel,
): { groups: ScreenGroupModel[]; unlisted: string[] } {
  const groups: ScreenGroupModel[] = [];
  const unlisted: string[] = [];
  for (const g of SURFACE_GROUPS) {
    const rows = surfaces.filter((s) => s.group === g.key).map(row);
    if (rows.length === 0) continue;
    const label = g.label ?? "General";
    if (rows.some((r) => r.reachable)) groups.push({ key: g.key, label, rows });
    else unlisted.push(label);
  }
  return { groups, unlisted };
}
