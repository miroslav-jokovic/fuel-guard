import { computed, ref } from "vue";
import type { HomeTimeDriverOption, HomeTimeListResponse } from "@silvicom/shared";

/**
 * A stand-in for `@/components/homeTime/useHomeTime`, for a test of a screen that MOUNTS home time
 * without being about it — the Dispatch board page, the Loads page, the truck's drawer.
 *
 * Those tests mock the composables of the screen they are about (`useDispatchBoard`, `useDispatchLoads`)
 * and mount no vue-query client and no session store, so the real module would fail them on plumbing
 * that is not their subject. This answers what an office with nobody on home time and a reader who may
 * not mark it would get: an empty list, no drivers, no button. A test that IS about home time uses the
 * real module behind a mocked API (`features/dispatch/homeTimeOnBoard.test.ts`).
 *
 *   vi.mock("@/components/homeTime/useHomeTime", async () => (await import("@/testing/fakeHomeTime")).fakeHomeTime());
 */
export function fakeHomeTime(list: HomeTimeListResponse | undefined = undefined, drivers: HomeTimeDriverOption[] = []) {
  const query = <T>(data: T) => ({
    data: ref(data),
    isLoading: ref(false),
    isError: ref(false),
    error: ref(null),
    isFetching: ref(false),
    refetch: () => {},
  });
  const write = () => ({ mutateAsync: async () => ({}), isPending: ref(false) });
  return {
    HOME_TIME_KEY: ["home-time"] as const,
    useCanMarkHomeTime: () => computed(() => false),
    useHomeTimeList: () => query(list),
    useHomeTimeDrivers: () => query(drivers),
    useMarkHomeTime: write,
    useChangeHomeTime: write,
    useEndHomeTime: write,
    useCancelHomeTime: write,
    useReopenHomeTime: write,
  };
}
