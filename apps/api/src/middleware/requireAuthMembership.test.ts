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
const SESSION = "5e551011-0000-4000-8000-000000000001";
let rec: SupabaseRecorder;
vi.mock("../lib/auth.js", () => ({
  verifyAccessToken: vi.fn(async () => ({ userId: USER, orgId: ORG, role: "dispatcher", email: "d@x.test", sessionId: SESSION })),
  getProjectJwks: () => null,
  projectTokenAudience: () => undefined,
}));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));

const { requireAuth, requireAuthFirstStep } = await import("./auth.js");
const { resetMembershipCache } = await import("./membershipCurrent.js");

async function hit(gate: typeof requireAuth = requireAuth, extra: Record<string, string> = {}): Promise<{ status: number; code?: string }> {
  const app = express();
  app.get("/x", gate, (_req, res) => res.json({ ok: true }));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, { headers: { authorization: "Bearer t", ...extra } });
    const body = (await res.json()) as { error?: { code?: string } };
    return { status: res.status, code: body.error?.code };
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => resetMembershipCache());

/** The database with 0620: `member_access_check` answers; `row` null is no membership. */
const state = (row: unknown) => createSupabaseRecorder({ rpc: (fn) => (fn === "member_access_check" ? (row === null ? [] : [row]) : undefined) });

describe("requireAuth with the membership check", () => {
  it("passes a signed token whose membership is current and whose session is alive", async () => {
    rec = state({ role: "dispatcher", suspended_at: null, session_alive: true });
    expect((await hit()).status).toBe(200);
  });

  it("answers 401 access_changed for a signed token whose membership was removed", async () => {
    rec = state(null);
    expect(await hit()).toEqual({ status: 401, code: "access_changed" });
  });

  it("answers 401 access_changed for a suspended membership", async () => {
    rec = state({ role: "dispatcher", suspended_at: "2026-09-30T12:00:00Z", session_alive: true });
    expect(await hit()).toEqual({ status: 401, code: "access_changed" });
  });

  it("answers 401 access_changed for a device that was signed out — the code the web renews on (Q-IA10)", async () => {
    rec = state({ role: "dispatcher", suspended_at: null, session_alive: false });
    const res = await hit();
    expect(res).toEqual({ status: 401, code: "access_changed" });
  });

  it("asks about the session the token names", async () => {
    rec = state({ role: "dispatcher", suspended_at: null, session_alive: true });
    await hit();
    expect(rec.rpcs().find((c) => c.fn === "member_access_check")!.args).toEqual({
      p_org: ORG, p_user: USER, p_session: SESSION, p_device_key: null, p_limit: null, p_idle_hours: 12,
    });
  });

  it("passes the app's device key from its header, so the database can remember the device (IA-S6)", async () => {
    rec = state({ role: "dispatcher", suspended_at: null, session_alive: true });
    await hit(requireAuth, { "x-silvicom-device": "the-office-pc-in-dispatch" });
    expect(rec.rpcs().find((c) => c.fn === "member_access_check")!.args).toMatchObject({ p_device_key: "the-office-pc-in-dispatch" });
  });

  it("answers 403 second_factor_required to a token that owes its code — 403, so the app keeps the session", async () => {
    rec = state({ role: "dispatcher", suspended_at: null, session_alive: true, has_second_factor: true, second_factor_required_from: "2099-01-01T00:00:00Z" });
    expect(await hit()).toEqual({ status: 403, code: "second_factor_required" });
  });

  it("lets that token through the one gate made for it, and nothing else", async () => {
    rec = state({ role: "dispatcher", suspended_at: null, session_alive: true, has_second_factor: true, second_factor_required_from: "2099-01-01T00:00:00Z" });
    expect((await hit(requireAuthFirstStep)).status).toBe(200);
    // The first-step gate waives ONLY the second step: a signed-out device and a removed member are still refused.
    rec = state({ role: "dispatcher", suspended_at: null, session_alive: false, has_second_factor: true });
    expect(await hit(requireAuthFirstStep)).toEqual({ status: 401, code: "access_changed" });
    rec = state(null);
    expect(await hit(requireAuthFirstStep)).toEqual({ status: 401, code: "access_changed" });
  });
});
