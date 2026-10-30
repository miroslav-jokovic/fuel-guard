import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { createScanner, listScanners, listStationPorts, releaseScanner, scannerStatus, takeScanner, updateScanner, waitForReads } from "./scanners.js";
import { recordRead, recordStationPorts, scannersForStation } from "./scannerStation.js";

/**
 * The scanner relay's services (SCANNER-RELAY-PLAN.md SR2). What is pinned:
 *
 *   · Settings' one word is worst first, and a stale "ready" from an offline station is not ready;
 *   · a scanner's USB ids come from the station's own report, never from the browser;
 *   · retiring a scanner frees whoever held it;
 *   · "Stop using" clears only this tab's lease, never somebody's who took it over;
 *   · the wait renews first, hands over only fresh reads of THIS tab, and notices a takeover;
 *   · every query is scoped to the caller's organization (the API reads with the service role).
 */

const ORG = "org-1";
const USER = "user-1";
const OTHER = "user-2";
const SCANNER = "55555555-5555-4555-8555-555555555555";
const STATION = "66666666-6666-4666-8666-666666666666";
const TAB = "77777777-7777-4777-8777-777777777777";
const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const directory = {
  org_member_directory: [
    { user_id: USER, email: "office@test", full_name: "Mia Office" },
    { user_id: OTHER, email: "tech@test", full_name: "Tom Tech" },
  ],
};

const station = (over: Record<string, unknown> = {}) => ({
  id: STATION,
  name: "Office PC",
  last_seen_at: iso(-5_000),
  agent_version: "1.1.0",
  revoked_at: null,
  token_hash: "a".repeat(64),
  ...over,
});
const scannerRow = (over: Record<string, unknown> = {}) => ({
  id: SCANNER,
  name: "Desk scanner",
  station_id: STATION,
  port_name: "COM3",
  usb_vendor_id: "0581",
  usb_product_id: "0215",
  held_by: null,
  held_session: null,
  held_since: null,
  held_until: null,
  retired_at: null,
  ...over,
});
const reading = (state: "reading" | "waiting" | "failed", error?: string) => ({
  station_id: STATION,
  ports: [{ name: "COM3", vendorId: "0581", productId: "0215" }],
  scanner_states: [{ scannerId: SCANNER, state, portName: "COM3", ...(error ? { error } : {}) }],
});

describe("scannerStatus — one word for Settings, worst first", () => {
  it("an offline station outranks whatever it last reported", () => {
    expect(scannerStatus({ id: SCANNER }, station({ last_seen_at: iso(-10 * 60_000) }), reading("reading"), NOW).status).toBe("station_offline");
    expect(scannerStatus({ id: SCANNER }, undefined, reading("reading"), NOW).status).toBe("station_offline");
    expect(scannerStatus({ id: SCANNER }, station({ revoked_at: iso(-1) }), reading("reading"), NOW).status).toBe("station_offline");
  });

  it("a station whose program predates scanners says so, with its version", () => {
    expect(scannerStatus({ id: SCANNER }, station({ agent_version: "1.0.0" }), undefined, NOW)).toEqual({
      status: "station_too_old",
      detail: "1.0.0",
    });
  });

  it("a port that would not open carries the system's words; a missing one is waiting", () => {
    expect(scannerStatus({ id: SCANNER }, station(), reading("failed", "Access to the port 'COM3' is denied."), NOW)).toEqual({
      status: "failed",
      detail: "Access to the port 'COM3' is denied.",
    });
    expect(scannerStatus({ id: SCANNER }, station(), reading("waiting"), NOW).status).toBe("waiting");
    expect(scannerStatus({ id: SCANNER }, station(), undefined, NOW).status).toBe("waiting");
  });

  it("ready names the port actually open", () => {
    expect(scannerStatus({ id: SCANNER }, station(), reading("reading"), NOW)).toEqual({ status: "ready", detail: "COM3" });
  });
});

