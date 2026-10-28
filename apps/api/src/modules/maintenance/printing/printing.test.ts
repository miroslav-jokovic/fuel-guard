import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The print services (PRINTERS-AND-SCANNERS-PLAN.md PS2). What is pinned is the owner's rule and the
 * things that would quietly break it:
 *
 *   · Print never asks while a default exists — the person's own choice wins, the organization's is
 *     next, and a RETIRED default is skipped rather than printed to;
 *   · no default and no printer named is the one `no_printer` answer;
 *   · a retried request with the same id is one job, not two labels;
 *   · the job carries TSPL the RW403B honours, for the printer's own stock and nudge;
 *   · every query is scoped to the caller's organization (the API reads with the service role);
 *   · a pairing code and a token are stored only as hashes, and the code is spent once.
 */

const ORG = "org-1";
const USER = "user-1";
const PRINTER = "11111111-1111-4111-8111-111111111111";
const OTHER_PRINTER = "22222222-2222-4222-8222-222222222222";
const JOB = "44444444-4444-4444-8444-444444444444";
const ASSET = "33333333-3333-4333-8333-333333333333";

const labels = vi.hoisted(() => ({
  resolveLabelFaces: vi.fn(async (_a: unknown, _o: string, _t: unknown[]) => ({
    faces: [
      {
        target: { kind: "asset", assetId: "33333333-3333-4333-8333-333333333333" },
        payload: "SIL1:AST:7K3M9P",
        code: "7K3M9P",
        lines: ["A-0412 · Cab tablet"],
      },
    ],
    dropped: 0,
  })),
}));
vi.mock("../inventory/labels.js", () => labels);

const { getDefaults, setDefault, createPrinter } = await import("./printers.js");
const { printLabels, cancelJob, claimNextJob } = await import("./jobs.js");
const { pairStation, stationForToken, sha256, normalizePairingCode, newPairingCode, toStationDto } = await import(
  "./stations.js"
);

const printerRow = (over: Record<string, unknown> = {}) => ({
  id: PRINTER,
  name: "Office label printer",
  station_id: "st-1",
  system_name: "MUNBYN RW403B",
  language: "tspl",
  stock_id: "roll-single",
  dpi: 203,
  offset_x_dots: 7,
  offset_y_dots: 0,
  retired_at: null,
  print_stations: { name: "Office PC", last_seen_at: new Date().toISOString(), revoked_at: null },
  ...over,
});

const defaultRow = (userId: string | null, printerId: string, retired = false) => ({
  user_id: userId,
  printer_id: printerId,
  printers: { retired_at: retired ? "2026-10-01T00:00:00Z" : null },
});

let rec: SupabaseRecorder;

describe("getDefaults — which printer Print uses without asking", () => {
  it("the person's own choice wins over the organization's", async () => {
    rec = createSupabaseRecorder({ tables: { print_defaults: [defaultRow(null, PRINTER), defaultRow(USER, OTHER_PRINTER)] } });
    const d = await getDefaults(rec.client, ORG, USER, "label");
    expect(d).toMatchObject({ organizationPrinterId: PRINTER, myPrinterId: OTHER_PRINTER, effectivePrinterId: OTHER_PRINTER });
    expectOrgScoped(rec, ORG);
  });

  it("someone else's choice is not mine", async () => {
    rec = createSupabaseRecorder({ tables: { print_defaults: [defaultRow(null, PRINTER), defaultRow("someone", OTHER_PRINTER)] } });
    expect(await getDefaults(rec.client, ORG, USER, "label")).toMatchObject({ myPrinterId: null, effectivePrinterId: PRINTER });
  });

  it("a retired personal default falls back to the organization's, and is still reported", async () => {
    rec = createSupabaseRecorder({ tables: { print_defaults: [defaultRow(null, PRINTER), defaultRow(USER, OTHER_PRINTER, true)] } });
    expect(await getDefaults(rec.client, ORG, USER, "label")).toMatchObject({ myPrinterId: OTHER_PRINTER, effectivePrinterId: PRINTER });
  });

  it("a retired organization default leaves nothing effective", async () => {
    rec = createSupabaseRecorder({ tables: { print_defaults: [defaultRow(null, PRINTER, true)] } });
    expect(await getDefaults(rec.client, ORG, USER, "label")).toMatchObject({ effectivePrinterId: null });
  });
});

