import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * The seven-day statement card when its read fails (D-US5). "No statement on file" is the sentence
 * that sends somebody to collect a statement again, so a failed read must never say it: it says the
 * statements could not load, and Retry reads them again.
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s };
});
const read = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock("@/features/roster/useSevenDayStatements", async () => {
  const { ref } = await import("vue");
  return {
    useSevenDayStatementsQuery: () => ({
      data: ref(undefined), isLoading: ref(false), isError: ref(true), error: ref(new Error("boom")),
      isFetching: ref(false), refetch: read.refetch,
    }),
    useRecordSevenDayStatement: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
  };
});
const SevenDayStatementSection = (await import("./SevenDayStatementSection.vue")).default;

describe("the seven-day statement card", () => {
  it("says the statements could not load rather than that none is on file, and retries", async () => {
    setActivePinia(createPinia());
    const w = mount(SevenDayStatementSection, { props: { driverId: "d1" }, global: { stubs: { SlideOver: true } } });
    expect(w.text()).not.toContain("No statement on file");
    const alert = w.get("[role=alert]");
    expect(alert.text()).toContain("Could not load the seven-day statements.");
    await alert.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });
});
