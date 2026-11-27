import { matchesDriverSearch, type HomeTimePeriod, type HomeTimeState } from "@silvicom/shared";
import { HOME_TIME_STATE_BADGE } from "@/components/homeTime/homeTimeView";

/**
 * The Home time tab's rows (HOME-TIME-VISIBILITY-PLAN D-HT23, step HV3): the search and a state choice,
 * pure so the counts and the list are tested together.
 *
 * The tab had a search box and nothing else, so "who is overdue" meant reading the whole list. Each list
 * now offers its own states — the live list Overdue, Home, Scheduled; the closed list Ended and Canceled,
 * which it used to mix — and every option carries the number of rows it leaves, counted by the same
 * predicate with the search as typed (the D-DQ18 promise: the number on the option is the rows behind it).
 */
export type HomeTimeTabShow = "live" | "recent";

export const TAB_STATES: Record<HomeTimeTabShow, readonly HomeTimeState[]> = {
  live: ["overdue", "active", "scheduled"],
  recent: ["ended", "canceled"],
};

/** A state this list does not hold — or a hand-edited `?ht.state=` — is no filter. */
export const tabState = (show: HomeTimeTabShow, raw: string): HomeTimeState | "" =>
  (TAB_STATES[show] as readonly string[]).includes(raw) ? (raw as HomeTimeState) : "";

const searched = (rows: readonly HomeTimePeriod[], term: string): HomeTimePeriod[] =>
  term.trim() ? rows.filter((p) => matchesDriverSearch(term, { names: [p.driverName, p.markedByName], units: [p.unitNumber] })) : [...rows];

export function filterHomeTimes(rows: readonly HomeTimePeriod[], f: { show: HomeTimeTabShow; term: string; state: string }): HomeTimePeriod[] {
  const state = tabState(f.show, f.state);
  const hits = searched(rows, f.term);
  return state ? hits.filter((p) => p.state === state) : hits;
}

/** "All (4)", "Overdue (1)", … for this list, with the search applied. */
export function homeTimeStateOptions(rows: readonly HomeTimePeriod[], f: { show: HomeTimeTabShow; term: string }): { value: string; label: string }[] {
  const hits = searched(rows, f.term);
  return [
    { value: "", label: `All (${hits.length})` },
    ...TAB_STATES[f.show].map((s) => ({ value: s, label: `${HOME_TIME_STATE_BADGE[s].label} (${hits.filter((p) => p.state === s).length})` })),
  ];
}