describe("setDefault", () => {
  it("replaces the person's own row only, then answers with the new defaults", async () => {
    rec = createSupabaseRecorder({ tables: { print_defaults: [defaultRow(USER, PRINTER)] } });
    await setDefault(rec.client, ORG, USER, { purpose: "label", scope: "me", printerId: PRINTER });
    const del = rec.forTable("print_defaults").find((q) => q.write?.method === "delete")!;
    expect(del.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "user_id", val: USER }]));
    expect(rec.writtenRows("print_defaults")).toEqual([expect.objectContaining({ org_id: ORG, user_id: USER, printer_id: PRINTER })]);
    expectOrgScoped(rec, ORG);
  });

  it("the organization's row is the one with no person, and clearing writes nothing back", async () => {
    rec = createSupabaseRecorder({ tables: { print_defaults: [] } });
    await setDefault(rec.client, ORG, USER, { purpose: "label", scope: "organization", printerId: null });
    const del = rec.forTable("print_defaults").find((q) => q.write?.method === "delete")!;
    expect(del.ops.some((o) => o.method === "is" && o.args[0] === "user_id" && o.args[1] === null)).toBe(true);
    expect(rec.writtenRows("print_defaults")).toEqual([]);
  });

  it("another organization's printer is 'not found' (0526's PS001)", async () => {
    rec = createSupabaseRecorder({
      tables: {
        print_defaults: (q) =>
          q.write?.method === "insert" ? { data: null, error: { code: "PS001", message: "another org" } } : { data: [], error: null },
      },
    });
    expect(await setDefault(rec.client, ORG, USER, { purpose: "label", scope: "me", printerId: OTHER_PRINTER })).toMatchObject({
      code: "not_found",
    });
  });
});

describe("createPrinter", () => {
  it("refuses a sheet stock: a label printer feeds one label at a time", async () => {
    rec = createSupabaseRecorder();
    const result = await createPrinter(rec.client, ORG, USER, {
      name: "x",
      stationId: "55555555-5555-4555-8555-555555555555",
      systemName: "MUNBYN",
      language: "tspl",
      stockId: "avery-22805",
      dpi: 203,
      offsetXDots: 0,
      offsetYDots: 0,
    });
    expect(result).toMatchObject({ code: "unknown_stock" });
    expect(rec.writes()).toHaveLength(0);
  });
});

