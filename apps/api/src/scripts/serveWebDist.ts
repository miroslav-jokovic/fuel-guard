/**
 * Serve the built web app through THIS server's own `createApp` — for the applicant page's browser tests
 * (`apps/web/playwright.apply.config.ts`), and nothing else.
 *
 * ── WHY NOT `vite preview`, WHICH THEY USED TO RUN ON ──────────────────────────────────────────
 * Because vite runs no helmet, so a page it serves has no Content-Security-Policy, and the CSP is the one
 * part of production a stubbed API cannot stand in for. It has now hidden a production failure twice:
 * the document viewer's `frame-src` (2026-09-19, `appHttp.ts`), and every applicant photograph from the
 * day the scanner shipped until 2026-09-30 — the capture screen read its own `blob:` URL back with
 * `fetch`, `connect-src` has no `blob:`, and the upload never started (zero rows in
 * `application_captures`). Both were correct in every local walk and in CI, and broken in the one place
 * that sends the header.
 *
 * So the header is not copied into the test config — a copy is a second source of truth that drifts. The
 * page is served by `createApp`, which mounts `securityMiddleware` exactly as production does, and the
 * static files and the history fallback come from the same code as well.
 *
 * ── WHAT IS NOT PRODUCTION ─────────────────────────────────────────────────────────────────────
 * No Supabase and no `VITE_API_URL`. The specs answer `/api/public/application/**` and the storage upload
 * themselves (`e2e-apply/stubApi.ts`) — but not everything: a `keepalive` report (`useScreenEvents.ts`)
 * sent as a spec closes its page outlives the page's routes and arrives HERE. The API behind would answer
 * it with a Supabase stack trace in the CI log, so every `/api` request is refused first with a named 503
 * — on the outer app, never inside `createApp`, which stays exactly as production builds it. `VITE_API_URL`
 * only adds the api service's origin to `connect-src`, and the applicant page
 * calls its own origin (`useApplication.ts`), so its absence changes nothing the page does.
 */
import type { AddressInfo } from "node:net";
import express from "express";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";

const port = Number(process.env.PORT ?? "4191");
const env = loadEnv({ NODE_ENV: "test", ...(process.env.WEB_DIST ? { WEB_DIST: process.env.WEB_DIST } : {}) } as NodeJS.ProcessEnv);
const outer = express();
outer.use("/api", (_req, res) => {
  res.status(503).json({ error: { code: "e2e_unstubbed", message: "The browser specs' server answers no API request." } });
});
outer.use(createApp(env));
const server = outer.listen(port, "127.0.0.1", () => {
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // `createApp` serves the SPA only when `dist/index.html` exists, and skips it silently otherwise — right
  // for the API service, and for a test run a two-minute Playwright timeout with no reason given. Asked of
  // the server itself rather than of a path worked out here, which would be a second copy of its default.
  void fetch(`${origin}/`).then((res) => {
    if (res.ok) return console.log(`[serve-web-dist] ${origin}`);
    console.error(`[serve-web-dist] GET / answered ${res.status}: build the web app first (pnpm --filter @silvicom/web build).`);
    process.exit(1);
  });
});
