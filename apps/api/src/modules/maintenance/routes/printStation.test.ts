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
const scan = vi.hoisted(() => ({
  recordStationPorts: vi.fn(async (..._args: unknown[]) => null),
  scannersForStation: vi.fn(async (): Promise<unknown> => []),
  recordRead: vi.fn(async (): Promise<unknown> => ({ delivered: true })),
}));
vi.mock("../printing/jobs.js", () => jobs);
vi.mock("../printing/scannerStation.js", () => scan);
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
const SCANNER = "55555555-5555-4555-8555-555555555555";
const postScan = (base: string, body: unknown) =>
  fetch(`${base}/scans`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });

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
    // A 1.0.0 station sends no ports: the hello is accepted as before, with empty lists filled in.
    const asParsed = { hostName: "OFFICE-PC", agentVersion: "1.0.0", printers: [{ name: "MUNBYN RW403B" }], serialPorts: [], scannerStates: [] };
    expect(svc.stationHello).toHaveBeenCalledWith({}, station, asParsed);
    expect(scan.recordStationPorts).toHaveBeenCalledWith({}, station, asParsed);
    expect(await res.json()).toEqual({ ok: true, stationName: "Office PC", scanners: [] });
  });

  it("answers a hello with the scanners this station is to read", async () => {
    const base = await start();
    const scanners = [{ id: SCANNER, portName: "COM3", vendorId: "0581", productId: "0215" }];
    scan.scannersForStation.mockResolvedValueOnce(scanners);
    const res = await fetch(`${base}/hello`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        hostName: "OFFICE-PC",
        agentVersion: "1.1.0",
        printers: [],
        serialPorts: [{ name: "COM3", label: "USB Serial Device (COM3)", vendorId: "0581", productId: "0215" }],
        scannerStates: [{ scannerId: SCANNER, state: "reading", portName: "COM3" }],
      }),
    });
    expect(await res.json()).toEqual({ ok: true, stationName: "Office PC", scanners });
    expect(scan.recordStationPorts.mock.calls[0]![2]).toMatchObject({ serialPorts: [{ name: "COM3", vendorId: "0581" }] });
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

describe("scans (SCANNER-RELAY-PLAN.md D-SR8)", () => {
  it("records a read and says whether it reached a device", async () => {
    const base = await start();
    const res = await postScan(base, { scannerId: SCANNER, code: "SIL1:AST:7K3M9P", ageMs: 40 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: true });
    expect(scan.recordRead).toHaveBeenCalledWith({}, station, { scannerId: SCANNER, code: "SIL1:AST:7K3M9P", ageMs: 40 });
  });

  it("is a 404 for a scanner that is not this station's, and refuses an empty or oversized read", async () => {
    const base = await start();
    scan.recordRead.mockResolvedValueOnce({ code: "not_found", error: "x" });
    expect((await postScan(base, { scannerId: SCANNER, code: "X12345", ageMs: 0 })).status).toBe(404);
    expect((await postScan(base, { scannerId: SCANNER, code: "", ageMs: 0 })).status).toBe(400);
    expect((await postScan(base, { scannerId: SCANNER, code: "x".repeat(201), ageMs: 0 })).status).toBe(400);
    expect(scan.recordRead).toHaveBeenCalledTimes(1);
  });

  it("needs the station's token", async () => {
    const base = await start();
    const res = await fetch(`${base}/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scannerId: SCANNER, code: "X12345", ageMs: 0 }),
    });
    expect(res.status).toBe(401);
    expect(scan.recordRead).not.toHaveBeenCalled();
  });

  it("does not spend the print poll's budget", async () => {
    const base = await start();
    // 310 reads: past the station's 300-request budget, inside the scans' own 1,800.
    for (let i = 0; i < 310; i += 1) {
      const res = await postScan(base, { scannerId: SCANNER, code: `CODE-${i}`, ageMs: 0 });
      expect(res.status).toBe(200);
    }
    expect((await fetch(`${base}/jobs/next`, { headers: auth })).status).toBe(204);
  });
});
