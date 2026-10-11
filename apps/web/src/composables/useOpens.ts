import { hasInjectionContext, inject } from "vue";
import {
  createMemoryHistory,
  createRouter,
  routerKey,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type Router,
} from "vue-router";
import { useSessionStore } from "@/stores/session";
import { routeOpens } from "@/lib/routeOpens";
import { ROUTE_TABLE } from "@/router/table";

/**
 * A resolver over the app's route table, for a component mounted without a router (SP5).
 *
 * Every component test in this app stubs `RouterLink` and installs no router, and a link gate that
 * answered "no router, so no" would hide every link in all of them — a test suite that could no
 * longer see the thing SP5 gates. Resolving against the same table the app's router is built from
 * gives those tests the real answer rather than a stub's. Built once and only when first needed; it
 * never navigates, so its memory history is inert.
 */
let tableRouter: Router | null = null;
const fallbackRouter = (): Router =>
  (tableRouter ??= createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] }));

/**
 * Follow a route record's `redirect` to where the guard will actually be asked. `router.resolve()`
 * stops AT a redirect record (`/rejections`, `/fuel-spend/exceptions`), and a redirect path is
 * uncatalogued — so without this a link to an old address would read "opens" whatever its target
 * said. Bounded, because a redirect loop is a routing bug this must not hang on.
 */
function landing(router: Router, to: RouteLocationRaw): RouteLocationNormalized | null {
  let r = router.resolve(to) as RouteLocationNormalized;
  for (let hop = 0; hop < 4; hop++) {
    const redirect = r.matched.at(-1)?.redirect;
    if (!redirect) return r;
    const next = typeof redirect === "function" ? redirect(r, r) : redirect;
    r = router.resolve(next as RouteLocationRaw) as RouteLocationNormalized;
  }
  return null;
}

/**
 * `opens(to)`: does this link's target open for the signed-in caller — the router guard's own answer,
 * through `routeOpens` (SP5, `SETTINGS-PERMISSIONS-PLAN.md` §4b, owner ruling 2026-09-30).
 *
 * A link is shown exactly when its target opens. Before SP5 each link restated a gate by hand, and
 * the SP5 sweep measured the restatements disagreeing with the guard in both directions: tiles
 * offered to a caller the guard then bounced to the dashboard, and recruiting buttons hidden from a
 * role the org had granted. Reading the guard's function is the only way the two cannot drift.
 *
 * It takes anything `RouterLink :to` takes — a string with params and a query, or a location object
 * — and asks the router to resolve it, so `/vehicles/abc?tab=x` is judged as `/vehicles/:id`. An
 * address the table does not know lands on the catch-all and answers `false`: a link to a page that
 * does not exist opens nothing.
 */
export function useOpens(): (to: RouteLocationRaw) => boolean {
  const session = useSessionStore();
  // The router is an inject, so it is read here, in setup, and not inside the returned function —
  // which a click handler calls, where inject no longer works. `inject(routerKey, null)` rather than
  // `useRouter()` because the latter warns on every component mounted without a router, which is
  // every component test, and a warning printed hundreds of times is one nobody reads.
  const router = (hasInjectionContext() ? inject(routerKey, null) : null) ?? fallbackRouter();
  return (to) => {
    const r = landing(router, to);
    if (!r || r.name === "not-found" || r.matched.length === 0) return false;
    return routeOpens(r.matched[0]!.path, r.meta, session);
  };
}
