import type { RouteLocationRaw } from "vue-router";
import type { PaletteEntry } from "./commandPalette";

/**
 * The ⌘K palette's record half — trucks, trailers, drivers and loads by what the office calls them
 * (SIDEBAR-REDESIGN-PLAN.md Q-SB1, ruled D-SB8). The page half is `commandPalette.ts`.
 *
 * ── WHO MAY SEARCH WHAT, AND WHY IT IS TWO QUESTIONS ────────────────────────────────────────────
 * A kind is searched only when its LIST page is in the caller's palette AND its DETAIL page opens.
 * The list answer is the sidebar's (`buildNavGroups`), which knows the org's modules: an org without
 * Dispatch has no Loads page and the API refuses its load reads with a 403, so offering loads would
 * be a promise the server breaks. The detail answer is the router guard's own (`useOpens`), which
 * knows the person's screens: a result is a link, and a link is shown exactly when its target opens
 * (SP5). Neither is restated here — both are read from where they are already decided.
 *
 * The rows themselves come back through the reads the list pages already use: trucks, trailers and
 * drivers from PostgREST under RLS, loads from `/api/dispatch/loads/search`, org-filtered on the
 * server. So a person finds exactly the records their list pages would have shown them.
 *
 * Each kind wears its list page's icon and name, taken from the same entry: "Vehicles" rather than a
 * fifth word for a truck while Q-SB4 is open.
 */

export type RecordKind = "truck" | "trailer" | "driver" | "load";

export interface RecordKindDef {
  kind: RecordKind;
  /** The list page whose presence in the palette offers this kind. */
  list: string;
  detail: (id: string) => string;
  /** How the placeholder names one of them. */
  noun: string;
}

export const RECORD_KINDS: readonly RecordKindDef[] = [
  { kind: "truck", list: "/vehicles", detail: (id) => `/vehicles/${id}`, noun: "truck" },
  { kind: "trailer", list: "/trailers", detail: (id) => `/trailers/${id}`, noun: "trailer" },
  { kind: "driver", list: "/drivers", detail: (id) => `/drivers/${id}`, noun: "driver" },
  { kind: "load", list: "/loads", detail: (id) => `/loads/${id}`, noun: "load" },
];

/** A searchable kind, carrying the list entry whose icon and name its results wear. */
export interface SearchableKind extends RecordKindDef {
  listEntry: PaletteEntry;
}

/** The kinds this caller may search, in `RECORD_KINDS` order. See the header for the two questions. */
export function searchableKinds(entries: readonly PaletteEntry[], opens: (to: RouteLocationRaw) => boolean): SearchableKind[] {
  const out: SearchableKind[] = [];
  for (const def of RECORD_KINDS) {
    const listEntry = entries.find((e) => e.to === def.list);
    // Any id resolves to the declared `/x/:id` route, which is what the guard is keyed on.
    if (listEntry && opens(def.detail("_"))) out.push({ ...def, listEntry });
  }
  return out;
}

/** "Go to a page, truck, driver or load…" — naming only what this caller can actually find. */
export function searchPlaceholder(kinds: readonly SearchableKind[]): string {
  const things = ["page", ...kinds.map((k) => k.noun)];
  const list = things.length === 1 ? things[0] : `${things.slice(0, -1).join(", ")} or ${things.at(-1)}`;
  return `Go to a ${list}…`;
}

/** One record found, before it becomes a palette row. */
export interface RecordHit {
  id: string;
  name: string;
  detail: string | null;
}

export function recordEntry(kind: SearchableKind, hit: RecordHit): PaletteEntry {
  return {
    key: `record:${kind.kind}:${hit.id}`,
    name: hit.name,
    to: kind.detail(hit.id),
    icon: kind.listEntry.icon,
    section: kind.listEntry.name,
    detail: hit.detail,
  };
}

/**
 * A PostgREST `.or()` filter matching `pattern` in any of `columns`. Values are double-quoted because
 * `.` and `,` are `.or()` syntax and a unit "T-1.2" holds a dot; `recordSearchTerm` has already removed
 * the `"` and `\` that would end a quoted value early.
 */
export function anyColumnIlike(columns: readonly string[], pattern: string): string {
  return columns.map((c) => `${c}.ilike."${pattern}"`).join(",");
}

/** The words under a name: the parts present, in order, joined with a middle dot. */
export function detailOf(...parts: (string | number | null | undefined)[]): string | null {
  const kept = parts.map((p) => (p == null ? "" : String(p).trim())).filter(Boolean);
  return kept.length ? kept.join(" · ") : null;
}
