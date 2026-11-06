import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { USER_ROLES, rolesThatCanView, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Recruiting's place search (Q-AD44 (a)) through the mount: the answer is routing's `geocodeSuggest`, asked
 * through routing's INDEX (the mock below replaces only that export, so a second geocoder in recruiting would
 * not be called and the first test would fail), and the gate is `recruitment: view` read from the matrix.
 */

const geo = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../../routing/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../routing/index.js")>()),
  geocodeSuggest: async (_env: unknown, q: string) => {
    geo.calls.push(q);
    return [{ label: "Joliet, IL, United States", lat: 41.525, lng: -88.0817 }];
  },
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const viewer = rolesThatCanView("recruitment").find((r) => r !== "admin")!;
/** A role that may use the FUELING geocoder but not recruiting: the gate must be recruitment's, not any geocoder gate. */
const outsider = USER_ROLES.find((r) => !rolesThatCanView("recruitment").includes(r) && rolesThatCanView("dispatch").includes(r))!;
const CTX: Record<string, AuthContext> = {
  viewer: { userId: "u-viewer", email: "v@x.test", orgId: ORG, role: viewer } as AuthContext,
  outsider: { userId: "u-outsider", email: "o@x.test", orgId: ORG, role: outsider } as AuthContext,
  orgless: { userId: "u-orgless", email: "n@x.test", orgId: null, role: viewer } as AuthContext,
};

let server: Server;
let baseUrl: string;
const get = (q: string, token: string) =>
  fetch(`${baseUrl}/api/recruitment/place-suggest?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("GET /api/recruitment/place-suggest", () => {
  it("answers a recruiting role with routing's suggestions for what was typed", async () => {
    geo.calls.length = 0;
    const res = await get("Joliet", "viewer");
    const body = (await res.json()) as { suggestions: unknown };
    expect([res.status, body.suggestions, geo.calls]).toEqual([200, [{ label: "Joliet, IL, United States", lat: 41.525, lng: -88.0817 }], ["Joliet"]]);
  });
  it("refuses a role outside recruiting before asking the geocoder", async () => {
    geo.calls.length = 0;
    const res = await get("Joliet", "outsider");
    expect([res.status, geo.calls.length]).toEqual([403, 0]);
  });
  it("refuses a caller with no carrier", async () => {
    geo.calls.length = 0;
    const res = await get("Joliet", "orgless");
    expect([res.status >= 400, geo.calls.length]).toEqual([true, 0]);
  });
});
