import { createHash } from "node:crypto";
import { Client, type SFTPWrapper } from "ssh2";

/**
 * A read-only SFTP session with a PINNED host key (PILOT-SFTP-FEED-PLAN §3).
 *
 * ── WHY THE HOST KEY IS PINNED, NOT TRUSTED ON FIRST USE ─────────────────────────────────────────────
 * The session sends a password. A server that is not Pilot's — a hijacked DNS name, an intercepting hop — would
 * receive it if the client accepted whatever key it was shown. The fingerprint was measured from the office on
 * 2026-11-25 and confirmed from staging the same day; it is a setting (`PILOT_SFTP_HOST_KEY`), so Pilot rotating
 * its key stops the feed loudly ("host key does not match") instead of silently trusting a new one. The
 * comparison is the `SHA256:<base64>` form OpenSSH prints, with or without the prefix.
 *
 * ── WHY ONLY LIST AND READ ───────────────────────────────────────────────────────────────────────────
 * The API never deletes, renames or writes on Pilot's server. Whether a file has been handled is our own record
 * (`pilot_sftp_files`), as the mailbox feeds keep theirs instead of marking mail read — so Pilot's folder stays
 * exactly what Pilot put there, and a person looking at it sees every file Pilot sent.
 *
 * Measured 2026-11-26 against Pilot's server (Serv-U 15.5): `none` auth is refused with `password` offered, and
 * password auth succeeds; the whole login takes about half a second.
 */

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /** `SHA256:<base64>` as OpenSSH prints it; the prefix is optional. */
  hostKeySha256: string;
}

export interface RemoteFile {
  /** Absolute path on the server, `/`-separated. */
  path: string;
  size: number;
  /** Modified time, as the server reports it (seconds resolution). */
  mtime: Date;
}

export interface SftpSession {
  /** Every regular file under `root`, down to `maxDepth` folder levels. Dot-folders are skipped. */
  listFiles(root: string, maxDepth: number): Promise<RemoteFile[]>;
  /** The whole file. Refuses, before reading, a file larger than `maxBytes`. */
  read(path: string, maxBytes: number): Promise<Buffer>;
  close(): void;
}

const READY_TIMEOUT_MS = 30_000;

/** The SHA-256 fingerprint of a raw host key, in OpenSSH's unpadded base64. Exported for the tests. */
export function hostKeyFingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
}

export function samePin(pin: string, key: Buffer): boolean {
  return pin.trim().replace(/^SHA256:/, "").replace(/=+$/, "") === hostKeyFingerprint(key);
}

const joinPath = (dir: string, name: string) => (dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`);

function readdir(sftp: SFTPWrapper, dir: string) {
  return new Promise<Array<{ filename: string; attrs: { size: number; mtime: number; mode: number } }>>((resolve, reject) =>
    sftp.readdir(dir, (e, list) => (e ? reject(new Error(`list ${dir}: ${e.message}`)) : resolve(list))),
  );
}

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

/** Walk `root` breadth-first. Pure over a `readdir`; exported so the tests can drive it without a server. */
export async function walk(
  list: (dir: string) => Promise<Array<{ filename: string; attrs: { size: number; mtime: number; mode: number } }>>,
  root: string,
  maxDepth: number,
): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      for (const entry of await list(dir)) {
        if (entry.filename === "." || entry.filename === "..") continue;
        const type = entry.attrs.mode & S_IFMT;
        const path = joinPath(dir, entry.filename);
        if (type === S_IFDIR) {
          if (!entry.filename.startsWith(".")) next.push(path);
        } else if (type === S_IFREG) {
          out.push({ path, size: entry.attrs.size, mtime: new Date(entry.attrs.mtime * 1000) });
        }
      }
    }
    level = next;
  }
  return out;
}

export function openSftp(cfg: SftpConfig): Promise<SftpSession> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let keyMismatch = false;
    conn.on("ready", () => {
      conn.sftp((e, sftp) => {
        if (e) {
          conn.end();
          return reject(new Error(`SFTP subsystem refused: ${e.message}`));
        }
        resolve({
          listFiles: (root, maxDepth) => walk((dir) => readdir(sftp, dir), root, maxDepth),
          read: (path, maxBytes) =>
            new Promise<Buffer>((res, rej) => {
              sftp.stat(path, (se, st) => {
                if (se) return rej(new Error(`stat ${path}: ${se.message}`));
                if (st.size > maxBytes) return rej(new Error(`${path} is ${st.size} bytes, over the ${maxBytes}-byte limit`));
                sftp.readFile(path, (re, buf) => (re ? rej(new Error(`read ${path}: ${re.message}`)) : res(buf)));
              });
            }),
          close: () => conn.end(),
        });
      });
    });
    conn.on("error", (e) =>
      reject(new Error(keyMismatch ? "Pilot's host key does not match PILOT_SFTP_HOST_KEY — the login was not sent" : `SFTP: ${e.message}`)),
    );
    conn.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      readyTimeout: READY_TIMEOUT_MS,
      // Runs before authentication: returning false ends the handshake, so the password is never sent.
      hostVerifier: (key: Buffer) => {
        const ok = samePin(cfg.hostKeySha256, key);
        if (!ok) keyMismatch = true;
        return ok;
      },
    });
  });
}
