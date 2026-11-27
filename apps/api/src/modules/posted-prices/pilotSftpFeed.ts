import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotSftpFile, PilotSftpFileKind, PilotSftpFileState } from "@silvicom/shared";
import type { RemoteFile, SftpSession } from "../../lib/sftpClient.js";
import { readXlsxGrid, type Cell } from "../../lib/xlsxGrid.js";
import type { PilotIngestResult } from "./pilotPriceIngest.js";

/**
 * Pilot's SFTP drop → kept files → the system, without a person (PILOT-SFTP-FEED-PLAN §4).
 *
 * Each run lists Pilot's folder, and for every file not yet in `pilot_sftp_files` (0652): downloads it, copies
 * the bytes into the private `pilot-sftp` bucket, and hands them to the reader for its kind. A Price Quote goes
 * through `ingestPilotPrices` — the SAME function the manual upload and the email feed call, so a quote from SFTP,
 * from email and from a person's upload cannot load differently, and the same quote arriving by two of them is a
 * no-op the second time (prices are keyed on the quote's own Effective Date). Pilot's server is never changed.
 *
 * ── A FILE WITH NO READER IS HELD, NOT DROPPED ───────────────────────────────────────────────────────
 * The Transaction file's layout is unknown: none had arrived when this was written (root empty 2026-11-26). It
 * is kept and recorded `held`, with why. `READER_VERSION` is the contract: when a reader for a kind is written
 * or changed, its number goes up, and the next run re-reads every `held` or `refused` file of that kind from the
 * kept copy — no second download, and nothing depends on Pilot still having the file. A held file is visible on
 * the fuel pages as "waiting for a reader", so a held file is a known gap, not a quiet one.
 *
 * ── WHEN A FILE IS TRIED AGAIN ───────────────────────────────────────────────────────────────────────
 *   - `failed` — SFTP, storage or the database failed: up to MAX_ATTEMPTS, from Pilot (bytes may not be kept);
 *   - `held` / `refused` — only when READER_VERSION for its kind moves past the row's `reader_version`;
 *   - `loaded` / `duplicate` — final.
 */

export type PilotSftpKind = PilotSftpFileKind;
export type PilotSftpState = PilotSftpFileState;

/** 0 = no reader yet; the file is kept and held. Bump a kind's number when its reader is added or changed. */
export const READER_VERSION: Record<PilotSftpKind, number> = { price_quote: 1, transactions: 0, unknown: 0 };
export const BUCKET = "pilot-sftp";
/** The bucket's own ceiling (0652). A larger file is refused before it is downloaded. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTEMPTS = 12;
/** Downloads per run, so a first run against a full folder cannot hold the scheduler lane for long. */
export const MAX_FILES_PER_RUN = 25;
/** Pilot's folder today is flat; two levels leaves room for a per-feed subfolder without walking a tree. */
export const LIST_DEPTH = 2;

export interface PilotSftpDeps {
  /** Opens a session; the run closes it. */
  open: () => Promise<SftpSession>;
  store: (path: string, bytes: Buffer) => Promise<void>;
  /** Reads a kept copy back, for a held file whose kind has gained a reader. */
  fetchKept: (path: string) => Promise<Buffer>;
  ingestPrices: (grid: Cell[][]) => Promise<PilotIngestResult>;
  now: () => Date;
}

export interface PilotSftpRun {
  listed: number;
  settled: number;
  loaded: number;
  held: number;
  refused: number;
  duplicate: number;
  failed: number;
  /** New files left for the next run because this one reached MAX_FILES_PER_RUN. */
  deferred: number;
}

interface LedgerRow {
  id: string;
  remote_path: string;
  remote_size: number;
  remote_mtime: string;
  state: PilotSftpState;
  attempts: number;
  reader_version: number;
  file_sha256: string | null;
  storage_path: string | null;
}

type Outcome = { state: PilotSftpState; kind: PilotSftpKind } & Record<string, unknown>;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * What a file is, from its name. Pilot's emailed quote is `pq-139445-MMDDYYYY.xlsx` (measured 11/11–11/25); the
 * SFTP quote is expected to carry the same name, and anything named for prices or quotes is tried as one — the
 * price reader refuses a file without the report's header, so a wrong guess is a `refused` row, never bad prices.
 */
export function classify(path: string): PilotSftpKind {
  const name = baseName(path).toLowerCase();
  const spreadsheet = /\.xlsx?$/.test(name);
  if (spreadsheet && (/^pq-\d+-\d{8}\./.test(name) || /price|quote/.test(name))) return "price_quote";
  if (/trans|txn/.test(name)) return "transactions";
  return "unknown";
}

const keyOf = (f: { remote_path: string; remote_size: number; remote_mtime: string }) =>
  `${f.remote_path}|${f.remote_size}|${new Date(f.remote_mtime).toISOString()}`;

/** Whether a listed file needs work now, given its row (or none). Pure; exported for the tests. */
export function needsWork(row: LedgerRow | undefined, kind: PilotSftpKind): boolean {
  if (!row) return true;
  if (row.state === "failed") return row.attempts < MAX_ATTEMPTS;
  if (row.state === "held" || row.state === "refused") return READER_VERSION[kind] > row.reader_version;
  return false;
}

