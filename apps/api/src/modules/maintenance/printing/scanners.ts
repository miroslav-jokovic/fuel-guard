import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SCANNER_READ_FRESH_MS,
  stationReadsScanners,
  type CreateScannerRequest,
  type ScannerDto,
  type ScannerRead,
  type ScannerReaderStateReport,
  type ScannerStatus,
  type ScannerWaitResponse,
  type SerialPort,
  type StationPortsDto,
  type TakeScannerResponse,
  type UpdateScannerRequest,
} from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import type { ServiceError } from "../inventory/types.js";
import { isOnline } from "./stations.js";
import { readArrived } from "./scannerStation.js";

/**
 * Scanners in Settings, and the tab that holds one (SCANNER-RELAY-PLAN.md SR2; 0532).
 *
 * ── STATUS IS JUDGED HERE, FROM WHAT THE STATION SAID ─────────────────────────────────────────
 * The station reports its ports and, per scanner, whether its reader has the port open; this file
 * turns that into one word, worst first (`ScannerStatus`'s order): the PC is offline, its program is
 * too old, the port would not open, the port is not there, or ready. A report from a station that
 * has since gone offline is not trusted — "ready" an hour ago is not "ready".
 *
 * ── THE WAIT ─────────────────────────────────────────────────────────────────────────────────
 * `waitForReads` is the tab's long poll. It renews the lease first (0532's `scanner_take` — a
 * renewal is a take by the holder), then asks for this tab's fresh reads every half second, or at
 * once when a read arrives in this process, and re-checks that the tab still holds the scanner every
 * five seconds, so a takeover is seen within five seconds rather than at the end of the wait.
 */

const fail = (code: string, error: string): ServiceError => ({ code, error });

const SCANNER_COLUMNS =
  "id, name, station_id, port_name, usb_vendor_id, usb_product_id, held_by, held_session, held_since, held_until, retired_at";

interface ScannerRow {
  id: string;
  name: string;
  station_id: string;
  port_name: string;
  usb_vendor_id: string | null;
  usb_product_id: string | null;
  held_by: string | null;
  held_session: string | null;
  held_since: string | null;
  held_until: string | null;
  retired_at: string | null;
}

interface StationBrief {
  id: string;
  name: string;
  last_seen_at: string | null;
  agent_version: string | null;
  revoked_at: string | null;
  token_hash: string | null;
}

interface PortsRow {
  station_id: string;
  ports: SerialPort[];
  scanner_states: ScannerReaderStateReport[];
}

const leaseLive = (row: ScannerRow, now: number) => row.held_until !== null && Date.parse(row.held_until) > now;

/** One word for Settings, worst first, and the system's own words when there are any. */
export function scannerStatus(
  row: Pick<ScannerRow, "id">,
  station: StationBrief | undefined,
  ports: PortsRow | undefined,
  now = Date.now(),
): { status: ScannerStatus; detail: string | null } {
  const online = !!station && station.revoked_at === null && station.token_hash !== null && isOnline(station.last_seen_at, now);
  if (!online) return { status: "station_offline", detail: null };
  if (!stationReadsScanners(station.agent_version)) return { status: "station_too_old", detail: station.agent_version };
  const state = ports?.scanner_states.find((s) => s.scannerId === row.id);
  if (!state || state.state === "waiting") return { status: "waiting", detail: null };
  if (state.state === "failed") return { status: "failed", detail: state.error ?? null };
  return { status: "ready", detail: state.portName };
}

