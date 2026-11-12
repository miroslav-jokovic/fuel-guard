import { watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { surfaceForPath } from "@silvicom/shared";
import { useAssistantStore } from "@/stores/assistant";
import { useAnswerPages } from "./useAnswerPages";

/**
 * The dock's half of `open_view` (F21 Step 5, D-AI5 (a)): "show me the open fuel problems for 718"
 * opens that page, so filtered, BEHIND the dock, which stays open over it.
 *
 *  · Which page the person is on goes with every question (`store.page`, the catalogue's surface for
 *    the MATCHED route), so "filter this to 718" knows what "this" is.
 *  · A turn that comes back with a `navigate` link is followed ONCE, when it lands, and only if it is
 *    still the newest turn: an answer that arrives after a later question was asked must not move the
 *    page out from under it. The page is reached through `useAnswerPages`, the same two checks every
 *    "Open in …" link passes (`canReachSurface`, then `surfaceAllowed`), so the dock cannot open a page
 *    the sidebar would not.
 *  · `docked` is false on `/ask`, where the thread IS the page: nothing moves, no page is sent, and the
 *    answer's "Open in …" link is the way there.
 */
export function useOpenView(docked: Readonly<Ref<boolean>>) {
  const route = useRoute();
  const router = useRouter();
  const store = useAssistantStore();
  const pagesOf = useAnswerPages();

  watch(
    () => (docked.value ? (route.matched.at(-1)?.path ?? route.path) : null),
    (path) => (store.page = path ? surfaceForPath(path)?.key : undefined),
    { immediate: true },
  );

  const followed = new Set<number>();
  watch(
    () => {
      const last = store.turns.at(-1);
      return last && last.status === "done" ? last : null;
    },
    (turn) => {
      if (!turn || followed.has(turn.id)) return;
      followed.add(turn.id);
      if (!docked.value) return;
      const nav = [...(turn.links ?? [])].reverse().find((l) => l.navigate);
      if (!nav) return;
      const page = pagesOf.value([nav.surfaceKey], [nav])[0];
      if (page) void router.push(page.to);
    },
  );
}
