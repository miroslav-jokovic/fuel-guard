import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { closeTestServer } from "../testing/httpServer.js";
import { SAMSARA_WEBHOOK_PATH } from "../modules/samsara/index.js";

/**
 * The path we PUBLISH is the path we LISTEN on.
 *
 * WHY THIS SUITE EXISTS. Measured 2026-09-01 against the live Samsara account: our webhook was
 * configured to post to `https://fleetguardweb-production.up.railway.app/api/webhooks`, while the
 * handler is mounted a segment deeper. Every delivery 404'd, `fuel_events` never held a row, and
 * nothing on either side raised anything — a 404 from a webhook receiver looks exactly like a vendor
 * that has nothing to send (docs/plans/HANDOFF-2026-09-01.md §5).
 *
 * The vendor half of that is a console setting and cannot be tested from here. The half that CAN be
 * pinned is that `SAMSARA_WEBHOOK_PATH` — the string the settings card tells an operator to paste —
 * still resolves to the receiver. Move the mount or rename the route and this fails, instead of the
 * integration failing silently in six months' time.
 */
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Dummy Supabase credentials so the service-role client can be constructed; nothing here queries,
  // because an unsigned delivery is refused before any read.
  const env = loadEnv({
    NODE_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    SUPABASE_JWT_SECRET: "test-secret-test-secret-test-secret!!",
  } as NodeJS.ProcessEnv);
  const app = createApp(env);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await closeTestServer(server);
});

describe("the Samsara webhook receiver", () => {
  it("is routed at the path we publish, and refuses an unsigned delivery there", async () => {
    const res = await fetch(`${baseUrl}${SAMSARA_WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "e1" }),
    });
    // 401, not 404: the route exists and fails closed. A 404 here is the live defect.
    expect(res.status).toBe(401);
  });

  it("does not answer the mount prefix on its own — the path the vendor was given", async () => {
    const res = await fetch(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "e1" }),
    });
    expect(res.status).toBe(404);
  });
});
