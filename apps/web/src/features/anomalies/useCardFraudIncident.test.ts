import { describe, it, expect, vi } from "vitest";
import { createApp, defineComponent } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * Closing a case or an incident in its drawer must refresh the fuel queue (chunk 8c3): the page lists the
 * row, and a row still showing "Open" after its drawer said "closed" is the bug a reader sees first.
 */
vi.mock("@/lib/api", () => ({ apiFetch: async () => ({ ok: true, data: {} }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { useCardFraudIncidentTransition } from "./useCardFraudIncident";
import { useAnomalyTransition } from "./useAnomalies";

/** Run a composable inside an app that has a query client, and hand back both. */
function withClient<T>(use: () => T): { result: T; qc: QueryClient } {
  const qc = new QueryClient();
  let result!: T;
  const app = createApp(defineComponent({ setup: () => { result = use(); return () => null; } }));
  app.use(VueQueryPlugin, { queryClient: qc });
  app.mount(document.createElement("div"));
  return { result, qc };
}

describe("a move in a drawer refreshes the queue", () => {
  it("for a card-fraud incident", async () => {
    const { result, qc } = withClient(useCardFraudIncidentTransition);
    const spy = vi.spyOn(qc, "invalidateQueries");
    await result.mutateAsync({ id: "i1", status: "investigating", version: 1 });
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown } | undefined)?.queryKey)).toContainEqual(["findings"]);
  });

  it("for a fill case", async () => {
    const { result, qc } = withClient(useAnomalyTransition);
    const spy = vi.spyOn(qc, "invalidateQueries");
    await result.mutateAsync({ id: "a1", status: "investigating", version: 1 });
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown } | undefined)?.queryKey)).toContainEqual(["findings"]);
  });
});