describe("printLabels", () => {
  const request = { id: JOB, targets: [{ kind: "asset" as const, assetId: ASSET }] };

  const happy = (defaults = [defaultRow(null, PRINTER)], existing: unknown[] = [], printer = printerRow()) =>
    createSupabaseRecorder({
      tables: {
        print_defaults: defaults,
        printers: [printer],
        print_jobs: (q) =>
          q.write?.method === "insert"
            ? [
                {
                  ...(q.write.payload as Record<string, unknown>),
                  status: "queued",
                  error: null,
                  created_at: "2026-10-28T15:00:00Z",
                  finished_at: null,
                  printers: { name: "Office label printer" },
                },
              ]
            : existing,
      },
    });

  beforeEach(() => labels.resolveLabelFaces.mockClear());

  it("prints on the default printer without being told which", async () => {
    rec = happy();
    const result = await printLabels(rec.client, ORG, USER, request);
    expect(result).toMatchObject({ job: { id: JOB, printerId: PRINTER, status: "queued", labelCount: 1 } });
    const [row] = rec.writtenRows("print_jobs");
    expect(row).toMatchObject({ id: JOB, org_id: ORG, printer_id: PRINTER, requested_by: USER, label_count: 1 });
    expectOrgScoped(rec, ORG);
  });

  it("queues TSPL the RW403B honours, sized to the printer's stock, nudged by the printer's offset", async () => {
    rec = happy();
    await printLabels(rec.client, ORG, USER, request);
    const hex = String(rec.writtenRows("print_jobs")[0]!.payload);
    expect(hex.startsWith("\\x")).toBe(true);
    const text = Buffer.from(hex.slice(2), "hex").toString("latin1");
    expect(text.startsWith("SIZE 50.80 mm,50.80 mm\r\n")).toBe(true);
    expect(text).toMatch(/BITMAP 0,0,51,406,3,\d+,/);
    expect(text).not.toMatch(/\b(TEXT|QRCODE|BAR|BOX)\b/);
    // The nudge moves the label: the same face without it is different bytes.
    const plain = happy(undefined, [], printerRow({ offset_x_dots: 0 }));
    await printLabels(plain.client, ORG, USER, request);
    expect(String(plain.writtenRows("print_jobs")[0]!.payload)).not.toBe(hex);
  });

  it("a printer named in the request wins over the default", async () => {
    rec = happy([defaultRow(null, OTHER_PRINTER)]);
    await printLabels(rec.client, ORG, USER, { ...request, printerId: PRINTER });
    expect(rec.forTable("print_defaults")).toHaveLength(0);
    expect(rec.writtenRows("print_jobs")[0]).toMatchObject({ printer_id: PRINTER });
  });

  it("no default and none named is the one time anybody is asked", async () => {
    rec = happy([]);
    expect(await printLabels(rec.client, ORG, USER, request)).toMatchObject({ code: "no_printer" });
    expect(rec.writes()).toHaveLength(0);
    expect(labels.resolveLabelFaces).not.toHaveBeenCalled();
  });

  it("a retried request with the same id answers with the first job and prints nothing new", async () => {
    const first = {
      id: JOB,
      printer_id: PRINTER,
      description: "Label — A-0412",
      label_count: 1,
      status: "sent",
      error: null,
      created_at: "2026-10-28T15:00:00Z",
      finished_at: null,
      printers: { name: "Office label printer" },
    };
    rec = happy(undefined, [first]);
    expect(await printLabels(rec.client, ORG, USER, request)).toMatchObject({ job: { id: JOB, status: "sent" } });
    expect(rec.writes()).toHaveLength(0);
    expect(labels.resolveLabelFaces).not.toHaveBeenCalled();
  });

  it("a retired printer is refused before anything is issued or rendered", async () => {
    rec = happy(undefined, [], printerRow({ retired_at: "2026-10-01T00:00:00Z" }));
    expect(await printLabels(rec.client, ORG, USER, { ...request, printerId: PRINTER })).toMatchObject({ code: "printer_retired" });
    expect(labels.resolveLabelFaces).not.toHaveBeenCalled();
  });
});

describe("cancelJob", () => {
  it("cancels only a job still waiting", async () => {
    rec = createSupabaseRecorder({ tables: { print_jobs: [] } });
    await cancelJob(rec.client, ORG, JOB);
    const update = rec.forTable("print_jobs").find((q) => q.write?.method === "update")!;
    expect(update.filters()).toEqual(expect.arrayContaining([{ col: "status", val: "queued" }, { col: "org_id", val: ORG }]));
  });

  it("says why when the job has already gone to the printer", async () => {
    rec = createSupabaseRecorder({
      tables: {
        print_jobs: (q) =>
          q.write
            ? []
            : [
                {
                  id: JOB,
                  printer_id: PRINTER,
                  description: "x",
                  label_count: 1,
                  status: "printed",
                  error: null,
                  created_at: "2026-10-28T15:00:00Z",
                  finished_at: "2026-10-28T15:00:05Z",
                  printers: { name: "P" },
                },
              ],
      },
    });
    expect(await cancelJob(rec.client, ORG, JOB)).toMatchObject({ code: "job_not_cancellable" });
  });
});

describe("the station's side", () => {
  it("hands over the job's bytes as base64, decoded from Postgres hex", async () => {
    rec = createSupabaseRecorder({
      rpc: { print_claim_next_job: [{ job_id: JOB, system_name: "MUNBYN RW403B", payload: "\\x53495a45", label_count: 1 }] },
    });
    const job = await claimNextJob(rec.client, "st-1");
    expect(job).toEqual({ jobId: JOB, systemName: "MUNBYN RW403B", labelCount: 1, payloadBase64: Buffer.from("SIZE").toString("base64") });
    expect(rec.rpcs()).toEqual([{ fn: "print_claim_next_job", args: { p_station: "st-1" } }]);
  });

  it("an empty queue is null, not an error", async () => {
    rec = createSupabaseRecorder({ rpc: { print_claim_next_job: [] } });
    expect(await claimNextJob(rec.client, "st-1")).toBeNull();
  });
});

