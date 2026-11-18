import { describe, expect, it, vi } from "vitest";
import { MAX_BYTES, MIN_TEXT, fetchPage, jobPostings, pageText } from "./pageFetch.js";

const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];
const BODY = `<html><head><title>Job</title><style>.x{}</style></head><body><nav>Home</nav><h1>OTR Driver</h1><p>Earn up to $0.68 per mile,&nbsp;home every weekend.</p><script>var x = "not text";</script><p>${"We hire drivers across the Midwest. ".repeat(8)}</p></body></html>`;

function server(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const f = vi.fn(async (url: string) => {
    asked.push(url);
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    return route();
  }) as unknown as typeof fetch;
  return { f, asked };
}
const html = (body: string, type = "text/html; charset=utf-8") => () => new Response(body, { status: 200, headers: { "content-type": type } });
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

describe("fetchPage", () => {
  it("reads a public https page as text: markup, scripts and styles gone, entities decoded, hashed", async () => {
    const { f } = server({ "https://jobs.example.com/otr": html(BODY) });
    const out = await fetchPage({ fetch: f, lookup: PUBLIC }, "https://jobs.example.com/otr");
    if (!out.ok) throw new Error(out.detail);
    expect(out.text).toContain("Earn up to $0.68 per mile, home every weekend.");
    expect(out.text).not.toMatch(/not text|\.x\{\}|<p>/);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a private address, and a redirect to one, before asking it", async () => {
    const { f, asked } = server({ "https://jobs.example.com/a": redirect("https://internal.example.com/meta") });
    const lookup = async (host: string) => [{ address: host === "internal.example.com" ? "169.254.169.254" : "93.184.216.34", family: 4 }];
    expect(await fetchPage({ fetch: f, lookup }, "https://jobs.example.com/a")).toMatchObject({ ok: false, refusal: "blocked" });
    expect(asked).toEqual(["https://jobs.example.com/a"]);
    expect(await fetchPage({ fetch: f, lookup }, "https://10.0.0.5/")).toMatchObject({ ok: false, refusal: "blocked" });
    expect(await fetchPage({ fetch: f, lookup }, "http://jobs.example.com/a")).toMatchObject({ ok: false, refusal: "blocked" });
    expect(asked).toHaveLength(1);
  });

  it("follows a redirect to another public page and reads it", async () => {
    const { f, asked } = server({ "https://a.example.com/": redirect("/jobs"), "https://a.example.com/jobs": html(BODY) });
    const out = await fetchPage({ fetch: f, lookup: PUBLIC }, "https://a.example.com/");
    expect(out).toMatchObject({ ok: true, url: "https://a.example.com/jobs" });
    expect(asked).toEqual(["https://a.example.com/", "https://a.example.com/jobs"]);
  });

  it("refuses more than three redirects", async () => {
    const { f } = server({
      "https://a.example.com/1": redirect("https://a.example.com/2"), "https://a.example.com/2": redirect("https://a.example.com/3"),
      "https://a.example.com/3": redirect("https://a.example.com/4"), "https://a.example.com/4": redirect("https://a.example.com/5"),
    });
    expect(await fetchPage({ fetch: f, lookup: PUBLIC }, "https://a.example.com/1")).toMatchObject({ ok: false, refusal: "too_many_redirects" });
  });

  it("refuses a file that is not a web page, and a page over 2 MB", async () => {
    const pdf = server({ "https://a.example.com/x.pdf": html("%PDF-1.7", "application/pdf") });
    expect(await fetchPage({ fetch: pdf.f, lookup: PUBLIC }, "https://a.example.com/x.pdf")).toMatchObject({ ok: false, refusal: "not_html" });
    const big = server({ "https://a.example.com/big": html("a".repeat(MAX_BYTES + 1)) });
    expect(await fetchPage({ fetch: big.f, lookup: PUBLIC }, "https://a.example.com/big")).toMatchObject({ ok: false, refusal: "too_large" });
  });

  it("refuses a page drawn by script that holds almost no text", async () => {
    const shell = `<html><body><div id="root"></div><script>${"render();".repeat(500)}</script></body></html>`;
    const { f } = server({ "https://a.example.com/spa": html(shell) });
    const out = await fetchPage({ fetch: f, lookup: PUBLIC }, "https://a.example.com/spa");
    expect(out).toMatchObject({ ok: false, refusal: "too_little_text" });
    expect(MIN_TEXT).toBe(200);
  });

  it("says the site was unreachable, or answered with an error, without inventing a page", async () => {
    const down = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await fetchPage({ fetch: down, lookup: PUBLIC }, "https://a.example.com/")).toMatchObject({ ok: false, refusal: "unreachable" });
    const err = server({ "https://a.example.com/": () => new Response("no", { status: 404, headers: { "content-type": "text/html" } }) });
    expect(await fetchPage({ fetch: err.f, lookup: PUBLIC }, "https://a.example.com/")).toMatchObject({ ok: false, refusal: "http_error" });
  });
});

describe("pageText and jobPostings", () => {
  it("writes out a schema.org JobPosting a script-drawn page embeds, its pay in the page's own numbers", () => {
    const ld = { "@context": "https://schema.org", "@type": "JobPosting", title: "CDL-A Team Drivers", employmentType: "FULL_TIME",
      baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: 0.8, maxValue: 0.9, unitText: "MILE" } },
      description: "<p>Teams split 80 to 90 cents per mile.</p>" };
    const page = `<html><head><script type="application/ld+json">${JSON.stringify({ "@graph": [ld] })}</script></head><body><div id="root"></div></body></html>`;
    expect(jobPostings(page)).toEqual(["CDL-A Team Drivers\nPay: 0.8 to 0.9 USD per MILE\nFULL_TIME\nTeams split 80 to 90 cents per mile."]);
    expect(pageText(page)).toBe("CDL-A Team Drivers\nPay: 0.8 to 0.9 USD per MILE\nFULL_TIME\nTeams split 80 to 90 cents per mile.");
  });

  it("decodes named and numeric entities and leaves an unknown one as written", () => {
    expect(pageText("<p>Tom &amp; Jerry&#8217;s &#x24;5 &bogus;</p>")).toBe("Tom & Jerry’s $5 &bogus;");
  });
});
