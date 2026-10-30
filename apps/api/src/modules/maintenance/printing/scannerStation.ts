import { EventEmitter } from "node:events";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StationHello, StationScanRequest, StationScanner } from "@silvicom/shared";
import type { ServiceError } from "../inventory/types.js";
import type { StationRow } from "./stations.js";

/**
 * The print station's half of the scanner relay (SCANNER-RELAY-PLAN.md SR2; 0532).
 *
 * A station's hello reports the serial ports its operating system sees and how its reader of each
 * assigned scanner is doing; the answer tells it which scanners to read. Each read it then sends is
 * recorded and routed by the database (`scanner_record_read`), which decides the receiving tab under
 * the scanner row's lock — so this file never decides who gets a read, it only says one arrived.
 *
 * ── THE WAKE-UP ──────────────────────────────────────────────────────────────────────────────
 * The tab's wait (`scannerReads.ts`) asks the database for its reads every half second, which is
 * what works across API processes. `readArrived` lets a wait in THIS process answer at once instead
 * of at the next half second; a process that never sees the read loses nothing but that half second.
 */

const arrivals = new EventEmitter();
arrivals.setMaxListeners(0);

/** Resolve when a read for `scannerId` arrives in this process, or after `ms`. Never rejects. */
export function readArrived(scannerId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      arrivals.off(scannerId, done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    arrivals.on(scannerId, done);
  });
}

const fail = (code: string, error: string): ServiceError => ({ code, error });

/**
 * Keep the station's port report and reader states — the whole row, every hello, so a port that
 * was unplugged disappears from Settings instead of lingering. Every column is in the payload: 0532's
 * NOT NULLs are all satisfied before conflict arbitration (lint:upserts' reason).
 */
export async function recordStationPorts(
  admin: SupabaseClient,
  station: StationRow,
  hello: StationHello,
): Promise<ServiceError | null> {
  const { error } = await admin.from("print_station_ports").upsert(
    {
      station_id: station.id,
      org_id: station.org_id,
      ports: hello.serialPorts,
      scanner_states: hello.scannerStates,
      reported_at: new Date().toISOString(),
    },
    { onConflict: "station_id" },
  );
  return error ? fail("db_error", error.message) : null;
}

/** The live scanners this station is to read — the hello's answer. */
export async function scannersForStation(admin: SupabaseClient, station: StationRow): Promise<StationScanner[] | ServiceError> {
  const { data, error } = await admin
    .from("scanners")
    .select("id, port_name, usb_vendor_id, usb_product_id")
    .eq("org_id", station.org_id)
    .eq("station_id", station.id)
    .is("retired_at", null)
    .order("name");
  if (error) return fail("db_error", error.message);
  return (data as Array<{ id: string; port_name: string; usb_vendor_id: string | null; usb_product_id: string | null }>).map((r) => ({
    id: r.id,
    portName: r.port_name,
    vendorId: r.usb_vendor_id,
    productId: r.usb_product_id,
  }));
}

/**
 * One read from the station. `not_found` for a scanner that is not this station's or was retired
 * (0532's SR002) — the station drops it and picks up the change at its next hello.
 */
export async function recordRead(
  admin: SupabaseClient,
  station: StationRow,
  scan: StationScanRequest,
): Promise<{ delivered: boolean } | ServiceError> {
  const { data, error } = await admin.rpc("scanner_record_read", {
    p_station: station.id,
    p_scanner: scan.scannerId,
    p_code: scan.code,
    p_age_ms: scan.ageMs,
  });
  if (error) {
    if (error.code === "SR002") return fail("not_found", "That scanner is not read by this station.");
    return fail("db_error", error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { delivered: boolean } | undefined;
  arrivals.emit(scan.scannerId);
  return { delivered: row?.delivered === true };
}
