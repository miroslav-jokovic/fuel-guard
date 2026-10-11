import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { computed } from "vue";
import { useAssistantStore } from "./assistant";

const replies: Array<() => Promise<unknown>> = [];
const apiFetch = vi.fn((_path: string, _init: unknown) => replies.shift()!());
vi.mock("@/lib/api", () => ({ apiFetch: (path: string, init: unknown) => apiFetch(path, init) }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetch.mockClear();
  replies.length = 0;
});

describe("assistant store", () => {
  it("posts the trimmed question and records the answer where the screen sees it", async () => {
    const d = deferred<unknown>();
    replies.push(() => d.promise);
    const s = useAssistantStore();
    const pending = s.ask("  How much did we spend?  ");
    // Read the way a template reads it — through a cached computed — so an answer written onto the
    // raw object (not the reactive proxy) shows here as a turn stuck on "pending".
    const status = computed(() => s.turns[0]?.status);
    expect(status.value).toBe("pending");
    d.resolve({ ok: true, data: { answer: "Spend was $41,200." } });
    await pending;
    expect(status.value).toBe("done");
    expect(apiFetch).toHaveBeenCalledWith("/api/ai/ask", { method: "POST", body: { question: "How much did we spend?" } });
    expect(s.turns).toEqual([{ id: 1, question: "How much did we spend?", status: "done", answer: "Spend was $41,200." }]);
  });

  it("refuses a blank question and a second question while one is pending", async () => {
    const d = deferred<unknown>();
    replies.push(() => d.promise);
    const s = useAssistantStore();
    await s.ask("   ");
    const first = s.ask("one");
    await s.ask("two");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true, data: { answer: "a" } });
    await first;
    expect(s.turns.map((t) => t.question)).toEqual(["one"]);
  });

  it("caps a question at the endpoint's 500 characters", async () => {
    replies.push(async () => ({ ok: true, data: { answer: "ok" } }));
    const s = useAssistantStore();
    await s.ask("x".repeat(620));
    expect(s.turns[0]!.question).toHaveLength(500);
  });

  it("shows the API's error and retries the same question", async () => {
    replies.push(async () => ({ ok: false, error: { code: "ai_unavailable", message: "AI is not configured" } }));
    replies.push(async () => ({ ok: true, data: { answer: "Now it works." } }));
    const s = useAssistantStore();
    await s.ask("q");
    expect(s.turns[0]).toMatchObject({ status: "error", answer: "AI is not configured" });
    await s.retry(1);
    expect(apiFetch).toHaveBeenLastCalledWith("/api/ai/ask", { method: "POST", body: { question: "q" } });
    expect(s.turns[0]).toMatchObject({ status: "done", answer: "Now it works." });
  });

  it("drops an answer that lands after a new chat was started", async () => {
    const d = deferred<unknown>();
    replies.push(() => d.promise);
    const s = useAssistantStore();
    const pending = s.ask("old question");
    s.clear();
    d.resolve({ ok: true, data: { answer: "late" } });
    await pending;
    expect(s.turns).toEqual([]);
  });
});
