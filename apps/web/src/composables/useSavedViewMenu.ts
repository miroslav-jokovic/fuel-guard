import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { builtInViewsFor, type BuiltInView, type SavedViewTable } from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";
import { useSavedViews } from "./useSavedViews";

/**
 * Everything a page's `SavedViewMenu` binds to, for the table it shows (R3c-2; the Dispatch board
 * became the second caller on 2026-10-10, and this moved here from DriversPage rather than being
 * copied beside it).
 *
 * A view is a name and the page's query string, so applying one is a NAVIGATION and the URL afterwards
 * IS the view — the same URL a colleague would receive as a link. There is no second code path that
 * "applies" a view, which is what stops the two drifting apart. Save stores everything in the URL,
 * which is exactly what a link carries.
 *
 * `what` names the page in the toast ("“Late VINNIEV” now opens this board.").
 */
export function useSavedViewMenu(table: SavedViewTable, what: string) {
  const savedViews = useSavedViews(table);
  const builtIns: readonly BuiltInView[] = builtInViewsFor(table);
  const route = useRoute();
  const router = useRouter();
  const toast = useToastStore();

  const currentQuery = computed(() => new URLSearchParams(route.query as Record<string, string>).toString());
  /** The name of the saved view the page is currently showing, when it is showing one. */
  const activeName = computed(
    () =>
      builtIns.find((v) => v.query === currentQuery.value)?.name ??
      savedViews.views.value.find((v) => v.query === currentQuery.value)?.name ??
      null,
  );

  function apply(query: string) {
    void router.replace({ path: route.path, query: Object.fromEntries(new URLSearchParams(query)) });
  }
  async function save(name: string) {
    try {
      await savedViews.save(name, currentQuery.value);
      toast.success("View saved", `“${name}” now opens this ${what}.`);
    } catch (e) {
      toast.error("Could not save the view", e instanceof Error ? e.message : undefined);
    }
  }
  async function remove(name: string) {
    try {
      await savedViews.remove(name);
      toast.success("View deleted");
    } catch (e) {
      toast.error("Could not delete the view", e instanceof Error ? e.message : undefined);
    }
  }

  return { builtIns, views: savedViews.views, busy: savedViews.saving, currentQuery, activeName, apply, save, remove };
}
