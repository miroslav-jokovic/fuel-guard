import type { Icon } from "@silvicom/ui/icons";
import type { NavGroup } from "./nav";

/**
 * "Go to a page" — the ⌘K palette's list and its matching (SIDEBAR-REDESIGN-PLAN.md D-SB1; it closes
 * DESIGN-REFRESH-2026-09.md D-DR16's page half).
 *
 * ── Why it has no list of its own ───────────────────────────────────────────────────────────────
 * The entries are the caller's sidebar (`buildNavGroups`) plus the Settings screens the Settings
 * page itself would show them (`visibleSettingsScreens`). Both are already the guard's answer, so
 * the palette cannot offer a page the router turns away, and a screen added to the catalogue appears
 * here without anybody remembering to add it. A palette with its own table would be the third copy
 * of the sidebar `surfaces.ts` spent a plan getting rid of.
 *
 * ── Pages here, records beside ──────────────────────────────────────────────────────────────────
 * This file matches page NAMES, which are all in hand and need no server. Trucks, trailers, drivers
 * and loads (Q-SB1, ruled D-SB8) are found by the server and only arrive as entries of the same shape:
 * `recordSearch.ts` says who may search which, `useRecordSearch` runs the reads.
 */

export interface PaletteEntry {
  key: string;
  name: string;
  to: string;
  icon: Icon;
  /** Where it lives, shown on the right and searchable: "Dispatch", "Settings". Null for top items. */
  section: string | null;
  /** A record's second line — "Freightliner Cascadia", "ACME FOODS · Ana Petrovic". Pages have none. */
  detail?: string | null;
}

export interface SettingsScreenEntry {
  key: string;
  name: string;
  to: string;
  icon: Icon;
}

/** Sidebar order first (the order people already know), then the Settings screens; one row per path. */
export function paletteEntries(groups: readonly NavGroup[], settings: readonly SettingsScreenEntry[]): PaletteEntry[] {
  const seen = new Set<string>();
  const out: PaletteEntry[] = [];
  const add = (e: PaletteEntry) => {
    if (seen.has(e.to)) return;
    seen.add(e.to);
    out.push(e);
  };
  for (const g of groups) for (const i of g.items) add({ key: i.key, name: i.name, to: i.to, icon: i.icon, section: g.label });
  for (const s of settings) add({ ...s, section: "Settings" });
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * How well one entry answers the query — lower is better, `null` is no match. Every typed word has
 * to land somewhere, so "fuel inv" finds Pilot invoices and not every fuel page.
 *
 *   0  the name starts with the whole query          "fuel c"  → Fuel cards, Fuel costs
 *   1  every word starts a word of the name          "cards"   → Fuel cards
 *   2  every word is inside the name                 "voice"   → Pilot invoices
 *   3  some words only match the section             "safety"  → every Safety page
 */
export function scoreEntry(entry: PaletteEntry, query: string): number | null {
  const q = norm(query).trim();
  if (!q) return 0;
  const name = norm(entry.name);
  if (name.startsWith(q)) return 0;
  const terms = words(q);
  if (terms.length === 0) return null;
  const nameWords = words(entry.name);
  const sectionWords = entry.section ? words(entry.section) : [];
  let worst = 1;
  for (const t of terms) {
    if (nameWords.some((w) => w.startsWith(t))) continue;
    if (name.includes(t)) worst = Math.max(worst, 2);
    else if (sectionWords.some((w) => w.startsWith(t))) worst = 3;
    else return null;
  }
  return worst;
}

/** Matches, best first; ties keep sidebar order, which is a stable sort's whole job here. */
export function searchPalette(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  return entries
    .map((e, i) => ({ e, i, s: scoreEntry(e, query) }))
    .filter((r): r is { e: PaletteEntry; i: number; s: number } => r.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((r) => r.e);
}
