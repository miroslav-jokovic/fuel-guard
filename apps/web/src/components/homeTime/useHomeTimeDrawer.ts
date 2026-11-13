import { computed } from "vue";
import { useRoute, useRouter, type LocationQuery } from "vue-router";
import { isRecordId } from "@silvicom/shared";

/**
 * The home-time drawer's state is the URL (HOME-TIME-PLAN D-HT8): `?homeTime=<driver id>`, or
 * `?homeTime=new` for the tab's "Mark home time", which starts with a driver search. One drawer for the
 * three places home time is marked from — the truck's drawer, the Home time tab, the driver's page — so
 * a bell entry, a pasted link and Back all open the same thing, as the notes drawer does (D-UN12).
 *
 * Opening PUSHES (Back closes it); closing REPLACES, so closing leaves no history entry that reopens it.
 *
 * ⚠ Opening it takes `truck` out of the URL. The truck's drawer and this one are both dialogs, and two
 * open dialogs each answer Escape and each trap focus; the board shows one at a time.
 */
export const HOME_TIME_NEW = "new";

const first = (v: LocationQuery[string] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export function useHomeTimeDrawer() {
  const route = useRoute();
  const router = useRouter();

  /** The driver the drawer is open on, `"new"` for the driver search, or null when it is closed. */
  const target = computed<string | null>(() => {
    const v = first(route.query.homeTime);
    if (v === HOME_TIME_NEW) return HOME_TIME_NEW;
    return v && isRecordId(v) ? v.toLowerCase() : null;
  });

  function open(driverId: string | typeof HOME_TIME_NEW): void {
    const { truck: _t, ...rest } = route.query;
    void router.push({ query: { ...rest, homeTime: driverId } });
  }

  /** The search chose a driver: the same drawer, now on him. Replaces, so Back does not return to the search. */
  function choose(driverId: string): void {
    void router.replace({ query: { ...route.query, homeTime: driverId } });
  }

  function close(): void {
    const { homeTime: _h, ...rest } = route.query;
    void router.replace({ query: rest });
  }

  return { target, open, choose, close };
}
