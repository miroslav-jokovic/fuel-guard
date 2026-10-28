import { describe, expect, it, vi, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/print-station` — the machine's side (PRINTERS-AND-SCANNERS-PLAN.md PS2). Pinned at this edge:
 *
 *   · no token, a wrong token and a revoked one are the same 401 — the endpoint says nothing about
 *     which tokens exist — while `/pair` alone is reachable without one;
 *   · the long poll answers 204 when nothing came, and the job the moment one does;
 *   · a station that hung up is never handed a job (there would be nobody to print it);
 *   · a report for another station's job is a 404, and one for a job never sent a 409.
 */

const station = { id: "st-1", org_id: "org-1", name: "Office PC" };
const svc = vi.hoisted(() => ({
  stationForToken: vi.fn(async (_a: unknown, token: string) => (token === "good-token-good-token-good" ? station : null)),
  pairStation: vi.fn(async (_a: unknown, input: { pairingCode: string }) =>
    input.pairingCode === "7K3M-9PQX" ? { token: "new-token", stationName: "Office PC" } : { code: "invalid_pairing_code", error: "wrong" },
  ),
  stationHello: vi.fn(async () => null),
}));
const jobs = vi.hoisted(() => ({
  claimNextJob: vi.fn(async (): Promise<unknown> => null),
  finishJob: vi.fn(async (): Promise<unknown> => "printed"),
}));
vi.mock("../printing/stations.js", () => svc);
vi.mock("../printing/jobs.js", () => jobs);
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));

const { printStationRouter } = await import("./printStation.js");

let server: Server | undefined;
async function start(): Promise<string> {
  const app = express();
  app.use("/api/print-station", printStationRouter({ longPollMs: 120, pollEveryMs: 20 }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/print-station`;
}
afterEach(async () => {
  if (server) await closeTestServer(server);
  server = undefined;
  vi.clearAllMocks();
});

const auth = { authorization: "Bearer good-token-good-token-good" };
const JOB = "44444444-4444-4444-8444-444444444444";

describe("authentication", () => {
  it("refuses a missing, wrong or revoked token with one generic 401", async () => {
    const base = await start();
    for (const headers of [{}, { authorization: "Bearer nope" }, { authorization: "good-token-good-token-good" }]) {
      const res = await fetch(`${base}/jobs/next`, { headers });
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).toContain("unauthorized");
    }
    expect(jobs.claimNextJob).not.toHaveBeenCalled();
  });

  it("pairs without a token, and a wrong code is a 401", async () => {
    const base = await start();
    const post = (pairingCode: string) =>
      fetch(`${base}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairingCode, hostName: "OFFICE-PC", agentVersion: "1.0.0" }),
      });
    const good = await post("7K3M-9PQX");
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ ok: true, token: "new-token", stationName: "Office PC" });
    expect((await post("AAAA-BBBB")).status).toBe(401);
  });
});

describe("the long poll", () => {
  it("answers 204 when no job came within the wait, having asked more than once", async () => {
    const base = await start();
    const res = await fetch(`${base}/jobs/next`, { headers: auth });
    expect(res.status).toBe(204);
    expect(jobs.claimNextJob.mock.calls.length).toBeGreaterThan(1);
  });

  it("hands over a job as soon as one is claimed", async () => {
    const job = { jobId: JOB, systemName: "MUNBYN RW403B", labelCount: 1, payloadBase64: "U0laRQ==" };
    jobs.claimNextJob.mockResolvedValueOnce(null).mockResolvedValueOnce(job);
    const base = await start();
    const res = await fetch(`${base}/jobs/next`, { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, job });
    expect(jobs.claimNextJob).toHaveBeenCalledTimes(2);
  });

  it("stops asking once the station has hung up", async () => {
    const base = await start();
    const controller = new AbortController();
    const pending = fetch(`${base}/jobs/next`, { headers: auth, signal: controller.signal }).catch(() => null);
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    await pending;
    const callsAtHangUp = jobs.claimNextJob.mock.calls.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(jobs.claimNextJob.mock.calls.length).toBeLessThanOrEqual(callsAtHangUp + 1);
  });
});

describe("hello and report", () => {
  it("records what the station's operating system reports", async () => {
    const base = await start();
    const res = await fetch(`${base}/hello`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ hostName: "OFFICE-PC", agentVersion: "1.0.0", printers: [{ name: "MUNBYN RW403B" }] }),
    });
    expect(res.status).toBe(200);
    expect(svc.stationHello).toHaveBeenCalledWith({}, station, { hostName: "OFFICE-PC", agentVersion: "1.0.0", printers: [{ name: "MUNBYN RW403B" }] });
  });

  it("maps another station's job to 404 and a never-sent one to 409", async () => {
    const base = await start();
    const report = () =>
      fetch(`${base}/jobs/${JOB}/report`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Out of paper" }),
      });
    expect((await report()).status).toBe(200);
    expect(jobs.finishJob).toHaveBeenCalledWith({}, "st-1", JOB, false, "Out of paper");
    jobs.finishJob.mockResolvedValueOnce({ code: "not_found", error: "x" });
    expect((await report()).status).toBe(404);
    jobs.finishJob.mockResolvedValueOnce({ code: "job_not_sent", error: "x" });
    expect((await report()).status).toBe(409);
  });
});
