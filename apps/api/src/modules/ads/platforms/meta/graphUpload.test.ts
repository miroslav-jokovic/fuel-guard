import { beforeEach, describe, expect, it, vi } from "vitest";
import { META_UPLOAD_BASE, MetaGraph, resetGraphThrottles } from "./graphClient.js";

/**
 * `MetaGraph.upload` (V4): a video's bytes to the URL a `video_ads` start answered. The token goes with them,
 * to an address that came out of a response body — so where it may go is what this file holds.
 */
const TOKEN = "EAAB-upload-token-0123456789";
const BYTES = Buffer.from("....ftypisom a motion ad", "latin1");
const ok = () => new Response(JSON.stringify({ success: true }), { status: 200 });

beforeEach(() => resetGraphThrottles());

function client(fetchImpl: ReturnType<typeof vi.fn>, extra: { uploadBase?: string } = {}) {
  return new MetaGraph({ token: TOKEN, throttleKey: "conn-upload", fetch: fetchImpl as unknown as typeof fetch, sleep: async () => {}, ...extra });
}

describe("MetaGraph.upload — where a video's bytes and our token may go", () => {
  it("sends the file to Meta's upload host with the guide's headers: OAuth, offset 0, file_size", async () => {
    const f = vi.fn(async (_url: URL, _init: RequestInit) => ok());
    const r = await client(f).upload(`${META_UPLOAD_BASE}/video-ads-upload/v26.0/123`, BYTES);
    expect(r).toMatchObject({ ok: true, data: { success: true }, attempts: 1 });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://rupload.facebook.com/video-ads-upload/v26.0/123");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: `OAuth ${TOKEN}`, offset: "0", file_size: String(BYTES.length) });
    expect(Buffer.from(init.body as Uint8Array).equals(BYTES)).toBe(true);
  });

  it.each([
    ["another host", "https://rupload.facebook.com.evil.example/video-ads-upload/v26.0/123"],
    ["Meta's Graph host, which is not the upload host", "https://graph.facebook.com/video-ads-upload/v26.0/123"],
    ["plain http", "http://rupload.facebook.com/video-ads-upload/v26.0/123"],
    ["a path that is not the upload path", "https://rupload.facebook.com/v26.0/act_1/campaigns"],
    ["not a URL at all", "video-ads-upload/v26.0/123"],
  ])("an upload URL on %s is refused before a byte or the token leaves", async (_l, url) => {
    const f = vi.fn(async () => ok());
    expect(await client(f).upload(url, BYTES)).toMatchObject({ ok: false, error: { error_code: "upload_url_unexpected", kind: "invalid_request", outcome_unknown: false } });
    expect(f).not.toHaveBeenCalled();
  });

  it("a caller that set its own upload host (the simulator, the contract proxy) gets the path there, whatever host the URL names", async () => {
    const f = vi.fn(async (_url: URL, _init: RequestInit) => ok());
    expect((await client(f, { uploadBase: "http://127.0.0.1:4010" }).upload("https://rupload.facebook.com/video-ads-upload/v26.0/9", BYTES)).ok).toBe(true);
    expect(String(f.mock.calls[0]![0])).toBe("http://127.0.0.1:4010/video-ads-upload/v26.0/9");
    // The path rule holds there too.
    expect((await client(f, { uploadBase: "http://127.0.0.1:4010" }).upload("https://rupload.facebook.com/v26.0/me", BYTES)).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a 5xx or a dropped connection is sent again from offset 0; Meta's refusal is not", async () => {
    const flaky = vi.fn<(u: URL, i: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 2, message: "retry" } }), { status: 500 }))
      .mockRejectedValueOnce(new TypeError("socket hang up"))
      .mockResolvedValue(ok());
    expect(await client(flaky).upload(`${META_UPLOAD_BASE}/video-ads-upload/v26.0/1`, BYTES)).toMatchObject({ ok: true, attempts: 3 });
    expect(flaky.mock.calls.map(([, i]) => (i.headers as Record<string, string>).offset)).toEqual(["0", "0", "0"]);

    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { code: 352, message: "format" } }), { status: 400 }));
    expect(await client(refused).upload(`${META_UPLOAD_BASE}/video-ads-upload/v26.0/1`, BYTES)).toMatchObject({ ok: false, error: { error_code: "meta_352", attempts: 1 } });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("a failure's message never carries the token", async () => {
    const echo = vi.fn(async () => new Response(JSON.stringify({ error: { code: 100, message: `bad session for ${TOKEN}` } }), { status: 400 }));
    const r = await client(echo).upload(`${META_UPLOAD_BASE}/video-ads-upload/v26.0/1`, BYTES);
    expect(r.ok === false && r.error.message).toBe("bad session for [token]");
  });
});
