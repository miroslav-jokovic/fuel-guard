import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * SP7: `requireAuth`'s DEFAULT path (no injected `verifyToken`) checks the membership after the
 * signature. These pin the wiring, not the rule — membershipCurrent.test.ts pins the rule.
 */
const ORG = "00000000-0000-4000-8000-00000000000a";
const USER = "00000000-0000-4000-8000-000000000002";
let rec: SupabaseRecorder;
vi.mock("../lib/auth.js", () => ({
  verifyAccessToken: vi.fn(async () => ({ userId: USER, orgId: ORG, role: "dispatcher", email: "d@x.test" })),
  getProjectJwks: () => null,
  projectTokenAudience: () => undefined,
}));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));

const { requireAuth } = await import("./auth.js");
const { resetMembershipCache } = await import("./membershipCurrent.js");

async function hit(): Promise<{ status: number; code?: string }> {
  const app = express();
  app.get("/x", requireAuth, (_req, res) => res.json({ ok: true }));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, { headers: { authorization: "Bearer t" } });
    const body = (await res.json()) as { error?: { code?: string } };
    return { status: res.status, code: body.error?.code };
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => resetMembershipCache());

describe("requireAuth with the membership check", () => {
  it("passes a signed token whose membership is current", async () => {
    rec = createSupabaseRecorder({ tables: { memberships: { data: [{ role: "dispatcher", suspended_at: null }], error: null } } });
    expect((await hit()).status).toBe(200);
  });

  it("answers 401 access_changed for a signed token whose membership was removed", async () => {
    rec = createSupabaseRecorder({ tables: { memberships: { data: [], error: null } } });
    expect(await hit()).toEqual({ status: 401, code: "access_changed" });
  });

  it("answers 401 access_changed for a suspended membership", async () => {
    rec = createSupabaseRecorder({ tables: { memberships: { data: [{ role: "dispatcher", suspended_at: "2026-09-30T12:00:00Z" }], error: null } } });
    expect(await hit()).toEqual({ status: 401, code: "access_changed" });
  });
});