describe("listScanners", () => {
  it("names the holder, says whether it is you, and whether the last read reached anybody", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        scanners: [scannerRow({ held_by: OTHER, held_session: TAB, held_since: iso(-60_000), held_until: iso(60_000) })],
        print_stations: [station()],
        print_station_ports: [reading("reading")],
        scanner_reads: [{ read_at: iso(-2_000), delivered_session: null }],
      },
      rpc: directory,
    });
    const [s] = (await listScanners(rec.client, ORG, USER)) as Awaited<ReturnType<typeof listScanners>> & unknown[];
    expect(s).toMatchObject({
      name: "Desk scanner",
      stationName: "Office PC",
      status: "ready",
      holder: { name: "Tom Tech", byYou: false },
      lastReadDelivered: false,
    });
    expectOrgScoped(rec, ORG);
  });

  it("a lapsed lease is nobody's", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        scanners: [scannerRow({ held_by: USER, held_session: TAB, held_since: iso(-200_000), held_until: iso(-1_000) })],
        print_stations: [station()],
      },
      rpc: directory,
    });
    const [s] = (await listScanners(rec.client, ORG, USER)) as unknown as Array<{ holder: unknown; lastReadAt: unknown }>;
    expect(s!.holder).toBeNull();
    expect(s!.lastReadAt).toBeNull();
  });
});

describe("listStationPorts", () => {
  it("is each station's last report, for this organization only", async () => {
    const rec = createSupabaseRecorder({ tables: { print_station_ports: [{ station_id: STATION, ports: [{ name: "COM3" }], reported_at: iso(0) }] } });
    expect(await listStationPorts(rec.client, ORG)).toEqual([{ stationId: STATION, ports: [{ name: "COM3" }], reportedAt: iso(0) }]);
    expectOrgScoped(rec, ORG);
  });
});

describe("createScanner / updateScanner", () => {
  it("takes the USB ids from the station's report of that port", async () => {
    const rec = createSupabaseRecorder({
      tables: { print_stations: [{ id: STATION }], print_station_ports: [{ ports: [{ name: "COM3", vendorId: "0581", productId: "0215" }] }], scanners: [{ id: SCANNER }] },
    });
    expect(await createScanner(rec.client, ORG, USER, { name: " Desk scanner ", stationId: STATION, portName: "COM3" })).toEqual({ id: SCANNER });
    expect(rec.writtenRows("scanners")).toEqual([
      { org_id: ORG, station_id: STATION, name: "Desk scanner", port_name: "COM3", created_by: USER, usb_vendor_id: "0581", usb_product_id: "0215" },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("a port the station never reported ids for gets none, and another org's station does not exist", async () => {
    const rec = createSupabaseRecorder({ tables: { print_stations: [{ id: STATION }], print_station_ports: [], scanners: [{ id: SCANNER }] } });
    await createScanner(rec.client, ORG, USER, { name: "Desk", stationId: STATION, portName: "/dev/cu.usbmodem1101" });
    expect(rec.writtenRows("scanners")[0]).toMatchObject({ usb_vendor_id: null, usb_product_id: null });
    const none = createSupabaseRecorder({ tables: { print_stations: [] } });
    expect(await createScanner(none.client, ORG, USER, { name: "Desk", stationId: STATION, portName: "COM3" })).toMatchObject({ code: "not_found" });
  });

  it("names which uniqueness was hit", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        print_stations: [{ id: STATION }],
        scanners: { data: [], writeError: { code: "23505", message: 'duplicate key value violates unique constraint "scanners_one_per_port"' } },
      },
    });
    expect(await createScanner(rec.client, ORG, USER, { name: "Desk", stationId: STATION, portName: "COM3" })).toMatchObject({ code: "duplicate_port" });
  });

  it("retiring frees whoever held it", async () => {
    const rec = createSupabaseRecorder({ tables: { scanners: [scannerRow({ held_by: OTHER, held_session: TAB, held_since: iso(-1), held_until: iso(60_000) })] } });
    await updateScanner(rec.client, ORG, SCANNER, { retired: true });
    expect(rec.writtenRows("scanners")[0]).toMatchObject({ held_by: null, held_session: null, held_since: null, held_until: null });
    expect(rec.writtenRows("scanners")[0]!.retired_at).toEqual(expect.any(String));
    expectOrgScoped(rec, ORG);
  });

  it("moving to another port re-derives its ids", async () => {
    const rec = createSupabaseRecorder({
      tables: { scanners: [scannerRow()], print_station_ports: [{ ports: [{ name: "COM5", vendorId: "0581", productId: "0216" }] }] },
    });
    await updateScanner(rec.client, ORG, SCANNER, { portName: "COM5" });
    expect(rec.writtenRows("scanners")[0]).toEqual({ port_name: "COM5", usb_vendor_id: "0581", usb_product_id: "0216" });
  });
});

