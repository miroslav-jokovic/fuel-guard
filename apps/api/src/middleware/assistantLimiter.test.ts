import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSISTANT_ASKS_PER_CALLER, assistantLimiter } from "./apiRateLimit.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * Ask AI's limiter (F21 R2, AUDIT P1): per person, not per office. Before, `/api/ai` sat behind the
 * per-address `strictLimiter`, so everyone behind one office address shared 30 questions.
 */
let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use("/api/ai", assistantLimiter());
  app.post("/api/ai/ask", (_req, res) => { res.json({ ok: true }); });
  await new Promise<void>((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; r(); }); });
});
afterAll(async () => { await closeTestServer(server); });

const ask = (token: string) => fetch(`${base}/api/ai/ask`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);

describe("assistantLimiter", () => {
  it("refuses one person past their 30 while a colleague at the same address is still answered", async () => {
    for (let i = 0; i < ASSISTANT_ASKS_PER_CALLER; i++) expect(await ask("ana")).toBe(200);
    expect(await ask("ana")).toBe(429);
    expect(await ask("luis")).toBe(200);
  });
});
