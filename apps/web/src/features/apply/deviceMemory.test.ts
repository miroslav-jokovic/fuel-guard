import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { forgetDeviceToken, keepDeviceToken, readDeviceToken } from "./deviceMemory";

/**
 * The token that says "this phone already proved the date of birth" (U2, 0604): kept under the link's
 * `localKey`, dead at the earlier of thirty days and the link's expiry, and nothing at all with no key.
 */
const SPEC = { key: "a".repeat(64), linkExpiresAt: "2099-01-01T00:00:00Z" };
const NOW = new Date("2026-11-14T15:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("the device's token", () => {
  it("is read back on the same link, and not on another", async () => {
    await keepDeviceToken(SPEC, "tok", NOW);
    expect(await readDeviceToken(SPEC, days(1))).toBe("tok");
    expect(await readDeviceToken({ ...SPEC, key: "b".repeat(64) }, days(1))).toBeNull();
  });

  it("⚠ is gone thirty days after it was kept", async () => {
    await keepDeviceToken(SPEC, "tok", NOW);
    expect(await readDeviceToken(SPEC, days(29))).toBe("tok");
    expect(await readDeviceToken(SPEC, days(30))).toBeNull();
  });

  it("⚠ is gone when the link expires, if that is sooner", async () => {
    const short = { ...SPEC, linkExpiresAt: days(2).toISOString() };
    await keepDeviceToken(short, "tok", NOW);
    expect(await readDeviceToken(short, days(1))).toBe("tok");
    expect(await readDeviceToken(short, days(2))).toBeNull();
  });

  it("is forgotten when asked", async () => {
    await keepDeviceToken(SPEC, "tok", NOW);
    await forgetDeviceToken(SPEC);
    expect(await readDeviceToken(SPEC, NOW)).toBeNull();
  });

  it("keeps and reads nothing for a link with no key", async () => {
    await keepDeviceToken(null, "tok", NOW);
    expect(await readDeviceToken(null, NOW)).toBeNull();
    await expect(forgetDeviceToken(null)).resolves.toBeUndefined();
  });
});