describe("taking and letting go", () => {
  it("held by somebody else: names them", async () => {
    const rec = createSupabaseRecorder({ rpc: { scanner_take: [{ outcome: "held", holder: OTHER, held_until: iso(60_000) }], ...directory } });
    expect(await takeScanner(rec.client, ORG, USER, SCANNER, TAB, false)).toMatchObject({ outcome: "held", holderName: "Tom Tech" });
    expect(rec.rpcs()[0]).toEqual({ fn: "scanner_take", args: { p_org: ORG, p_scanner: SCANNER, p_user: USER, p_session: TAB, p_force: false } });
  });

  it("a retired or unknown scanner is not found", async () => {
    const rec = createSupabaseRecorder({ rpc: { scanner_take: [{ outcome: "retired", holder: null, held_until: null }] } });
    expect(await takeScanner(rec.client, ORG, USER, SCANNER, TAB, true)).toMatchObject({ code: "not_found" });
  });

  it("letting go clears only this tab's lease, by this person", async () => {
    const rec = createSupabaseRecorder({ tables: { scanners: [] } });
    await releaseScanner(rec.client, ORG, USER, SCANNER, TAB);
    const [q] = rec.forTable("scanners");
    expect(q!.filters()).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: ORG },
        { col: "id", val: SCANNER },
        { col: "held_session", val: TAB },
        { col: "held_by", val: USER },
      ]),
    );
  });
});

