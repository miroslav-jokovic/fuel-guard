import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { mountWebSpa } from "./appHttp.js";
import { closeTestServer } from "./testing/httpServer.js";
import { testEnv } from "./testing/testEnv.js";

/**
 * Which page a driver's training link opens (`/t/<token>`, SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS D-TR2).
 *
 * The link page is `t.html`, a second Vite entry a few KB in size, because the driver opens it on weak
 * signal (D-TR4) and the SPA's bundle is what it exists to avoid (D-TR12). Served wrong, the link still
 * "works" — the SPA loads, finds no route and shows its not-found page — so nothing but this test
 * notices that the driver got the 100× page or none at all. A fake `dist` stands in for the build: the
 * two entry files differ by their text, which is all the route decides between.
 */
let dist: string;
let base: string;
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), "web-dist-"));
  fs.writeFileSync(path.join(dist, "index.html"), "SPA");
  fs.writeFileSync(path.join(dist, "t.html"), "TRAINING");
  const app = express();
  mountWebSpa(app, testEnv({ WEB_DIST: dist }));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await closeTestServer(server);
  fs.rmSync(dist, { recursive: true, force: true });
});

// 24 characters of the base64url alphabet (letters, digits, _ and -), as mintLinkToken makes; a repeated
// pattern so the secret scan does not take a random-looking string for a leaked key.
const TOKEN = "aZ9_-".repeat(4) + "aZ9_";

describe("the driver's training link", () => {
  it("opens the small training page, never cached, for a well-formed token", async () => {
    for (const p of [`/t/${TOKEN}`, `/t/${TOKEN}/`]) {
      const res = await fetch(base + p);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("TRAINING");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("falls through to the web app for a path that is not a token", async () => {
    for (const p of [`/t/${TOKEN.slice(1)}`, `/t/${TOKEN}x`, `/t/${TOKEN.slice(1)}!`, `/t/${TOKEN}/more`, "/t/"]) {
      const res = await fetch(base + p);
      expect(await res.text(), p).toBe("SPA");
    }
  });
});
