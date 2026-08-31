/**
 * The filters every view on the fuel-spend page shares, held in the URL.
 *
 * ── WHY ONE OWNER AND NOT ONE PER TAB ────────────────────────────────────────────────────────────
 * Each tab used to carry its own idea of the period — the trend tab a rolling window of weeks, the
 * statement tabs a statement picker — so moving between them silently changed which days you were
 * looking at. A figure quoted off one tab and checked against another would disagree for a reason
 * neither screen showed. One set of filters, read by every tab and by the export.
 *
 * ── WHY THE URL ──────────────────────────────────────────────────────────────────────────────────
 * This page exists to be sent to somebody. State that dies on refresh cannot be linked, and a
 * screenshot of a filtered view is unreproducible by the person receiving it. Everything that changes
 * what the numbers mean — dates, trucks, grain, tab — is a query parameter.
 *
 * ── AND THEREFORE: ANYTHING CAN BE IN IT ─────────────────────────────────────────────────────────
 * A linkable window is one a human can hand-edit, bookmark, and forward months later. This module does
 * not trust it. Every read goes through `normalizeWindow` (`@silvicom/shared`) — pure, tested, and it
 * REPORTS what it corrected rather than correcting silently, so the page can say so (`windowNotice`).
 * Before that, a range typed backwards parsed fine and produced an empty report, which reads exactly
 * like a fleet that bought no fuel.
 */
import { computed } from "vue";
import { normalizeWindow, describeFixes, defaultWindow, type SpendGrain } from "@silvicom/shared";
import { useQueryState } from "@/composables/useQueryState";

/** Kept for existing importers; the span itself is `DEFAULT_WINDOW_DAYS` in `@silvicom/shared`. */
export const DEFAULT_DAYS = 90;

/** The grain a page opens on, and the one "Clear filters" returns to. */
export const DEFAULT_GRAIN: SpendGrain = "week";

const todayYmd = (): string => new Date().toISOString().slice(0, 10);

export interface SpendFilters {
  from: string;
  to: string;
  /** Vehicle ids to narrow to. Empty means the whole fleet — NOT "no trucks". */
  vehicleIds: string[];
  grain: SpendGrain;
  active: boolean;
}

export function useSpendFilters() {
  /**
   * The URL is this page's state (see the header note). The one-tick collision that used to weld the
   * date picker to 90 days is handled by `useQueryState`, promoted out of this file at R3a — the
   * buffer was never specific to dates, and the roster needs the same guarantee under D-ROS14.
   */
  const { one, list, set } = useQueryState();

  /**
   * The window, normalised. Every other consumer on this page reads THIS and never the raw query, so a
   * hand-edited link cannot reach a database query, a chart, or the PDF export.
   */
  const normalized = computed(() => normalizeWindow(one("from"), one("to"), todayYmd()));

  /**
   * Move both ends at once.
   *
   * The window is ONE fact with two halves, and writing it as two patches is what broke it. The ends
   * are normalised on the way IN as well as out, so the URL never carries a range the page would have
   * to correct when reading it back — a link and the view it produces stay the same thing.
   */
  function setWindow(nextFrom: string, nextTo: string): void {
    const n = normalizeWindow(nextFrom, nextTo, todayYmd());
    set({ from: n.window.from, to: n.window.to });
  }

  const from = computed<string>({
    get: () => normalized.value.window.from,
    set: (v) => setWindow(v, normalized.value.window.to),
  });
  const to = computed<string>({
    get: () => normalized.value.window.to,
    set: (v) => setWindow(normalized.value.window.from, v),
  });

  /** What normalisation corrected, as a sentence for the reader. Null when the link was sound. */
  const windowNotice = computed(() => describeFixes(normalized.value.fixes));

  const vehicleIds = computed<string[]>({
    get: () => list("trucks"),
    set: (v) => set({ trucks: v.length ? v.join(",") : undefined }),
  });
  const grain = computed<SpendGrain>({
    get: () => {
      const v = one("grain");
      return v === "day" || v === "month" ? v : DEFAULT_GRAIN;
    },
    set: (v) => set({ grain: v }),
  });
  const tab = computed<string>({
    get: () => one("tab") ?? "",
    set: (v) => set({ tab: v }),
  });

  /**
   * True when the reader has narrowed anything.
   *
   * A window EQUAL to the default counts as not narrowed even when the URL spells it out, because
   * "Clear filters" must not appear to do nothing: arriving via a link that pinned the default 90 days
   * used to light the button up, and pressing it left the screen identical.
   */
  const active = computed(() => {
    if (vehicleIds.value.length > 0) return true;
    // Grain sits in the same bar behind the same "Clear filters" button, so a reader who changed it
    // and pressed clear expected it to go back. It did not, and the button did not light up either.
    if (grain.value !== DEFAULT_GRAIN) return true;
    const d = defaultWindow(todayYmd());
    const w = normalized.value.window;
    return w.from !== d.from || w.to !== d.to;
  });

  const range = computed(() => ({ from: from.value, to: to.value }));
  /** Everything the server needs to reproduce this view, as query-string pairs. */
  const asQuery = computed(() => {
    const params = new URLSearchParams({ from: from.value, to: to.value, grain: grain.value });
    if (vehicleIds.value.length) params.set("vehicles", vehicleIds.value.join(","));
    return params.toString();
  });

  function reset(): void {
    set({ from: undefined, to: undefined, trucks: undefined, grain: undefined });
  }

  return { from, to, setWindow, windowNotice, vehicleIds, grain, tab, range, active, asQuery, reset };
}
