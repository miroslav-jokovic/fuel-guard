import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { deleteCopy, putCopy, readCopy } from "./deviceCopies";

/**
 * The apply link's device store (AW10). Pinned here, beside the copies' own tests: C3d1a's one-day-old
 * database is deleted when this one first opens — a copy left in it would never be read or swept again,
 * and it holds a date of birth — and the two stores keep their copies apart.
 */

const openLegacy = () =>
  new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("silvicom-part-one", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("held", { keyPath: "key" });
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("held", "readwrite");
      tx.objectStore("held").put({ key: "k", answers: { date_of_birth: "1985-03-07" } });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
    req.onerror = () => reject(req.error);
  });

const row = (key: string) => ({ key, version: 1, expiresAt: "2099-01-01T00:00:00Z" });

describe("the device store", () => {
  it("deletes C3d1a's database, with the date of birth in it, the first time it opens", async () => {
    await openLegacy();
    expect((await indexedDB.databases()).map((d) => d.name)).toContain("silvicom-part-one");
    await readCopy("partOne", "k", () => true);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain("silvicom-part-one");
  });

  it("keeps Part 1's and Part 2's copies apart under the same key", async () => {
    await putCopy("partOne", { ...row("same"), which: "one" });
    await putCopy("partTwo", { ...row("same"), which: "two" });
    expect(await readCopy<ReturnType<typeof row> & { which: string }>("partOne", "same", () => true)).toMatchObject({ which: "one" });
    await deleteCopy("partOne", "same");
    expect(await readCopy("partOne", "same", () => true)).toBeNull();
    expect(await readCopy<ReturnType<typeof row> & { which: string }>("partTwo", "same", () => true)).toMatchObject({ which: "two" });
  });
});
