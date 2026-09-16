/**
 * One person's Dashboard arrangement — `/api/dashboard-layout`, table `user_dashboard_layout` (0343).
 *
 * D-DW2/D-DW3, `docs/plans/livemap/LIVE-MAP-PLAN.md` step LM10. The migration header carries the
 * schema argument; this file carries the meaning of the stored value, because the meaning is the
 * part that both the API and the browser have to agree on exactly.
 *
 * ── A LAYOUT CANNOT GRANT A WIDGET, AND THE SIGNATURE IS HOW THAT IS ENFORCED ────────────────────
 * `resolveDashboardLayout` is never handed `DASHBOARD_WIDGETS`. It is handed the widgets this caller
 * already passed the gates for, and it may only drop and reorder them. That is deliberate: a stored
 * key naming a widget the caller may not see cannot become visible here, because the function has no
 * way to look one up. The alternative — pass the catalogue and re-check the gate inside — would put
 * a second copy of the permission decision in the one file that must not hold one.
 *
 * ── THE THREE STATES (D-DW3) ────────────────────────────────────────────────────────────────────
 *   · `null`                  — no row. Inherit the role default.
 *   · `{ widgetKeys: [], … }` — a row with nothing kept. "Show me nothing", and it stays that way.
 *   · a list                  — those widgets, in that order.
 *
 * An explicit "show me nothing" and "I have not chosen" must be distinguishable or a default can
 * never be changed again for anybody who once touched the setting. Same shape, same reason, as the
 * per-user surface reset (S3/S4).
 *
 * ── AND THE FOURTH THING, WHICH IS NOT A STATE BUT A GAP ────────────────────────────────────────
 * A widget in NEITHER array is one the person never ruled on — most often because it did not exist
 * when they saved. It follows the role default. LM10's Done-when asks for exactly this ("a user who
 * hides a widget still inherits a later default change to widgets they did not touch") and a visible
 * set alone cannot express it; 0343's header has the full argument and the rejected alternative.
 */
import { z } from "zod";
import type { UserRole } from "./constants.js";
import type { DashboardWidget } from "./dashboardWidgets.js";

/**
 * A ceiling, not a description of the catalogue — ten widgets exist. It is here so a request cannot
 * use the row as storage, and it matches 0343's CHECK so the database and the endpoint refuse the
 * same thing rather than the endpoint being the only one that remembers.
 */
export const DASHBOARD_LAYOUT_MAX_KEYS = 64;

/** Long enough for any `feature.widget-name` the catalogue could grow; short enough to be a key. */
export const DASHBOARD_WIDGET_KEY_MAX = 80;

const widgetKeySchema = z.string().min(1).max(DASHBOARD_WIDGET_KEY_MAX);

/**
 * `PUT /api/dashboard-layout`. Both arrays are required and either may be empty: sending one and
 * omitting the other would make "I hid everything" indistinguishable from "I kept everything",
 * which is the distinction this whole file exists to hold.
 *
 * The overlap refusal mirrors 0343's `not (widget_keys && hidden_keys)` CHECK. Kept and hidden
 * answer the same question, so a key cannot be both, and if the request were allowed to say both
 * the resolver would have to invent a winner.
 */
export const dashboardLayoutSetSchema = z
  .object({
    widgetKeys: z.array(widgetKeySchema).max(DASHBOARD_LAYOUT_MAX_KEYS),
    hiddenKeys: z.array(widgetKeySchema).max(DASHBOARD_LAYOUT_MAX_KEYS),
  })
  .refine((v) => !v.widgetKeys.some((k) => v.hiddenKeys.includes(k)), {
    message: "A widget cannot be both kept and hidden",
    path: ["hiddenKeys"],
  });

export type DashboardLayoutSetRequest = z.infer<typeof dashboardLayoutSetSchema>;

/** What the table stores for one person, or `null` when they have no row. */
export interface StoredDashboardLayout {
  /** Kept, in the order they arranged it. */
  widgetKeys: readonly string[];
  /** Turned off explicitly. */
  hiddenKeys: readonly string[];
}

/**
 * Is this widget in the DEFAULT layout for this role (D-DW2)?
 *
 * Absent `defaultFor` means "everyone whose gate passes" — the common case, and the reason the field
 * is optional rather than every widget carrying a list of every role. A present list names the roles
 * that get it without asking; `dispatch.live-map` names `dispatcher`, which is the whole of "the
 * dispatcher sees the live map first".
 *
 * ⚠ This reads a role, and it is the only thing in the rendering path that does. It decides what
 * somebody sees BEFORE they have arranged anything, never what they MAY see — the catalogue's own
 * comment on `defaultFor` carries the argument. A wrong answer here shows or withholds a widget the
 * gates had already ruled on; it cannot leak one.
 */
export function inDefaultLayout(widget: DashboardWidget, role: UserRole | null): boolean {
  if (!widget.defaultFor) return true;
  return role !== null && widget.defaultFor.includes(role);
}

/**
 * The widgets to render, in render order.
 *
 * `allowed` is the gate-filtered list in catalogue order — see the file header for why it is not the
 * catalogue. `stored` is the caller's row, or `null` when they have none.
 *
 * Order, when a row exists, is: everything they kept in the order they kept it, then anything they
 * have not ruled on that the role default includes, in catalogue order. Appending rather than
 * interleaving is the only honest choice — the catalogue cannot know where in somebody's
 * arrangement a new widget belongs, and putting it at the top would move a screen under a person who
 * had already decided what its top was.
 */
export function resolveDashboardLayout(
  allowed: readonly DashboardWidget[],
  role: UserRole | null,
  stored: StoredDashboardLayout | null,
): DashboardWidget[] {
  if (!stored) return allowed.filter((w) => inDefaultLayout(w, role));

  const byKey = new Map(allowed.map((w) => [w.key, w]));
  const kept: DashboardWidget[] = [];
  const seen = new Set<string>();
  for (const key of stored.widgetKeys) {
    // An unknown key is one whose widget was removed from the catalogue, or one this caller's gates
    // do not admit. Both are dropped in silence, which is what 0343 means by calling a stale key
    // inert: it shows nothing, and it also must not hide anything.
    const widget = byKey.get(key);
    if (!widget || seen.has(key)) continue;
    seen.add(key);
    kept.push(widget);
  }

  const hidden = new Set(stored.hiddenKeys);
  const untouched = allowed.filter(
    (w) => !seen.has(w.key) && !hidden.has(w.key) && inDefaultLayout(w, role),
  );

  return [...kept, ...untouched];
}
