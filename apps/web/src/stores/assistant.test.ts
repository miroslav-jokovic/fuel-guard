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
    expect(apiFetch).toHaveBeenCalledWith("/api/ai/ask", { method: "POST", body: { question: "How much did we spend?", history: [] } });
    expect(s.turns).toEqual([{ id: 1, question: "How much did we spend?", status: "done", answer: "Spend was $41,200.", pages: [], links: [] }]);
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
    expect(apiFetch).toHaveBeenLastCalledWith("/api/ai/ask", { method: "POST", body: { question: "q", history: [] } });
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

  it("keeps the links the API sent with an answer's filters (R4b)", async () => {
    const s = useAssistantStore();
    const link = { surfaceKey: "fuel.spend", query: { from: "2026-10-01", to: "2026-10-31", trucks: "v748" } };
    replies.push(async () => ({ ok: true, data: { answer: "6.4", pages: ["fuel.spend"], links: [link] } }));
    await s.ask("mpg on 748");
    expect(s.turns[0]!.links).toEqual([link]);
  });

  it("keeps the pages the API named behind an answer, and none from an older API (R4a)", async () => {
    const s = useAssistantStore();
    replies.push(async () => ({ ok: true, data: { answer: "Net was $412,000.", pages: ["finance.fleet-report"] } }));
    await s.ask("net last month");
    replies.push(async () => ({ ok: true, data: { answer: "ok" } }));
    await s.ask("and fuel?");
    expect(s.turns.map((t) => t.pages)).toEqual([["finance.fleet-report"], []]);
    expect(s.turns.map((t) => t.links)).toEqual([[], []]);
  });

  it("sends the thread's answered turns before the question, never a failed one, and nothing after New chat (R3a)", async () => {
    const s = useAssistantStore();
    replies.push(async () => ({ ok: true, data: { answer: "Spend was $41,200." } }));
    await s.ask("fuel spend last month");
    replies.push(async () => ({ ok: false, error: { message: "AI is busy" } }));
    await s.ask("and MPG?");
    replies.push(async () => ({ ok: true, data: { answer: "In September, $39,900." } }));
    await s.ask("and the month before?");
    expect((apiFetch.mock.calls[2]![1] as { body: unknown }).body).toEqual({
      question: "and the month before?",
      history: [{ question: "fuel spend last month", answer: "Spend was $41,200." }],
    });
    // A retry carries what came before it, not what came after.
    replies.push(async () => ({ ok: true, data: { answer: "6.4" } }));
    await s.retry(2);
    expect((apiFetch.mock.calls[3]![1] as { body: { history: unknown[] } }).body.history).toEqual([
      { question: "fuel spend last month", answer: "Spend was $41,200." },
    ]);
    s.clear();
    replies.push(async () => ({ ok: true, data: { answer: "ok" } }));
    await s.ask("fuel spend this month");
    expect((apiFetch.mock.calls[4]![1] as { body: { history: unknown[] } }).body.history).toEqual([]);
  });
});