describe("waitForReads — the tab's long poll", () => {
  const options = { waitMs: 80, pollEveryMs: 10, holderCheckEveryMs: 30, gone: () => false };

  it("renews, then hands over this tab's fresh reads after the cursor", async () => {
    const rec = createSupabaseRecorder({
      tables: { scanner_reads: [{ id: 42, code: "SIL1:AST:7K3M9P", read_at: iso(-500) }] },
      rpc: { scanner_take: [{ outcome: "taken", holder: USER, held_until: iso(90_000) }] },
    });
    expect(await waitForReads(rec.client, ORG, USER, SCANNER, TAB, 41, options)).toEqual({
      held: true,
      holderName: null,
      reads: [{ id: 42, code: "SIL1:AST:7K3M9P", readAt: iso(-500) }],
    });
    const [q] = rec.forTable("scanner_reads");
    expect(q!.filters()).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: ORG },
        { col: "scanner_id", val: SCANNER },
        { col: "delivered_session", val: TAB },
        { col: "id", val: 41 },
      ]),
    );
    // D-SR5: only reads younger than a minute.
    const fresh = q!.filters().find((f) => f.col === "read_at");
    expect(Date.parse(String(fresh?.val))).toBeGreaterThan(Date.now() - 61_000);
    expect(Date.parse(String(fresh?.val))).toBeLessThan(Date.now() - 59_000);
    expectOrgScoped(rec, ORG);
  });

  it("a tab that lost the scanner is told who has it, and reads nothing", async () => {
    const rec = createSupabaseRecorder({ rpc: { scanner_take: [{ outcome: "held", holder: OTHER, held_until: iso(60_000) }], ...directory } });
    expect(await waitForReads(rec.client, ORG, USER, SCANNER, TAB, 0, options)).toEqual({ held: false, holderName: "Tom Tech", reads: [] });
    expect(rec.forTable("scanner_reads")).toHaveLength(0);
  });

  it("notices a takeover while it waits", async () => {
    const rec = createSupabaseRecorder({
      tables: { scanner_reads: [], scanners: [{ held_by: OTHER, held_session: "someone-else", held_until: iso(60_000) }] },
      rpc: { scanner_take: [{ outcome: "taken", holder: USER, held_until: iso(90_000) }], ...directory },
    });
    expect(await waitForReads(rec.client, ORG, USER, SCANNER, TAB, 0, options)).toEqual({ held: false, holderName: "Tom Tech", reads: [] });
  });

  it("nothing by the deadline is an empty answer, still held", async () => {
    const rec = createSupabaseRecorder({
      tables: { scanner_reads: [], scanners: [{ held_by: USER, held_session: TAB, held_until: iso(60_000) }] },
      rpc: { scanner_take: [{ outcome: "taken", holder: USER, held_until: iso(90_000) }] },
    });
    expect(await waitForReads(rec.client, ORG, USER, SCANNER, TAB, 0, options)).toEqual({ held: true, holderName: null, reads: [] });
    expect(rec.forTable("scanner_reads").length).toBeGreaterThan(2);
  });

  it("answers at once when a read arrives in this process", async () => {
    let reads: unknown[] = [];
    const rec = createSupabaseRecorder({
      tables: { scanner_reads: () => reads, scanners: [{ held_by: USER, held_session: TAB, held_until: iso(60_000) }] },
      rpc: {
        scanner_take: [{ outcome: "taken", holder: USER, held_until: iso(90_000) }],
        scanner_record_read: [{ read_id: 7, delivered: true }],
      },
    });
    const started = Date.now();
    const pending = waitForReads(rec.client, ORG, USER, SCANNER, TAB, 0, { ...options, waitMs: 5_000, pollEveryMs: 4_000, holderCheckEveryMs: 4_000 });
    await new Promise((r) => setTimeout(r, 30));
    reads = [{ id: 7, code: "X12345", read_at: iso(0) }];
    await recordRead(rec.client, { id: STATION, org_id: ORG } as never, { scannerId: SCANNER, code: "X12345", ageMs: 0 });
    expect(((await pending) as { reads: unknown[] }).reads).toEqual([{ id: 7, code: "X12345", readAt: iso(0) }]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("the station's side", () => {
  const stationRow = { id: STATION, org_id: ORG } as never;

  it("replaces the whole port report on every hello", async () => {
    const rec = createSupabaseRecorder({ tables: { print_station_ports: [] } });
    await recordStationPorts(rec.client, stationRow, {
      hostName: "OFFICE-PC",
      agentVersion: "1.1.0",
      printers: [],
      serialPorts: [{ name: "COM3" }],
      scannerStates: [],
    });
    expect(rec.writtenRows("print_station_ports")[0]).toMatchObject({ station_id: STATION, org_id: ORG, ports: [{ name: "COM3" }], scanner_states: [] });
  });

  it("hands the station only its own live scanners", async () => {
    const rec = createSupabaseRecorder({ tables: { scanners: [{ id: SCANNER, port_name: "COM3", usb_vendor_id: "0581", usb_product_id: null }] } });
    expect(await scannersForStation(rec.client, stationRow)).toEqual([{ id: SCANNER, portName: "COM3", vendorId: "0581", productId: null }]);
    const [q] = rec.forTable("scanners");
    expect(q!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "station_id", val: STATION }, { col: "retired_at", val: null }]));
  });

  it("a read for a scanner that is not this station's is not found", async () => {
    const rec = createSupabaseRecorder({ rpc: () => ({ data: null, error: { code: "SR002", message: "no" } }) });
    expect(await recordRead(rec.client, stationRow, { scannerId: SCANNER, code: "X12345", ageMs: 0 })).toMatchObject({ code: "not_found" });
  });
});
