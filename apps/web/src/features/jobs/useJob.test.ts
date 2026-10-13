import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * F5 (US6b) — a failed last-run read is a failure, not a job that never ran. `useJob`'s read used to
 * answer `{ latest: null, lastDone: null }` on any refusal, which every reader printed as "never run".
 */
const answer = vi.hoisted(() => ({ ok: false }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () =>
    answer.ok
      ? { ok: true, data: { latest: null, lastDone: { status: "done", finished_at: new Date().toISOString() } } }
      : { ok: false, status: 500, error: { message: "boom" } },
  ),
}));

import { useJob } from "./useJob";

async function job() {
  let out!: ReturnType<typeof useJob>;
  const C = defineComponent({ setup: () => ((out = useJob("nightly_reconcile")), () => h("div")) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(C, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  await flushPromises();
  return out;
}

describe("useJob's read", () => {
  it("reports a failed read as a failure, and retry() asks again", async () => {
    answer.ok = false;
    const j = await job();
    expect(j.readFailed.value).toBe(true);
    answer.ok = true;
    await j.retry();
    await flushPromises();
    expect(j.readFailed.value).toBe(false);
    expect(j.freshnessLabel.value).toBe("updated just now");
  });
});
