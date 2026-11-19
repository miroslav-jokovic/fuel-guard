import { describe, expect, it } from "vitest";
import { downloadPilotQuote, MAX_QUOTE_BYTES } from "./pilotQuoteDownload.js";

const LINK = "https://docgenapex.apex.pilotcloud.net:443/apexdocs/validate?document=74ff1085&hash=abc";
const S3 = "https://pfj-apex-docgen-documents-prod-us-east-1.s3.us-east-1.amazonaws.com/pq-86406EAC-11192026.xlsx?X-Amz-Signature=x";
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

/** A fake network: each URL answers from the table; every request is recorded, so "never fetched" is checkable. */
function net(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    expect(init?.redirect).toBe("manual"); // every hop is ours to check
    const route = routes[url];
    if (!route) throw new Error(`unexpected request to ${url}`);
    return route();
  }) as typeof fetch;
  return { fetchImpl, asked };
}
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

describe("downloadPilotQuote", () => {
  it("follows the measured live path — validate → 302 → Pilot's S3 bucket → the xlsx", async () => {
    const { fetchImpl, asked } = net({ [LINK]: redirect(S3), [S3]: () => new Response(XLSX, { status: 200 }) });
    const r = await downloadPilotQuote(LINK, fetchImpl);
    expect(r).toEqual({ ok: true, bytes: XLSX, fileName: "pq-86406EAC-11192026.xlsx" });
    expect(asked).toEqual([LINK, S3]);
  });

  it("calls a redirect to the customer portal's sign-in what it is — an expired link — and does not follow it", async () => {
    const { fetchImpl, asked } = net({ [LINK]: redirect("https://customerportal.pilotflyingj.com/login?returnUrl=x") });
    const r = await downloadPilotQuote(LINK, fetchImpl);
    expect(r).toMatchObject({ ok: false, expired: true });
    expect(asked).toEqual([LINK]);
  });

  it("refuses a redirect to any other host without connecting to it", async () => {
    for (const evil of ["https://evil.example/x.xlsx", "http://pfj-apex-docgen-documents-prod-us-east-1.s3.amazonaws.com/x", "https://other-bucket.s3.amazonaws.com/x", "https://169.254.169.254/latest/meta-data/"]) {
      const { fetchImpl, asked } = net({ [LINK]: redirect(evil) });
      const r = await downloadPilotQuote(LINK, fetchImpl);
      expect(r).toMatchObject({ ok: false, expired: false });
      expect(asked).toEqual([LINK]);
    }
  });

  it("never connects for a link that is not Pilot's document service", async () => {
    const { fetchImpl, asked } = net({});
    expect(await downloadPilotQuote("https://evil.example/validate", fetchImpl)).toMatchObject({ ok: false, expired: false });
    expect(asked).toEqual([]);
  });

  it("refuses a 200 that is not a spreadsheet (an HTML error page)", async () => {
    const { fetchImpl } = net({ [LINK]: redirect(S3), [S3]: () => new Response("<html>Access denied</html>", { status: 200, headers: { "content-type": "text/html" } }) });
    expect(await downloadPilotQuote(LINK, fetchImpl)).toMatchObject({ ok: false, expired: false, error: expect.stringContaining("Not a spreadsheet") });
  });

  it("refuses a file larger than the cap, by its declared length or by what arrived", async () => {
    const declared = net({ [LINK]: redirect(S3), [S3]: () => new Response(XLSX, { status: 200, headers: { "content-length": String(MAX_QUOTE_BYTES + 1) } }) });
    expect(await downloadPilotQuote(LINK, declared.fetchImpl)).toMatchObject({ ok: false, error: expect.stringContaining("too large") });
    const big = Buffer.concat([XLSX, Buffer.alloc(MAX_QUOTE_BYTES)]);
    const actual = net({ [LINK]: redirect(S3), [S3]: () => new Response(big, { status: 200 }) });
    expect(await downloadPilotQuote(LINK, actual.fetchImpl)).toMatchObject({ ok: false, error: expect.stringContaining("too large") });
  });

  it("reports Pilot's own error status", async () => {
    const { fetchImpl } = net({ [LINK]: () => new Response("busy", { status: 503 }) });
    expect(await downloadPilotQuote(LINK, fetchImpl)).toMatchObject({ ok: false, expired: false, error: expect.stringContaining("503") });
  });

  it("stops after too many redirects", async () => {
    const hop = (n: number) => `https://docgenapex.apex.pilotcloud.net/hop${n}`;
    const routes: Record<string, () => Response> = { [LINK]: redirect(hop(0)) };
    for (let i = 0; i < 10; i++) routes[hop(i)] = redirect(hop(i + 1));
    const { fetchImpl } = net(routes);
    expect(await downloadPilotQuote(LINK, fetchImpl)).toMatchObject({ ok: false, error: expect.stringContaining("redirects") });
  });
});
