import { TRUSTED_DEVICE_TTL_DAYS } from "@silvicom/shared";
import { copyExpiry, deleteCopy, isLive, putCopy, readCopy, type CopyRow, type LocalCopySpec } from "./deviceCopies";

/**
 * The token that says "this phone already proved the date of birth" (U2; 0604,
 * `applicationTrustedDeviceContract.ts`).
 *
 * ── WHAT IS KEPT, AND WHY IT MAY BE ───────────────────────────────────────────────────────────
 * One random token per link, under the bundle's `localKey` (never the link's own token, which rotates
 * and is a credential by itself — `linkMemo.ts`). This token is NOT one by itself: the server checks it
 * only on a link that resolves, against a hash salted by the invitation. Somebody who lifts it from
 * this device still needs the link, and somebody with the link still needs this.
 *
 * It dies at the earlier of thirty days and the link's expiry — the server's own rule, kept here too so
 * a dead token is swept from the device rather than tried — and every read sweeps every expired one on
 * the device, as each copy does.
 *
 * ── STORAGE BLOCKED IS NOT BROKEN ─────────────────────────────────────────────────────────────
 * `deviceCopies.ts`: with no IndexedDB (a private window) nothing is kept, and the date of birth is
 * asked on every visit, as it was before this existed.
 */

/** Bumped when `DeviceMemory` changes shape; a row of another version is deleted, never read. */
export const DEVICE_MEMORY_VERSION = 1;
const TTL_MS = TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface DeviceMemory extends CopyRow {
  token: string;
}

/** The token this device holds for the link, if it is still live. */
export async function readDeviceToken(spec: LocalCopySpec | null, now: Date = new Date()): Promise<string | null> {
  if (!spec) return null;
  const row = await readCopy<DeviceMemory>("devices", spec.key, (r) => isLive(r, DEVICE_MEMORY_VERSION, now));
  return row?.token ?? null;
}

export async function keepDeviceToken(spec: LocalCopySpec | null, token: string, now: Date = new Date()): Promise<void> {
  if (!spec) return;
  await putCopy<DeviceMemory>("devices", {
    key: spec.key, version: DEVICE_MEMORY_VERSION, token, expiresAt: copyExpiry(now, TTL_MS, spec.linkExpiresAt),
  });
}

/** The server no longer knows it (run out, or the application was started again): stop offering it. */
export const forgetDeviceToken = (spec: LocalCopySpec | null): Promise<void> =>
  spec ? deleteCopy("devices", spec.key) : Promise.resolve();
