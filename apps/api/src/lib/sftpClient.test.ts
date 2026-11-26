import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { hostKeyFingerprint, samePin, walk } from "./sftpClient.js";

/**
 * The two decisions the SFTP client makes without a server: whether the key a server shows is the pinned one
 * (before the password is sent), and which entries of a listing are files. The connection itself was proved
 * against Pilot's server on 2026-11-26 (PILOT-SFTP-FEED-PLAN §3); a unit test cannot stand in for that.
 */
const KEY = Buffer.from("ssh-rsa pretend-host-key-bytes");
const PRINTED = `SHA256:${createHash("sha256").update(KEY).digest("base64").replace(/=+$/, "")}`;

describe("host key pin", () => {
  it("matches the fingerprint as OpenSSH prints it, with or without the SHA256: prefix", () => {
    expect(`SHA256:${hostKeyFingerprint(KEY)}`).toBe(PRINTED);
    expect(samePin(PRINTED, KEY)).toBe(true);
    expect(samePin(PRINTED.slice("SHA256:".length), KEY)).toBe(true);
    expect(samePin(`  ${PRINTED}\n`, KEY)).toBe(true);
  });

  it("refuses any other key, so a server that is not Pilot's never receives the password", () => {
    expect(samePin(PRINTED, Buffer.from("ssh-rsa some-other-server"))).toBe(false);
    expect(samePin("", KEY)).toBe(false);
  });
});

const DIR = 0o040755;
const FILE = 0o100644;
const entry = (filename: string, mode: number, size = 10, mtime = 1_764_180_000) => ({ filename, attrs: { mode, size, mtime } });

describe("walk", () => {
  it("lists regular files under the root and its subfolders, skipping dot-folders and links", async () => {
    const tree: Record<string, ReturnType<typeof entry>[]> = {
      "/": [entry(".", DIR), entry("..", DIR), entry("pq-139445-11272026.xlsx", FILE, 61_000), entry("Transactions", DIR), entry(".ssh", DIR), entry("link", 0o120777)],
      "/Transactions": [entry("txn-20261126.csv", FILE, 900)],
      "/.ssh": [entry("authorized_keys", FILE)],
    };
    const files = await walk(async (d) => tree[d] ?? [], "/", 2);
    expect(files.map((f) => f.path)).toEqual(["/pq-139445-11272026.xlsx", "/Transactions/txn-20261126.csv"]);
    expect(files[0]).toMatchObject({ size: 61_000, mtime: new Date(1_764_180_000 * 1000) });
  });

  it("stops at the depth asked for", async () => {
    const tree: Record<string, ReturnType<typeof entry>[]> = { "/": [entry("a", DIR)], "/a": [entry("b", DIR), entry("one.csv", FILE)], "/a/b": [entry("two.csv", FILE)] };
    expect((await walk(async (d) => tree[d] ?? [], "/", 1)).map((f) => f.path)).toEqual(["/a/one.csv"]);
  });

  it("an empty root — what Pilot's server held on 2026-11-26 — is no files, not an error", async () => {
    expect(await walk(async () => [], "/", 2)).toEqual([]);
  });
});
