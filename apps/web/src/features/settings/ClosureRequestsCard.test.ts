import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * The account-closure queue when its read fails (D-US5): the api's own sentence, and a Retry that
 * reads the queue again — never "No open requests", which would hide a driver's 30-day clock.
 */
const read = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock("./useClosureRequests", async () => {
  const { ref } = await import("vue");
  return {
    useClosureRequestsQuery: () => ({
      data: ref(undefined), isLoading: ref(false), isError: ref(true),
      error: ref(new Error("Could not load the closure requests.")), isFetching: ref(false), refetch: read.refetch,
    }),
    useResolveClosureRequest: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
  };
});
const ClosureRequestsCard = (await import("./ClosureRequestsCard.vue")).default;

describe("the closure-request card", () => {
  it("says the queue could not load, not that it is empty, and retries the read", async () => {
    setActivePinia(createPinia());
    const w = mount(ClosureRequestsCard);
    expect(w.text()).not.toContain("No open requests");
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load the closure requests.");
    await alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });
});
