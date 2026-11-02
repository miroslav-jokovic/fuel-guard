import { ref, watch, type Ref } from "vue";

/**
 * Walking back to a line a search opened (CH8, `?line=`): the log holds its newest pages, and the line
 * may be older. Each time the log says the line is not among its lines (`focus-missing`), ask for the
 * page above — one page at a time, never while one is on its way, never after the last one failed — up
 * to `MAX_PAGES`, so a line from last year does not load a year of chat by itself. When the start is
 * reached, or the walk stops, `lost` is set and the stage says so in words.
 */
export const FOCUS_WALK_MAX_PAGES = 20;

export function useChatFocusWalk(
  focusId: Ref<string | null | undefined>,
  state: { beforeSeq: Ref<number | null>; loading: Ref<boolean>; failed: Ref<boolean> },
  loadEarlier: () => void,
) {
  const lost = ref(false);
  let pages = 0;
  watch(focusId, () => { pages = 0; lost.value = false; });
  function onMissing() {
    if (!focusId.value || state.loading.value) return;
    if (state.beforeSeq.value === null || state.failed.value || pages >= FOCUS_WALK_MAX_PAGES) {
      lost.value = true;
      return;
    }
    pages += 1;
    loadEarlier();
  }
  return { lost, onMissing };
}
