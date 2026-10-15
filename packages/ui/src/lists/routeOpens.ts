import { inject, provide, type InjectionKey } from "vue";
import type { RouteLocationRaw } from "vue-router";

/**
 * Whether a route opens for the person looking, asked by the shared pieces that offer a way to it
 * (`NotFoundState`'s "Back to <list>").
 *
 * The answer belongs to the app, not to `@silvicom/ui`. The web app's routes are gated by section,
 * screen and module (`useOpens`, SP5); the admin console's are not gated per route at all. So the app
 * provides its own answer once, at its root, and the shared pieces inject it. Before US7 (D-US11)
 * `NotFoundState` imported the web's `useOpens` directly, which is what kept it, and with it
 * `QueryState`, out of the admin console.
 *
 * With nothing provided every route opens: an app that gates no route has nothing to refuse.
 */
export type RouteOpens = (to: RouteLocationRaw) => boolean;

export const routeOpensKey: InjectionKey<RouteOpens> = Symbol("route-opens");

export function provideRouteOpens(opens: RouteOpens): void {
  provide(routeOpensKey, opens);
}

export function injectRouteOpens(): RouteOpens {
  return inject(routeOpensKey, () => true);
}