describe("pairing", () => {
  it("a code reads the same however it is typed", () => {
    const code = newPairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizePairingCode(code.toLowerCase().replace("-", " "))).toBe(code.replace("-", ""));
  });

  it("trades a live code for a token, storing only the token's hash and spending the code once", async () => {
    const code = "7K3M-9PQX";
    rec = createSupabaseRecorder({
      tables: { print_stations: [{ id: "st-1", org_id: ORG, name: "Office PC", token_hash: null, revoked_at: null }] },
    });
    const result = await pairStation(rec.client, { pairingCode: "7k3m 9pqx", hostName: "OFFICE-PC", agentVersion: "1.0.0" });
    if ("code" in result) throw new Error(result.error);
    const lookup = rec.forTable("print_stations")[0]!;
    expect(lookup.filters()).toContainEqual({ col: "pairing_code_hash", val: sha256(normalizePairingCode(code)) });
    const [written] = rec.writtenRows("print_stations");
    expect(written).toMatchObject({ token_hash: sha256(result.token), pairing_code_hash: null, host_name: "OFFICE-PC" });
    expect(JSON.stringify(written)).not.toContain(result.token);
    const update = rec.forTable("print_stations").find((q) => q.write?.method === "update")!;
    expect(update.filters()).toEqual(
      expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "pairing_code_hash", val: sha256(normalizePairingCode(code)) }]),
    );
  });

  it("a wrong or expired code is one generic refusal", async () => {
    rec = createSupabaseRecorder({ tables: { print_stations: [] } });
    expect(await pairStation(rec.client, { pairingCode: "AAAA-AAAA", hostName: "x", agentVersion: "1" })).toMatchObject({
      code: "invalid_pairing_code",
    });
  });

  it("a token is looked up by its hash, and a revoked station's never matches", async () => {
    const token = "t".repeat(43);
    rec = createSupabaseRecorder({ tables: { print_stations: [] } });
    expect(await stationForToken(rec.client, token)).toBeNull();
    const q = rec.forTable("print_stations")[0]!;
    expect(q.filters()).toContainEqual({ col: "token_hash", val: sha256(token) });
    expect(q.ops.some((o) => o.method === "is" && o.args[0] === "revoked_at")).toBe(true);
  });

  it("a station is online only while it has checked in recently, and never when revoked", () => {
    const now = Date.parse("2026-10-28T15:00:00Z");
    const base = {
      id: "st-1",
      org_id: ORG,
      name: "Office PC",
      token_hash: "a".repeat(64),
      paired_at: "2026-10-28T10:00:00Z",
      agent_version: "1.0.0",
      host_name: "OFFICE-PC",
      pairing_expires_at: null,
      discovered_printers: [{ name: "MUNBYN RW403B" }],
      revoked_at: null,
    };
    expect(toStationDto({ ...base, last_seen_at: "2026-10-28T14:59:30Z" }, now).online).toBe(true);
    expect(toStationDto({ ...base, last_seen_at: "2026-10-28T14:55:00Z" }, now).online).toBe(false);
    expect(toStationDto({ ...base, last_seen_at: "2026-10-28T14:59:30Z", revoked_at: "2026-10-28T14:59:40Z" }, now).online).toBe(false);
    expect(toStationDto({ ...base, last_seen_at: null, pairing_expires_at: "2026-10-28T14:00:00Z" }, now).pairingExpiresAt).toBeNull();
  });
});

describe("printTestLabel", () => {
  it("queues the scanner-test payload on the named printer, issuing no tag", async () => {
    const { printTestLabel } = await import("./jobs.js");
    const { SCANNER_TEST_PAYLOAD } = await import("@silvicom/shared");
    labels.resolveLabelFaces.mockClear();
    rec = createSupabaseRecorder({
      tables: {
        printers: [printerRow()],
        print_jobs: (q) =>
          q.write?.method === "insert"
            ? [{ ...(q.write.payload as Record<string, unknown>), status: "queued", error: null, created_at: "x", finished_at: null, printers: { name: "P" } }]
            : [],
      },
    });
    const result = await printTestLabel(rec.client, ORG, USER, PRINTER, JOB);
    expect(result).toMatchObject({ job: { id: JOB, printerId: PRINTER, labelCount: 1 } });
    expect(labels.resolveLabelFaces).not.toHaveBeenCalled();
    expect(rec.writtenRows("print_jobs")[0]).toMatchObject({ description: "Label — Office label printer" });
    expect(SCANNER_TEST_PAYLOAD).toMatch(/:/);
    expectOrgScoped(rec, ORG);
  });
});
