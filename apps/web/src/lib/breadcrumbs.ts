/**
 * The breadcrumb trail, derived from `meta.parent` (G2, UI-GAPS-PLAN.md).
 *
 * D-DS17: no route declares a trail by hand. `meta.parent` already exists, is already correct on 24
 * routes, and already drives the back chevron in `AppShell`; a `meta.breadcrumb: string[]` alongside
 * it would be a second copy of the route graph, and the second copy is the one that goes stale
 * silently. So the trail is walked, not stored — the same argument D-REC1 makes about derived state,
 * applied to navigation.
 *
 * Pure and router-free by design, following `lib/layout.ts` (G1): the interesting part is a rule
 * about a graph, and a rule about a graph should be testable without mounting anything. The caller
 * supplies `resolve`; in the app that is a thin wrapper over `router.resolve`, and in the tests it
 * is a plain object literal.
 */

/** One step in the trail. `to` is a router path; `label` is that route's `meta.title`. */
export interface Crumb {
  label: string;
  to: string;
}

/**
 * What the walk needs from a route: a structural subset of vue-router's `RouteMeta`.
 *
 * ⚠ The index signature is load-bearing, not decoration. Without it this is a "weak type" — every
 * property optional — and TypeScript then refuses `RouteMeta`, which is an empty augmentable
 * interface, with "has no properties in common". The signature says what is true anyway: route meta
 * is an open bag and this function reads two documented keys out of it.
 */
export interface CrumbMeta {
  title?: unknown;
  parent?: unknown;
  [key: string]: unknown;
}

/**
 * How deep a trail may go before the walk gives up.
 *
 * The deepest real chain today is 2 — it was 3 until D-H17 deleted the hazmat loads board, which
 * owned the app's only `/hazmat` → `/hazmat/loads` → `/hazmat/loads/:id` trail. Five still leaves
 * room for nesting to come back without touching this, and turns a future mistake into a truncated
 * trail rather than a hung render — a cap and the cycle guard below are two answers to the same
 * question, because a `parent` chain is data and data can be wrong.
 */
const MAX_DEPTH = 5;

/**
 * Build the trail for `path`, root first, with the current page last.
 *
 * Returns `[]` when the path resolves to nothing, and a single crumb for a route with no `parent` —
 * the caller decides that a one-crumb trail is not worth rendering, because that is a presentation
 * question and this is not a presentation function.
 *
 * A `parent` pointing at a route that no longer exists **truncates** the trail rather than throwing:
 * a renamed route should cost the user a shorter trail, never a blank page. The test that stops that
 * happening silently is the parent-resolution assertion in `router/breadcrumbTargets.test.ts`, not
 * this function.
 */
export function buildTrail(
  path: string,
  resolve: (p: string) => CrumbMeta | null,
): Crumb[] {
  const trail: Crumb[] = [];
  const seen = new Set<string>();
  let current: string | null = path;

  while (current && trail.length < MAX_DEPTH) {
    // A repeated path means the parent chain loops. Stop and keep what is already built: a partial
    // trail is still useful, and the alternative is an infinite walk during render.
    if (seen.has(current)) break;
    seen.add(current);

    const meta: CrumbMeta | null = resolve(current);
    if (!meta) break;

    const label = typeof meta.title === "string" ? meta.title : null;
    // A route with no title has nothing to render as a crumb. Stop rather than invent a label from
    // the path — a guessed label in a navigation control is worse than a shorter trail.
    if (!label) break;

    trail.unshift({ label, to: current });
    current = typeof meta.parent === "string" ? meta.parent : null;
  }

  return trail;
}