/** Read kept bytes with the reader for their kind. Never throws: every result is a row. */
async function readFile(kind: PilotSftpKind, bytes: Buffer, deps: PilotSftpDeps): Promise<Outcome> {
  const reader_version = READER_VERSION[kind];
  if (kind !== "price_quote") {
    const why = kind === "transactions" ? "a Pilot Transaction file" : "a file of a kind this feed does not know";
    return { state: "held", kind, reader_version, error: `Kept: no reader yet for ${why}.` };
  }
  let grid: Cell[][];
  try {
    grid = await readXlsxGrid(bytes);
  } catch (e) {
    return { state: "refused", kind, reader_version, error: `The file would not open: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = await deps.ingestPrices(grid);
  const counts = { effective_date: r.effectiveDate, rows_loaded: r.ok ? r.pricesInserted : null };
  // Nothing parsed = the file is not a quote the reader knows: final until the reader changes. Rows parsed but
  // not loaded = the database or geocoding failed: tried again.
  if (!r.ok) return { state: r.totalRows === 0 ? "refused" : "failed", kind, reader_version, ...counts, error: r.error ?? "The quote would not load." };
  return { state: "loaded", kind, reader_version, ...counts, error: null };
}

async function handle(
  admin: SupabaseClient, orgId: string, file: RemoteFile, row: LedgerRow | undefined, session: SftpSession, deps: PilotSftpDeps,
): Promise<Outcome> {
  const kind = classify(file.path);
  // A held or refused file already has its bytes kept: re-read the copy, Pilot may have removed the original.
  if (row?.storage_path && row.file_sha256 && (row.state === "held" || row.state === "refused")) {
    try {
      return await readFile(kind, await deps.fetchKept(row.storage_path), deps);
    } catch (e) {
      // `failed` sends the next run back to Pilot for the original, if it is still listed there.
      return { state: "failed", kind, error: `Re-read of the kept copy failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (file.size > MAX_FILE_BYTES) return { state: "failed", kind, error: `File is ${file.size} bytes, over the ${MAX_FILE_BYTES}-byte limit.` };
  let bytes: Buffer;
  try {
    bytes = await session.read(file.path, MAX_FILE_BYTES);
  } catch (e) {
    return { state: "failed", kind, error: `Download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const file_sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: same, error: sameError } = await admin
    .from("pilot_sftp_files")
    .select("id, remote_path, storage_path")
    .eq("org_id", orgId)
    .eq("file_sha256", file_sha256)
    .neq("state", "failed")
    .limit(1);
  if (sameError) return { state: "failed", kind, error: `pilot_sftp_files read failed: ${sameError.message}` };
  const twin = (same ?? [])[0] as { remote_path: string; storage_path: string } | undefined;
  if (twin) return { state: "duplicate", kind, file_sha256, storage_path: twin.storage_path, error: `Same bytes as ${twin.remote_path}.` };

  const storage_path = `${orgId}/${deps.now().toISOString().slice(0, 10)}/${file_sha256.slice(0, 16)}-${baseName(file.path)}`;
  try {
    await deps.store(storage_path, bytes);
  } catch (e) {
    return { state: "failed", kind, file_sha256, error: `Keeping the file failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ...(await readFile(kind, bytes, deps)), file_sha256, storage_path };
}

export async function runPilotSftp(admin: SupabaseClient, orgId: string, deps: PilotSftpDeps): Promise<PilotSftpRun> {
  const now = deps.now();
  const run: PilotSftpRun = { listed: 0, settled: 0, loaded: 0, held: 0, refused: 0, duplicate: 0, failed: 0, deferred: 0 };
  const session = await deps.open();
  try {
    const files = await session.listFiles("/", LIST_DEPTH);
    run.listed = files.length;
    if (files.length === 0) return run;

    const { data, error } = await admin
      .from("pilot_sftp_files")
      .select("id, remote_path, remote_size, remote_mtime, state, attempts, reader_version, file_sha256, storage_path")
      .eq("org_id", orgId)
      .in("remote_path", files.map((f) => f.path));
    if (error) throw new Error(`pilot_sftp_files read failed: ${error.message}`);
    const byKey = new Map(((data ?? []) as LedgerRow[]).map((r) => [keyOf(r), r]));

    let worked = 0;
    // Oldest first, so a backlog loads in the order Pilot produced it.
    for (const file of [...files].sort((a, b) => a.mtime.getTime() - b.mtime.getTime())) {
      const row = byKey.get(keyOf({ remote_path: file.path, remote_size: file.size, remote_mtime: file.mtime.toISOString() }));
      if (!needsWork(row, classify(file.path))) {
        run.settled++;
        continue;
      }
      if (worked >= MAX_FILES_PER_RUN) {
        run.deferred++;
        continue;
      }
      worked++;
      const outcome = await handle(admin, orgId, file, row, session, deps);
      const stamp = { ...outcome, last_tried_at: now.toISOString() };
      const write = row
        ? admin.from("pilot_sftp_files").update({ ...stamp, attempts: row.attempts + 1 }).eq("org_id", orgId).eq("id", row.id)
        : admin.from("pilot_sftp_files").insert({
            ...stamp, org_id: orgId, remote_path: file.path, remote_size: file.size, remote_mtime: file.mtime.toISOString(),
          });
      const { error: writeError } = await write;
      if (writeError) throw new Error(`pilot_sftp_files write failed: ${writeError.message}`);
      run[outcome.state]++;
    }
    return run;
  } finally {
    session.close();
  }
}

/** An org's newest files, for the price drawer (newest first). */
export async function readPilotSftpFiles(admin: SupabaseClient, orgId: string, limit = 14): Promise<PilotSftpFile[]> {
  const { data, error } = await admin
    .from("pilot_sftp_files")
    .select("remote_path, remote_size, remote_mtime, kind, state, attempts, effective_date, rows_loaded, error, first_seen_at, last_tried_at")
    .eq("org_id", orgId)
    .order("remote_mtime", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`pilot_sftp_files read failed: ${error.message}`);
  return (data ?? []) as PilotSftpFile[];
}
