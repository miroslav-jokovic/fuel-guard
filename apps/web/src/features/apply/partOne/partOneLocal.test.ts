import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { emptyPartOneAnswers } from "./partOneScreens";
import {
  HELD_COPY_TTL_MS,
  HELD_COPY_VERSION,
  clearHeld,
  heldExpiry,
  heldPart,
  readHeld,
  resumeHeld,
  typedAny,
  writeHeld,
  type HeldCopy,
} from "./partOneLocal";

/**
 * Part 1's device copy (C3d1a, Q-AW39) against a real IndexedDB implementation — for the reason
 * `countQueue.test.ts` gives: the copy's value is that it survives things, and a `Map` behind an
 * interface would test the `Map`. Pinned: what is kept (screens 3–6, never screen 7), for how long (the
 * earlier of 72 hours and the link), that expired copies of OTHER links are swept too, that a write asked
 * for before a delete cannot land after it, and that a browser without storage still works.
 */

const NOW = new Date("2026-09-28T12:00:00Z");
const LATER_LINK = "2026-10-15T00:00:00Z";

const copy = (over: Partial<HeldCopy> = {}): HeldCopy => ({
  key: "k-1",
  version: HELD_COPY_VERSION,
  answers: { ...heldPart(emptyPartOneAnswers()), phone: "7082365732" },
  passed: ["about"],
  fromLicence: [],
  savedAt: NOW.toISOString(),
  expiresAt: heldExpiry(NOW, LATER_LINK),
  ...over,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("what is kept", () => {
  it("keeps screens 3–6's answers and nothing of screen 7 or the medical card", () => {
    const a = { ...emptyPartOneAnswers(), prior_positive_2y: true, dot_program_30d: true, medical_card_pending: true };
    expect(Object.keys(heldPart(a)).sort()).toEqual(
      ["address_line1", "address_line2", "cdl", "city", "date_of_birth", "otherHeld", "others", "phone", "postal_code", "state"],
    );
  });

  it("is a copy, not the reactive answers themselves", () => {
    const a = emptyPartOneAnswers();
    const h = heldPart(a);
    a.cdl.licence_number = "D123";
    a.others.push({ state_code: "OH", agency: "", licence_number: "X", expires_on: "2027-01-01" });
    expect(h.cdl.licence_number).toBe("");
    expect(h.others).toEqual([]);
  });

  it("counts any one typed box — including a chosen class, an endorsement and the yes/no gate — as typing", () => {
    expect(typedAny(heldPart(emptyPartOneAnswers()))).toBe(false);
    const cases: Array<(a: ReturnType<typeof emptyPartOneAnswers>) => void> = [
      (a) => (a.city = "Joliet"),
      (a) => (a.address_line2 = "Apt 2"),
      (a) => (a.cdl.cdl_class = "A"),
      (a) => a.cdl.endorsements.push("H"),
      (a) => (a.otherHeld = false),
    ];
    for (const set of cases) {
      const a = emptyPartOneAnswers();
      set(a);
      expect(typedAny(heldPart(a))).toBe(true);
    }
  });
});

describe("for how long", () => {
  it("lives 72 hours when the link outlives that, and dies with the link when it does not", () => {
    expect(heldExpiry(NOW, LATER_LINK)).toBe(new Date(NOW.getTime() + HELD_COPY_TTL_MS).toISOString());
    expect(heldExpiry(NOW, "2026-09-29T00:00:00Z")).toBe("2026-09-29T00:00:00.000Z");
    expect(heldExpiry(NOW, "not a date")).toBe("2026-10-01T12:00:00.000Z");
  });

  it("reads a live copy back, and not one past its expiry", async () => {
    await writeHeld(copy());
    expect((await readHeld("k-1", NOW))?.answers.phone).toBe("7082365732");
    expect(await readHeld("k-1", new Date(NOW.getTime() + HELD_COPY_TTL_MS + 1))).toBeNull();
  });

  it("sweeps every expired copy on the device when any link reads, not only its own", async () => {
    await writeHeld(copy({ key: "stale", expiresAt: "2026-09-28T11:59:59Z" }));
    await writeHeld(copy({ key: "other-live" }));
    await readHeld("k-1", NOW);
    expect(await readHeld("stale", new Date("2026-09-01T00:00:00Z"))).toBeNull();
    expect(await readHeld("other-live", NOW)).not.toBeNull();
  });

  it("deletes a copy of another shape rather than reading it", async () => {
    await writeHeld(copy({ version: HELD_COPY_VERSION + 1 }));
    expect(await readHeld("k-1", NOW)).toBeNull();
    await writeHeld(copy({ key: "k-2", version: HELD_COPY_VERSION }));
    expect(await readHeld("k-2", NOW)).not.toBeNull();
  });
});

describe("in order", () => {
  it("never lets a write asked for before a delete land after it", async () => {
    const write = writeHeld(copy());
    const clear = clearHeld("k-1");
    await Promise.all([write, clear]);
    expect(await readHeld("k-1", NOW)).toBeNull();
  });
});

describe("where a restored walk resumes", () => {
  it("opens on the first held screen not passed, and on screen 7 once all four are", () => {
    expect(resumeHeld([])).toBe("about");
    expect(resumeHeld(["about", "address"])).toBe("licence");
    expect(resumeHeld(["about", "address", "licence", "otherLicences"])).toBe("screening");
  });
});

describe("without storage", () => {
  it("resolves instead of throwing, and keeps nothing", async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error — a browser with storage disabled
    delete globalThis.indexedDB;
    try {
      await expect(writeHeld(copy())).resolves.toBeUndefined();
      await expect(readHeld("k-1", NOW)).resolves.toBeNull();
      await expect(clearHeld("k-1")).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});
