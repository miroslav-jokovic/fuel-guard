import { describe, it, expect, vi, afterEach } from "vitest";
import type { Response } from "express";
import { dbErrorResponse } from "./http.js";

/**
 * Regression test for audit 2026-08-09 finding 3.8 (Stage 1.7).
 *
 * Four route handlers returned `error.message` from PostgREST straight to the caller. Postgres error
 * text names tables, columns and constraints, so a failed query was a free schema disclosure — the
 * exact thing the repo's audit-L8 rule forbids and the global handler in app.ts already avoids.
 */
function fakeRes() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, sent };
}

const LEAKY =
  'duplicate key value violates unique constraint "uq_ftxn_org_external_ref" ' +
  "DETAIL: Key (org_id, external_ref)=(abc, INV1) already exists.";

afterEach(() => vi.restoreAllMocks());

describe("dbErrorResponse", () => {
  it("never puts the database's own words in the response", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, sent } = fakeRes();
    dbErrorResponse(res, "fuel_prices read", { message: LEAKY }, "Could not load fuel prices");

    const body = JSON.stringify(sent.body);
    expect(sent.status).toBe(500);
    for (const leak of ["uq_ftxn_org_external_ref", "org_id", "external_ref", "duplicate key", "DETAIL"]) {
      expect(body).not.toContain(leak);
    }
    expect(body).toContain("Could not load fuel prices");
  });

  it("logs the real message server-side, with a reference the caller also gets", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, sent } = fakeRes();
    dbErrorResponse(res, "fuel_stations read", { message: LEAKY }, "Could not load fuel stations");

    // The response carries a reference...
    const message = (sent.body as { error: { message: string } }).error.message;
    const ref = message.match(/\(ref: ([0-9a-f]{8})\)/)?.[1];
    expect(ref).toBeDefined();

    // ...and the same reference appears in the log line that DOES carry the real text, so an
    // operator can get from a user's screenshot to the actual failure.
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(ref!);
    expect(logged).toContain("uq_ftxn_org_external_ref");
    expect(logged).toContain("fuel_stations read");
  });

  it("uses the caller's error code and survives a null error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, sent } = fakeRes();
    dbErrorResponse(res, "rpc", null, "Could not sample transactions", "sample_failed");
    expect((sent.body as { error: { code: string } }).error.code).toBe("sample_failed");
  });

  it("gives a different reference each time so two failures are distinguishable", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = fakeRes();
    const b = fakeRes();
    dbErrorResponse(a.res, "s", { message: "x" }, "Could not load");
    dbErrorResponse(b.res, "s", { message: "x" }, "Could not load");
    expect((a.sent.body as { error: { message: string } }).error.message).not.toBe(
      (b.sent.body as { error: { message: string } }).error.message,
    );
  });
});
