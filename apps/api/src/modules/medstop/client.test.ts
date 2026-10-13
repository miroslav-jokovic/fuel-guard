import { describe, expect, it } from "vitest";
import { MedstopClient, MedstopError, medstopSelectionRow } from "./client.js";

/** Med-Stop's conventions as measured on 2026-10-13 (MEDSTOP-PLAN.md §5A) — the client's whole job. */

type Reply = { status: number; body: string };
function fake(replies: Reply[]) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    urls.push(url);
    headers.push(init.headers as Record<string, string>);
    const r = replies.shift() ?? { status: 500, body: "{}" };
    return new Response(r.body, { status: r.status });
  }) as unknown as typeof fetch;
  const slept: number[] = [];
  const client = new MedstopClient({ apiKey: "k".repeat(70), baseUrl: "https://api.med-stop.com/", fetchImpl, sleep: async (ms) => void slept.push(ms) });
  return { client, urls, headers, slept };
}
const page = (pagemax: number, ids: string[]) => ({
  status: 200,
  body: JSON.stringify({ data: { page: 1, pagemax }, rows: [ids.map((id) => ({ id, status: "OPEN", selectiondate: "2026-10-06T17:00:00" }))] }),
});

describe("MedstopClient.list", () => {
  it("walks every page from rows[0], sending the ApiKey header and a named User-Agent", async () => {
    const f = fake([page(2, ["a", "b"]), page(2, ["c"])]);
    const rows = await f.client.list("/Random/selections", medstopSelectionRow);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows[0]!.selectiondate).toBe("2026-10-06");
    expect(f.urls).toEqual([
      "https://api.med-stop.com/Random/selections?page=1&pagesize=100",
      "https://api.med-stop.com/Random/selections?page=2&pagesize=100",
    ]);
    expect(f.headers[0]!.Authorization).toBe(`ApiKey ${"k".repeat(70)}`);
    expect(f.headers[0]!["User-Agent"]).toMatch(/Silvicom360/);
  });

  it("reads Med-Stop's 404 as an empty list, not a failure", async () => {
    const f = fake([{ status: 404, body: '{"errors":{}}' }]);
    expect(await f.client.list("/Random/selections", medstopSelectionRow)).toEqual([]);
  });

  it("calls a 401 an auth refusal and does not retry it", async () => {
    const f = fake([{ status: 401, body: '{"errors":{"AUTH_AUTHORIZATION":"x"}}' }]);
    await expect(f.client.list("/Employee/list", medstopSelectionRow)).rejects.toMatchObject({ kind: "auth" });
    expect(f.urls).toHaveLength(1);
  });

  it("tells the firewall's HTML 403 apart from a JSON no-rights 403", async () => {
    const html = fake([{ status: 403, body: "<html>Access Denied</html>" }]);
    await expect(html.client.list("/x", medstopSelectionRow)).rejects.toMatchObject({ kind: "ip_refused" });
    const json = fake([{ status: 403, body: '{"errors":{"AUTHORIZATION_NORIGHTS":"x"}}' }]);
    await expect(json.client.list("/x", medstopSelectionRow)).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("waits a full minute on a 429 (no Retry-After is sent) and then carries on", async () => {
    const f = fake([{ status: 429, body: "{}" }, page(1, ["a"])]);
    expect(await f.client.list("/x", medstopSelectionRow)).toHaveLength(1);
    expect(f.slept).toContain(60_000);
  });

  it("fails loudly on a row it cannot read rather than storing half a list", async () => {
    const f = fake([{ status: 200, body: JSON.stringify({ data: { pagemax: 1 }, rows: [[{ noid: true }]] }) }]);
    await expect(f.client.list("/x", medstopSelectionRow)).rejects.toBeInstanceOf(MedstopError);
  });
});