export async function listScanners(admin: SupabaseClient, orgId: string, userId: string | null): Promise<ScannerDto[] | ServiceError> {
  const { data, error } = await admin.from("scanners").select(SCANNER_COLUMNS).eq("org_id", orgId).is("retired_at", null).order("name");
  if (error) return fail("db_error", error.message);
  const rows = data as ScannerRow[];
  if (rows.length === 0) return [];
  const stationIds = [...new Set(rows.map((r) => r.station_id))];
  const [stations, ports, lastReads] = await Promise.all([
    admin.from("print_stations").select("id, name, last_seen_at, agent_version, revoked_at, token_hash").eq("org_id", orgId).in("id", stationIds),
    admin.from("print_station_ports").select("station_id, ports, scanner_states").eq("org_id", orgId).in("station_id", stationIds),
    // One newest read per scanner. A shop has a handful of scanners, so a query each is the honest
    // shape — `scanner_reads_recent_idx` answers every one from the index.
    Promise.all(
      rows.map((r) =>
        admin
          .from("scanner_reads")
          .select("read_at, delivered_session")
          .eq("org_id", orgId)
          .eq("scanner_id", r.id)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    ),
  ]);
  if (stations.error) return fail("db_error", stations.error.message);
  if (ports.error) return fail("db_error", ports.error.message);
  const stationById = new Map((stations.data as StationBrief[]).map((s) => [s.id, s]));
  const portsByStation = new Map((ports.data as PortsRow[]).map((p) => [p.station_id, p]));
  const now = Date.now();
  const holders = await memberLabels(
    admin,
    orgId,
    rows.filter((r) => leaseLive(r, now) && r.held_by).map((r) => r.held_by!),
  );
  return rows.map((r, i) => {
    const { status, detail } = scannerStatus(r, stationById.get(r.station_id), portsByStation.get(r.station_id), now);
    const last = lastReads[i]?.data as { read_at: string; delivered_session: string | null } | null | undefined;
    return {
      id: r.id,
      name: r.name,
      stationId: r.station_id,
      stationName: stationById.get(r.station_id)?.name ?? "",
      portName: r.port_name,
      retired: r.retired_at !== null,
      status,
      statusDetail: detail,
      holder: leaseLive(r, now)
        ? {
            name: (r.held_by && labelOf(holders.get(r.held_by))) || "Someone",
            since: r.held_since!,
            byYou: userId !== null && r.held_by === userId,
          }
        : null,
      lastReadAt: last?.read_at ?? null,
      lastReadDelivered: last ? last.delivered_session !== null : null,
    };
  });
}

/** Each station's last port report, for "Add scanner" to offer a list rather than a typed name (D-SR2). */
export async function listStationPorts(admin: SupabaseClient, orgId: string): Promise<StationPortsDto[] | ServiceError> {
  const { data, error } = await admin.from("print_station_ports").select("station_id, ports, reported_at").eq("org_id", orgId);
  if (error) return fail("db_error", error.message);
  return (data as Array<{ station_id: string; ports: SerialPort[]; reported_at: string }>).map((r) => ({
    stationId: r.station_id,
    ports: r.ports ?? [],
    reportedAt: r.reported_at,
  }));
}

/** The USB ids the station reported for a port — derived from its report, never sent by a browser. */
async function portIds(admin: SupabaseClient, orgId: string, stationId: string, portName: string) {
  const { data, error } = await admin
    .from("print_station_ports")
    .select("ports")
    .eq("org_id", orgId)
    .eq("station_id", stationId)
    .maybeSingle();
  if (error) return fail("db_error", error.message);
  const port = ((data?.ports ?? []) as SerialPort[]).find((p) => p.name === portName);
  return { usb_vendor_id: port?.vendorId ?? null, usb_product_id: port?.productId ?? null };
}

export async function createScanner(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  body: CreateScannerRequest,
): Promise<{ id: string } | ServiceError> {
  const { data: station, error: stationError } = await admin
    .from("print_stations")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", body.stationId)
    .maybeSingle();
  if (stationError) return fail("db_error", stationError.message);
  if (!station) return fail("not_found", "That print station does not exist.");
  const ids = await portIds(admin, orgId, body.stationId, body.portName);
  if ("code" in ids) return ids;
  const { data, error } = await admin
    .from("scanners")
    .insert({ org_id: orgId, station_id: body.stationId, name: body.name.trim(), port_name: body.portName, created_by: userId, ...ids })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? duplicate(error.message) : fail("db_error", error.message);
  return { id: (data as { id: string }).id };
}

const duplicate = (message: string): ServiceError =>
  message.includes("scanners_one_per_port")
    ? fail("duplicate_port", "Another scanner is already set up on that port.")
    : fail("duplicate_scanner", "A scanner with that name already exists.");

/** Rename, move to another port (its ids re-derived), or retire — which also frees whoever held it. */
export async function updateScanner(
  admin: SupabaseClient,
  orgId: string,
  scannerId: string,
  patch: UpdateScannerRequest,
): Promise<{ id: string } | ServiceError> {
  const { data: current, error: readError } = await admin
    .from("scanners")
    .select(SCANNER_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", scannerId)
    .is("retired_at", null)
    .maybeSingle();
  if (readError) return fail("db_error", readError.message);
  if (!current) return fail("not_found", "That scanner does not exist.");
  const row = current as ScannerRow;
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.portName !== undefined && patch.portName !== row.port_name) {
    const ids = await portIds(admin, orgId, row.station_id, patch.portName);
    if ("code" in ids) return ids;
    Object.assign(update, { port_name: patch.portName, ...ids });
  }
  if (patch.retired) {
    Object.assign(update, { retired_at: new Date().toISOString(), held_by: null, held_session: null, held_since: null, held_until: null });
  }
  if (Object.keys(update).length === 0) return { id: row.id };
  const { error } = await admin.from("scanners").update(update).eq("org_id", orgId).eq("id", scannerId);
  if (error) return error.code === "23505" ? duplicate(error.message) : fail("db_error", error.message);
  return { id: row.id };
}

type TakeOutcome = { outcome: "taken" | "held"; holder: string | null; heldUntil: string };

async function take(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  scannerId: string,
  session: string,
  force: boolean,
): Promise<TakeOutcome | ServiceError> {
  const { data, error } = await admin.rpc("scanner_take", {
    p_org: orgId,
    p_scanner: scannerId,
    p_user: userId,
    p_session: session,
    p_force: force,
  });
  if (error) return fail("db_error", error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { outcome: string; holder: string | null; held_until: string | null } | undefined;
  if (!row || row.outcome === "missing" || row.outcome === "retired") return fail("not_found", "That scanner does not exist.");
  return { outcome: row.outcome === "taken" ? "taken" : "held", holder: row.holder, heldUntil: row.held_until ?? new Date().toISOString() };
}

async function nameOf(admin: SupabaseClient, orgId: string, userId: string | null): Promise<string> {
  if (!userId) return "Someone";
  return labelOf((await memberLabels(admin, orgId, [userId])).get(userId)) ?? "Someone";
}

/** "Use on this device". Held by somebody else and not forced: says who, and changes nothing. */
export async function takeScanner(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  scannerId: string,
  session: string,
  force: boolean,
): Promise<TakeScannerResponse | ServiceError> {
  const result = await take(admin, orgId, userId, scannerId, session, force);
  if ("code" in result) return result;
  return { outcome: result.outcome, holderName: await nameOf(admin, orgId, result.holder), heldUntil: result.heldUntil };
}

/** "Stop using". Only this tab's lease is cleared — a stale tab cannot free a scanner somebody took over. */
export async function releaseScanner(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  scannerId: string,
  session: string,
): Promise<ServiceError | null> {
  const { error } = await admin
    .from("scanners")
    .update({ held_by: null, held_session: null, held_since: null, held_until: null })
    .eq("org_id", orgId)
    .eq("id", scannerId)
    .eq("held_session", session)
    .eq("held_by", userId);
  return error ? fail("db_error", error.message) : null;
}

async function stillHeld(admin: SupabaseClient, orgId: string, userId: string, scannerId: string, session: string) {
  const { data, error } = await admin
    .from("scanners")
    .select("held_by, held_session, held_until")
    .eq("org_id", orgId)
    .eq("id", scannerId)
    .maybeSingle();
  if (error) return fail("db_error", error.message);
  const r = data as Pick<ScannerRow, "held_by" | "held_session" | "held_until"> | null;
  const mine = !!r && r.held_session === session && r.held_by === userId && r.held_until !== null && Date.parse(r.held_until) > Date.now();
  return { mine, holder: r && r.held_until !== null && Date.parse(r.held_until) > Date.now() ? r.held_by : null };
}

async function freshReads(admin: SupabaseClient, orgId: string, scannerId: string, session: string, after: number) {
  const { data, error } = await admin
    .from("scanner_reads")
    .select("id, code, read_at")
    .eq("org_id", orgId)
    .eq("scanner_id", scannerId)
    .eq("delivered_session", session)
    .gt("id", after)
    .gt("read_at", new Date(Date.now() - SCANNER_READ_FRESH_MS).toISOString())
    .order("id")
    .limit(20);
  if (error) return fail("db_error", error.message);
  return (data as Array<{ id: number; code: string; read_at: string }>).map((r): ScannerRead => ({ id: Number(r.id), code: r.code, readAt: r.read_at }));
}

export interface WaitOptions {
  waitMs: number;
  pollEveryMs: number;
  holderCheckEveryMs: number;
  /** True once the browser hung up — nothing more is read for nobody. */
  gone: () => boolean;
}

/** The tab's long poll: renew, then this tab's fresh reads after `after`, or none by the deadline. */
export async function waitForReads(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  scannerId: string,
  session: string,
  after: number,
  options: WaitOptions,
): Promise<ScannerWaitResponse | ServiceError> {
  const renewed = await take(admin, orgId, userId, scannerId, session, false);
  if ("code" in renewed) return renewed;
  if (renewed.outcome === "held") return { held: false, holderName: await nameOf(admin, orgId, renewed.holder), reads: [] };

  const deadline = Date.now() + options.waitMs;
  let nextHolderCheck = Date.now() + options.holderCheckEveryMs;
  for (;;) {
    if (options.gone()) return { held: true, holderName: null, reads: [] };
    const reads = await freshReads(admin, orgId, scannerId, session, after);
    if ("code" in reads) return reads;
    if (reads.length > 0) return { held: true, holderName: null, reads };
    if (Date.now() >= nextHolderCheck) {
      const held = await stillHeld(admin, orgId, userId, scannerId, session);
      if ("code" in held) return held;
      if (!held.mine) return { held: false, holderName: held.holder ? await nameOf(admin, orgId, held.holder) : null, reads: [] };
      nextHolderCheck = Date.now() + options.holderCheckEveryMs;
    }
    const left = deadline - Date.now();
    if (left <= 0) return { held: true, holderName: null, reads: [] };
    await readArrived(scannerId, Math.min(options.pollEveryMs, left));
  }
}
