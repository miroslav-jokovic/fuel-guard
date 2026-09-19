import { describe, it, expect } from "vitest";
import express from "express";
import { securityMiddleware } from "./appHttp.js";
import { testEnv } from "./testing/testEnv.js";

/**
 * The Content-Security-Policy this server sends, read the way a browser reads it.
 *
 * ── ⚠ WHY THIS FILE EXISTS, AND WHY THE DEFECT IT PINS WAS INVISIBLE ──────────────────────────
 * `DocumentPreview.vue` frames a PDF, and in production it showed a grey box with Chrome's own
 * *"This content is blocked. Contact the site owner to fix the issue."* — reported by the owner on
 * 2026-09-19 against B2's signed-permissions document. The cause was one missing directive:
 * `frame-src` has no default of its own and falls back to `default-src 'self'`, and the viewer
 * frames a `blob:` URL (a document the API composes per request) or a Supabase signed storage URL
 * (a filed one). Neither is `'self'`.
 *
 * ⚠ **It could not reproduce on a developer's machine and that is the whole reason for a test here.**
 * Vite serves the SPA in dev and in `preview:local` and does not run helmet, so the viewer is
 * correct in every local walk; the header only exists on the deploy where this server also serves
 * the SPA. Rasterising the PDF does not find it either — the document was always fine. What finds it
 * is asserting the header, which is what this does.
 *
 * ⚠ The assertions name the two things the app actually frames rather than checking the directive is
 * merely present. A `frame-src 'self'` would be present, would look deliberate, and would be the
 * exact defect.
 */
async function cspOf(): Promise<Record<string, string[]>> {
  const app = express();
  app.use(securityMiddleware(testEnv()));
  app.get("/", (_req, res) => res.status(204).end());

  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const header = res.headers.get("content-security-policy") ?? "";
    // Guards the guard: an empty header would make every `toContain` below vacuously false rather
    // than vacuously true, but an absent one would make the parse silently produce `{}`.
    expect(header).not.toBe("");
    return Object.fromEntries(
      header.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name ?? "", values];
      }),
    );
  } finally {
    server.close();
  }
}

describe("the page's own content-security-policy", () => {
  it("lets the document viewer frame a PDF it composed in the page", async () => {
    const csp = await cspOf();
    // The rendered branch: `objectUrl` is a blob the viewer fetched and owns.
    expect(csp["frame-src"]).toContain("blob:");
  });

  it("lets the document viewer frame a filed PDF out of storage", async () => {
    const csp = await cspOf();
    // The filed branch: `doc.url` is a Supabase signed URL, and the wildcard is how every other
    // directive here names that origin.
    expect(csp["frame-src"]).toContain("https://*.supabase.co");
  });

  it("still refuses to be framed by anybody else", async () => {
    const csp = await cspOf();
    // ⚠ `frame-ancestors` is the opposite direction and must NOT be loosened by the above: who may
    // frame US is a clickjacking control, and who WE may frame is not.
    expect(csp["frame-ancestors"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  it("does not let a script come from anywhere but this origin", async () => {
    const csp = await cspOf();
    // The directive the two above are most likely to be widened by accident alongside.
    expect(csp["script-src"]).toEqual(["'self'"]);
  });
});
