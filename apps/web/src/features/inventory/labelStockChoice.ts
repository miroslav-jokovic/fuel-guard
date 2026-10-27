import type { LabelPresetId } from "@silvicom/qr";

/**
 * Which label stock the Labels screen opens on (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5, R6).
 *
 * ── THE PRINTER IS A FIXTURE, SO THE STOCK IS REMEMBERED ──────────────────────────────────────
 * Until 2026-10-27 the screen opened on Avery 22805 every visit. The shop's printer is a MUNBYN
 * direct-thermal roll printer loaded with 2" × 2" labels, and a person who forgot to switch the
 * stock sent a Letter-sized sheet of 24 labels to it — the printer feeds a whole roll's worth of
 * blank labels, or scales the page onto one label so every code is unreadable. The choice is a
 * property of the desk the printer sits on, not of one visit, so it is kept in this browser.
 *
 * ── localStorage AND NOT A SERVER SETTING ─────────────────────────────────────────────────────
 * The office PC printing onto the roll and a laptop printing onto Avery sheets are both right at
 * once; an org-wide setting would make one of them wrong. Per browser is per printer, near enough.
 *
 * ── A REMEMBERED ID IS CHECKED AGAINST WHAT THE API OFFERS ───────────────────────────────────
 * The list comes from the server (`useLabelPresetsQuery` says why). An id remembered from an older
 * release that the API no longer offers would print as a 422 at the end of the flow, so it is only
 * used while the server still lists it; otherwise the roll, otherwise the first stock offered.
 */
const STORAGE_KEY = "silvicom:labels:preset";

/** The stock the shop actually bought (D-DE7). */
export const DEFAULT_LABEL_PRESET: LabelPresetId = "roll-single";

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari in private mode throws on localStorage access rather than returning null.
    return null;
  }
}

export function pickLabelPreset(offered: readonly { id: LabelPresetId }[]): LabelPresetId | null {
  const ids = offered.map((p) => p.id);
  const kept = remembered();
  if (kept && (ids as string[]).includes(kept)) return kept as LabelPresetId;
  if (ids.includes(DEFAULT_LABEL_PRESET)) return DEFAULT_LABEL_PRESET;
  return ids[0] ?? null;
}

export function rememberLabelPreset(id: LabelPresetId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // A choice that cannot be stored still applies for this visit.
  }
}
