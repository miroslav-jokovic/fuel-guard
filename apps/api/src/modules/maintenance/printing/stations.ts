import { createHash, randomBytes, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STATION_ONLINE_WINDOW_MS, type PairingCodeDto, type PrintStationDto, type StationHello } from "@silvicom/shared";
import type { ServiceError } from "../inventory/types.js";

/**
 * Print stations — the always-on machine beside a printer (PRINTERS-AND-SCANNERS-PLAN.md §4, 0526).
 *
 * ── HOW A STATION GETS ITS CREDENTIAL ────────────────────────────────────────────────────────
 * Somebody with the right to manage printers adds a station in Settings and is shown an eight-
 * character PAIRING CODE, valid for fifteen minutes. They type it into the station program once;
 * the program trades it for a long-lived TOKEN and keeps that. Only hashes of either are stored
 * (0526's header), so a database read cannot be turned into a working station. Asking for a new code
 * on a paired station and pairing again REPLACES the token — which is how a station moves to a new
 * PC, and how a lost one is cut off without deleting its history.
 *
 * The code alphabet leaves out 0/O, 1/I/L: it is read off a screen and typed by hand at a PC.
 */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
export const PAIRING_CODE_TTL_MS = 15 * 60_000;

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** "7K3M-9PQX" as typed, "7k3m 9pqx" as typed carelessly — both the same code. */
export const normalizePairingCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function newPairingCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** 256 bits, URL-safe — the station's bearer credential. */
export const newStationToken = (): string => randomBytes(32).toString("base64url");

export interface StationRow {
  id: string;
  org_id: string;
  name: string;
  token_hash: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
  agent_version: string | null;
  host_name: string | null;
  pairing_expires_at: string | null;
  discovered_printers: Array<{ name: string }> | null;
  revoked_at: string | null;
}

export const STATION_COLUMNS =
  "id, org_id, name, token_hash, paired_at, last_seen_at, agent_version, host_name, pairing_expires_at, discovered_printers, revoked_at";

export const isOnline = (lastSeenAt: string | null, now = Date.now()): boolean =>
  lastSeenAt !== null && now - Date.parse(lastSeenAt) <= STATION_ONLINE_WINDOW_MS;

export function toStationDto(row: StationRow, now = Date.now()): PrintStationDto {
  const pairingLive = row.pairing_expires_at !== null && Date.parse(row.pairing_expires_at) > now;
  return {
    id: row.id,
    name: row.name,
    paired: row.token_hash !== null,
    online: row.revoked_at === null && row.token_hash !== null && isOnline(row.last_seen_at, now),
    lastSeenAt: row.last_seen_at,
    hostName: row.host_name,
    agentVersion: row.agent_version,
    revoked: row.revoked_at !== null,
    pairingExpiresAt: pairingLive ? row.pairing_expires_at : null,
    discoveredPrinters: (row.discovered_printers ?? []).filter((p) => typeof p?.name === "string"),
  };
}

const fail = (code: string, error: string): ServiceError => ({ code, error });

export async function listStations(admin: SupabaseClient, orgId: string): Promise<PrintStationDto[] | ServiceError> {
  const { data, error } = await admin.from("print_stations").select(STATION_COLUMNS).eq("org_id", orgId).order("name");
  if (error) return fail("db_error", error.message);
  return (data as StationRow[]).map((r) => toStationDto(r));
}

/** Add a station and show its first pairing code. */
export async function createStation(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  name: string,
): Promise<PairingCodeDto | ServiceError> {
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("print_stations")
    .insert({
      org_id: orgId,
      name: name.trim(),
      created_by: userId,
      pairing_code_hash: sha256(normalizePairingCode(code)),
      pairing_expires_at: expiresAt,
    })
    .select(STATION_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return fail("duplicate_station", "A print station with that name already exists.");
    return fail("db_error", error.message);
  }
  return { station: toStationDto(data as StationRow), pairingCode: code, expiresAt };
}

/** A fresh code for an existing station — to pair it the first time, or to move it to a new PC. */
export async function renewPairingCode(
  admin: SupabaseClient,
  orgId: string,
  stationId: string,
): Promise<PairingCodeDto | ServiceError> {
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("print_stations")
    .update({ pairing_code_hash: sha256(normalizePairingCode(code)), pairing_expires_at: expiresAt, revoked_at: null })
    .eq("org_id", orgId)
    .eq("id", stationId)
    .select(STATION_COLUMNS)
    .maybeSingle();
  if (error) return fail("db_error", error.message);
  if (!data) return fail("not_found", "That print station does not exist.");
  return { station: toStationDto(data as StationRow), pairingCode: code, expiresAt };
}

/** Cut a station off: its token stops working at once; its printers and their history stay. */
export async function revokeStation(
  admin: SupabaseClient,
  orgId: string,
  stationId: string,
): Promise<PrintStationDto | ServiceError> {
  const { data, error } = await admin
    .from("print_stations")
    .update({ revoked_at: new Date().toISOString(), pairing_code_hash: null, pairing_expires_at: null })
    .eq("org_id", orgId)
    .eq("id", stationId)
    .select(STATION_COLUMNS)
    .maybeSingle();
  if (error) return fail("db_error", error.message);
  if (!data) return fail("not_found", "That print station does not exist.");
  return toStationDto(data as StationRow);
}

/**
 * The station program's first call: a pairing code in, a token out. One generic refusal for a wrong,
 * expired or used code, so the endpoint does not say which codes exist.
 */
export async function pairStation(
  admin: SupabaseClient,
  input: { pairingCode: string; hostName: string; agentVersion: string },
): Promise<{ token: string; stationName: string } | ServiceError> {
  const codeHash = sha256(normalizePairingCode(input.pairingCode));
  const { data, error } = await admin
    .from("print_stations")
    .select(STATION_COLUMNS)
    .eq("pairing_code_hash", codeHash)
    .gt("pairing_expires_at", new Date().toISOString())
    .is("revoked_at", null)
    .maybeSingle();
  if (error) return fail("db_error", error.message);
  if (!data) return fail("invalid_pairing_code", "That pairing code is wrong or has expired. Ask for a new one in Settings.");
  const row = data as StationRow;
  const token = newStationToken();
  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("print_stations")
    .update({
      token_hash: sha256(token),
      paired_at: now,
      last_seen_at: now,
      pairing_code_hash: null,
      pairing_expires_at: null,
      host_name: input.hostName,
      agent_version: input.agentVersion,
    })
    .eq("org_id", row.org_id)
    .eq("id", row.id)
    // The code is spent exactly once: a second pairing racing this one finds the hash already gone.
    .eq("pairing_code_hash", codeHash);
  if (updateError) return fail("db_error", updateError.message);
  return { token, stationName: row.name };
}

/** Who is calling, from the bearer token — or null for any token that is not a live station's. */
export async function stationForToken(admin: SupabaseClient, token: string): Promise<StationRow | null> {
  if (token.length < 20 || token.length > 200) return null;
  const { data, error } = await admin
    .from("print_stations")
    .select(STATION_COLUMNS)
    .eq("token_hash", sha256(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return data as StationRow;
}

/** The station says what it is and which printers its operating system has; also a heartbeat. */
export async function stationHello(admin: SupabaseClient, station: StationRow, hello: StationHello): Promise<ServiceError | null> {
  const { error } = await admin
    .from("print_stations")
    .update({
      host_name: hello.hostName,
      agent_version: hello.agentVersion,
      discovered_printers: hello.printers,
      last_seen_at: new Date().toISOString(),
    })
    .eq("org_id", station.org_id)
    .eq("id", station.id);
  return error ? fail("db_error", error.message) : null;
}
