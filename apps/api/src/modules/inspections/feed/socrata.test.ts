import { describe, it, expect } from "vitest";
import { PAGE_SIZE, SocrataClient, SocrataError, scopeWhere } from "./socrata.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function scripted(responses: Array<Response | Error>) {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const next = responses.shift();
    if (!next) throw new Error("no scripted response left");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  return { fetchImpl, urls, headers, sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}

describe("SocrataClient (INSPECTION-CHALLENGE-PLAN IC1)", () => {
  it("walks pages in :id order until a short page, counting every request", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ inspection_id: String(i) }));
    const s = scripted([json(full), json([{ inspection_id: "x" }])]);
    const c = new SocrataClient({ fetchImpl: s.fetchImpl, sleep: s.sleep });
    const rows = await c.rows("fx4q-ay7w", "dot_number = 1864495");
    expect(rows).toHaveLength(PAGE_SIZE + 1);
    expect(c.requestCount).toBe(2);
    const q = new URL(s.urls[1]!).searchParams;
    expect(q.get("$order")).toBe(":id");
    expect(q.get("$offset")).toBe(String(PAGE_SIZE));
    expect(q.get("$where")).toBe("dot_number = 1864495");
    expect(new URL(s.urls[0]!).pathname).toBe("/resource/fx4q-ay7w.json");
  });

  it("retries 429, 5xx and network errors twice with backoff, then succeeds", async () => {
    const s = scripted([json({}, 503), new TypeError("fetch failed"), json([])]);
    const c = new SocrataClient({ fetchImpl: s.fetchImpl, sleep: s.sleep });
    expect(await c.rows("fx4q-ay7w", "dot_number = 1")).toEqual([]);
    expect(s.sleeps).toEqual([2_000, 8_000]);
    expect(c.requestCount).toBe(3);
  });

  it("gives up after the third failure with the status", async () => {
    const s = scripted([json({}, 429), json({}, 500), json({}, 502)]);
    const c = new SocrataClient({ fetchImpl: s.fetchImpl, sleep: s.sleep });
    const e = await c.rows("fx4q-ay7w", "dot_number = 1").catch((x) => x);
    expect(e).toBeInstanceOf(SocrataError);
    expect(e.status).toBe(502);
    expect(e.message).toMatch(/after 3 attempts/);
  });

  it("does not retry a 400 — a malformed query will not improve", async () => {
    const s = scripted([new Response("Query coordinator error: type mismatch", { status: 400 })]);
    const c = new SocrataClient({ fetchImpl: s.fetchImpl, sleep: s.sleep });
    const e = await c.rows("wt8s-2hbx", "inspection_id in (1)").catch((x) => x);
    expect(e).toBeInstanceOf(SocrataError);
    expect(e.status).toBe(400);
    expect(s.sleeps).toEqual([]);
  });

  it("treats a body that is not an array as an error, never as an empty snapshot", async () => {
    const s = scripted([json({ error: true, message: "dataset moved" })]);
    const c = new SocrataClient({ fetchImpl: s.fetchImpl, sleep: s.sleep });
    await expect(c.rows("fx4q-ay7w", "dot_number = 1")).rejects.toThrow(/not a JSON array/);
  });

  it("reads rowsUpdatedAt as epoch seconds, and sends the app token when it has one", async () => {
    const s = scripted([json({ rowsUpdatedAt: 1791629715 }), json({})]);
    const c = new SocrataClient({ fetchImpl: s.fetchImpl, sleep: s.sleep, appToken: "tok" });
    expect((await c.rowsUpdatedAt("fx4q-ay7w"))?.toISOString()).toBe(new Date(1791629715 * 1000).toISOString());
    expect(await c.rowsUpdatedAt("fx4q-ay7w")).toBeNull();
    expect(s.headers[0]!["X-App-Token"]).toBe("tok");
    expect(new URL(s.urls[0]!).pathname).toBe("/api/views/fx4q-ay7w.json");
  });
});

describe("scopeWhere", () => {
  it("quotes ids only for a text column", () => {
    expect(scopeWhere({ by: "inspection_id", quoted: true }, ["1", "2"])).toBe("inspection_id in ('1', '2')");
    expect(scopeWhere({ by: "inspection_id", quoted: false }, ["1", "2"])).toBe("inspection_id in (1, 2)");
    expect(scopeWhere({ by: "dot_number", quoted: true }, "1864495")).toBe("dot_number = '1864495'");
  });

  it("refuses anything that is not digits instead of escaping it into SoQL", () => {
    expect(() => scopeWhere({ by: "dot_number", quoted: true }, "1' or '1'='1")).toThrow(/not a numeric/);
    expect(() => scopeWhere({ by: "inspection_id", quoted: false }, [])).toThrow(/at least one id/);
  });
});
