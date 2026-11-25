import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi, isOffline, LinkError } from "./api";

/**
 * No signal does not lose work (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8.2 rule 5): what the driver
 * watched and answered waits on the phone until it can be sent, and only the server's refusal drops it.
 */
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

type Reply = "offline" | { status: number; body?: unknown };
let replies: Reply[];
let sent: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  replies = [];
  sent = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    sent.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const r = replies.shift() ?? { status: 200, body: {} };
    if (r === "offline") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const TOKEN = "Ab3_-xYz0123456789abcdEF";
const span = (fromMs: number, toMs: number) => ({ versionId: "v1", fromMs, toMs, positionMs: toMs });

describe("what counts as no signal", () => {
  it("is a lost connection, a server or proxy in trouble, or the link's limiter — never a refusal", () => {
    expect(isOffline(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOffline(new LinkError("x", "error", 502))).toBe(true);
    expect(isOffline(new LinkError("x", "error", 429))).toBe(true);
    expect(isOffline(new LinkError("x", "gone", 410))).toBe(false);
    expect(isOffline(new LinkError("x", "invalid", 422))).toBe(false);
  });
});

describe("watched spans with no signal", () => {
  it("wait on the phone and go up as one report when the signal returns", async () => {
    const store = new MemoryStorage();
    const api = createApi(TOKEN, store);
    replies.push("offline");
    expect(await api.progress(span(0, 10_000))).toBeNull();
    replies.push({ status: 503 });
    expect(await api.progress(span(10_000, 20_000))).toBeNull();
    expect(api.pending()).toBe(1); // already joined on the phone: the two follow on

    sent = [];
    expect(await api.progress(span(20_000, 30_000))).toBe("sent");
    expect(sent.map((s) => s.body)).toEqual([span(0, 30_000)]);
    expect(sent[0]!.url).toBe(`/api/public/training/${TOKEN}/progress`);
    expect(api.pending()).toBe(0);
  });

  it("survive the page being closed: a new page on the same link sends them", async () => {
    const store = new MemoryStorage();
    replies.push("offline");
    await createApi(TOKEN, store).progress(span(0, 10_000));
    sent = [];
    await createApi(TOKEN, store).flushSpans();
    expect(sent.map((s) => s.body)).toEqual([span(0, 10_000)]);
    expect(createApi(TOKEN, store).pending()).toBe(0);
  });

  it("are dropped only when the server refuses them", async () => {
    const api = createApi(TOKEN, new MemoryStorage());
    replies.push({ status: 422, body: { error: { code: "invalid", message: "No." } } });
    expect(await api.progress(span(0, 10_000))).toBe("sent");
    expect(api.pending()).toBe(0);
  });
});

describe("an answer with no signal", () => {
  it("waits, then goes with the next flush and brings back its result", async () => {
    const api = createApi(TOKEN, new MemoryStorage());
    replies.push("offline");
    expect(await api.answer("a1", "q1", "c1")).toBeNull();
    expect(api.pending()).toBe(1);
    replies.push({ status: 200, body: { correct: true } });
    expect(await api.flushAnswers()).toEqual([{ questionId: "q1", result: { correct: true } }]);
    expect(sent.at(-1)!.body).toEqual({ attemptId: "a1", questionId: "q1", choiceId: "c1" });
    expect(api.pending()).toBe(0);
  });

  it("is not kept when the server refuses it, and the page hears why", async () => {
    const api = createApi(TOKEN, new MemoryStorage());
    replies.push({ status: 409, body: { error: { code: "answered", message: "Already answered." } } });
    await expect(api.answer("a1", "q1", "c1")).rejects.toMatchObject({ code: "answered", status: 409 });
    expect(api.pending()).toBe(0);
  });
});
