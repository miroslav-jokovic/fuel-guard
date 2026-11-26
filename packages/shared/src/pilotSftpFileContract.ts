/**
 * What became of each file the API took from Pilot's SFTP drop (PILOT-SFTP-FEED-PLAN §6) — one row of
 * `pilot_sftp_files` (0652) as `GET /api/fueling/prices/sftp` returns it, for the price drawer.
 *
 * The kinds and states are the table's CHECKs, restated so the browser can name them; the database stays the
 * authority.
 *   loaded    — read and in the system (a Price Quote: in `fuel_prices` under its own Effective Date)
 *   held      — kept, byte for byte, with no reader yet for its kind; read from the kept copy once one exists
 *   refused   — kept, but the reader for its kind does not recognise it; `error` says why
 *   duplicate — the same bytes as a file already taken under another name
 *   failed    — the download, the copy or the load went wrong; tried again, `error` says why
 */
export const PILOT_SFTP_KINDS = ["price_quote", "transactions", "unknown"] as const;
export type PilotSftpFileKind = (typeof PILOT_SFTP_KINDS)[number];
export const PILOT_SFTP_STATES = ["loaded", "held", "refused", "duplicate", "failed"] as const;
export type PilotSftpFileState = (typeof PILOT_SFTP_STATES)[number];

export interface PilotSftpFile {
  remote_path: string;
  remote_size: number;
  /** When Pilot wrote the file, as its server reports it. */
  remote_mtime: string;
  kind: PilotSftpFileKind;
  state: PilotSftpFileState;
  attempts: number;
  /** A Price Quote's own Effective Date (YYYY-MM-DD), once read. */
  effective_date: string | null;
  rows_loaded: number | null;
  error: string | null;
  first_seen_at: string;
  last_tried_at: string;
}

export interface PilotSftpFilesResponse {
  files: PilotSftpFile[];
}
