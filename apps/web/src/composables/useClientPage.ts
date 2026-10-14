import { computed, ref, watch, type Ref } from "vue";

/**
 * One page of a list the browser already holds in full (D-US8, US6b F26).
 *
 * For a list a single response answers whole — a reconciliation, a year of results — where the
 * server has nothing to page and the screen still must. Safety › Drug & Alcohol's "Driving here,
 * not in Med-Stop's random pool" drew 178 drivers in one card on staging, and its neighbours had the
 * same shape. The page is local, not in the URL: these lists carry no toolbar, so there is no filter
 * for a pasted link to keep (D-US2 covers toolbar lists, which page through `useQueryState`).
 *
 * `paged` is false while the whole list fits on one page, so the caller can leave the footer off a
 * five-row list. A shrinking list (a refetch, a different choice of rows) never strands the reader
 * on a page past its end.
 */
export function useClientPage<T>(rows: Ref<readonly T[]>, pageSize = 20) {
  const page = ref(1);
  const total = computed(() => rows.value.length);
  const pageRows = computed(() => rows.value.slice((page.value - 1) * pageSize, page.value * pageSize));
  const paged = computed(() => total.value > pageSize);
  watch(total, (n) => {
    const last = Math.max(1, Math.ceil(n / pageSize));
    if (page.value > last) page.value = last;
  });
  return { page, pageRows, total, paged, pageSize };
}
