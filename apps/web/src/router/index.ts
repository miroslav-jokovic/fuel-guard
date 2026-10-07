import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { routeOpens } from "@/lib/routeOpens";
import { recordPageView } from "@/lib/pageViews";
import { DEV_BYPASS } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

/**
 * Route meta, TYPED — added with R0 (D-ROS7), and narrowed by S2.
 *
 * `requiresManage` and `requiresView` used to name the section a route needed. They are GONE: that
 * fact now lives once, in `SURFACES` (`packages/shared/src/surfaceCatalogue.ts`), and the guard below reads
 * it. Two metas naming a section and a catalogue naming the same section is the restatement D-SURF3
 * exists to prevent — and the reason it matters is measured: while both existed, 28 routes had a
 * sidebar entry gated on a section and no route gate at all, and `/settings` had the mismatch
 * reversed and bounced the one role it was added for.
 *
 * What remains here is `requiresAdmin`, on the four screens Q-SET1 keeps admin-only (Users,
 * Permissions, Card control, EFS integration). The catalogue says the same thing with an `ADMIN`
 * gate, so this is a second lock rather than a second home. `requiresAuditAccess` (admin OR the
 * read-only reviewer) went with SP1: the Audit log is a `settings: view` screen now (Q-SET3), and
 * the catalogue's `startsOnFor: ["auditor"]` is how the reviewer keeps it.
 */
declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    requiresAdmin?: boolean;
    title?: string;
    parent?: string;
    /**
     * Render this route's content edge to edge inside `AppShell` (D-DR5). Read through
     * `isFullBleed` in `lib/layout.ts`, never here — see that function for why it is not a sixth
     * `layout`. Absent means "a document", which is what every other route in this table is.
     *
     * ⚠ A PREDICATE is allowed since D-DR24, for a route whose answer depends on where inside it the
     * reader is: the dashboard is a document on the Fleet tab and a workspace on Dispatch. It is
     * handed the route so it can read `query`, and it must be pure — the shell evaluates it on every
     * navigation while deciding the outlet.
     */
    fullBleed?: boolean | ((route: { query?: Record<string, unknown> }) => boolean);
    /**
     * A photographic plate behind this page, drawn by `AppShell` as a PAGE layer (D-DT18).
     *
     * ⚠ It is meta rather than a prop on `PageHeader` because of what the layer is: it starts at
     * the top of the content area, bleeds past the right gutter and descends BEHIND whatever bands
     * the page renders, which the header cannot own — it would have to be taller than itself. The
     * shell owns the gutter the bleed negates, so the shell owns the plate, and the only thing the
     * route has to say is which one.
     *
     * `heroDark` is the same view photographed at NIGHT and falls back to `hero` when absent
     * (D-DR19): dimming a dawn sky produces a grey dawn sky, not a night, so the two plates without
     * a night variant keep the contrast problem measured there rather than a filtered pretence.
     *
     * ⚠ A `fullBleed` route must not declare one. The live map fills its outlet edge to edge, so a
     * decorative layer under it is invisible at best; `heroPlate` in `lib/layout.ts` is where that
     * is enforced, on the same argument that put `isFullBleed` there.
     */
    hero?: string;
    heroDark?: string;
  }
}
import { ROUTE_TABLE } from "./table";

/** The table lives in `./table.ts` (SP5); the design-system lab is prepended below, never there. */
const routes: RouteRecordRaw[] = [...ROUTE_TABLE];

const designSystemLabEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESIGN_SYSTEM_LAB === "true";

if (designSystemLabEnabled) {
  routes.unshift({
    path: "/__design-system",
    name: "design-system-lab",
    component: () => import("@/dev/DesignSystemLabPage.vue"),
    meta: { public: true, layout: "lab", title: "Design system lab" },
  });
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (designSystemLabEnabled && to.meta.layout === "lab") return true;
  const session = useSessionStore();
  if (!session.initialized) await session.init();

  if (!session.isAuthenticated) {
    return to.meta.public ? true : { name: "login" };
  }
  // Authenticated but no membership yet (audit B3) → only no-org auth pages allowed.
  if (!session.hasOrg) {
    return to.meta.allowNoOrg ? true : { name: "pending" };
  }
  // Drivers use the Driver app; they may not use the web dashboard (Driver App, Phase 1).
  if (session.role === "driver") {
    return to.name === "driver-app" ? true : { name: "driver-app" };
  }
  // Authenticated with an org.
  if (to.name === "login" || to.name === "pending" || to.name === "driver-app")
    return { name: "dashboard" };

  /**
   * The screen gate: `requiresAdmin`, then the catalogue (S2, D-SURF3) — asked through `routeOpens`,
   * the ONE function every link in the app also asks through `useOpens()` (SP5, plan §4b). The
   * decision used to be written inline here, which left each link to restate it; the SP5 sweep
   * found those restatements disagreeing with this guard in both directions.
   *
   * `to.matched[0].path` is the DECLARED path — `/drivers/:id`, not `/drivers/abc` — which is what
   * the catalogue is keyed on. The route table is flat (no `children`), so `matched[0]` is always
   * the route itself; a nested table would need `matched.at(-1)` and `lint:surfaces` would catch
   * the mismatch as an uncatalogued path. Why an uncatalogued route opens is in `routeOpens`.
   */
  if (!routeOpens(to.matched[0]?.path ?? to.path, to.meta, session)) return { name: "dashboard" };
  return true;
});

/**
 * The page-view count (X1, 0435): one view of the screen the guard let the caller onto. After the
 * guard, so a redirect counts where the person landed, not where they tried to go. Declared path,
 * for the same reason the guard uses it — the catalogue is keyed on `/drivers/:id`, not on an id.
 * Not in a dev-bypass build, whose fake session has no token for the API to accept.
 */
router.afterEach((to, _from, failure) => {
  if (failure || DEV_BYPASS) return;
  const session = useSessionStore();
  if (!session.isAuthenticated || !session.hasOrg || session.role === "driver") return;
  recordPageView(to.matched[0]?.path ?? to.path);
});
