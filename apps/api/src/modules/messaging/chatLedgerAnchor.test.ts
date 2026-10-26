import { describe, expect, it } from "vitest";
import {
  anchorKey,
  judgeAnchor,
  latestAnchor,
  parseAnchorKey,
  readLatestAnchor,
  writeAnchor,
  type AnchorStore,
} from "./chatLedgerAnchor.js";

/**
 * The chat ledger's external anchor (OFFICE-CHAT-PLAN CHA4). What it can get wrong: name an anchor the
 * reader cannot find again, pick an older anchor over the newest, call a cut or rewritten ledger
 * intact, or call an intact one broken.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const H = (c: string) => c.repeat(64);

function memoryStore(): AnchorStore & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async inventory(prefix) {
      const m = new Map<string, unknown>();
      for (const k of objects.keys()) if (k.startsWith(prefix)) m.set(k, {});
      return m;
    },
    async put(key, body) {
      objects.set(key, new TextDecoder().decode(body));
    },
  };
}

describe("the anchor's key", () => {
  it("names the org, the day, the seq and the hash, and reads back to the same anchor", () => {
    const a = { day: "2026-10-24", seq: 4821, hash: H("a") };
    const key = anchorKey(ORG, a);
    expect(key).toBe(`chat-ledger-anchors/${ORG}/2026-10-24-000000004821-${H("a")}.json`);
    expect(parseAnchorKey(key, ORG)).toEqual(a);
  });

  it("is not fooled by another org's key, a stray object or a malformed name", () => {
    const other = anchorKey("ffffffff-ffff-4fff-8fff-ffffffffffff", { day: "2026-10-24", seq: 1, hash: H("b") });
    expect(parseAnchorKey(other, ORG)).toBeNull();
    expect(parseAnchorKey(`chat-ledger-anchors/${ORG}/README.txt`, ORG)).toBeNull();
    expect(parseAnchorKey(`chat-ledger-anchors/${ORG}/2026-10-24-000000000000-${H("a")}.json`, ORG)).toBeNull();
    expect(parseAnchorKey(`chat-ledger-anchors/${ORG}/2026-10-24-000000000001-${"g".repeat(64)}.json`, ORG)).toBeNull();
  });
});

describe("latestAnchor", () => {
  it("takes the highest seq, whatever order the bucket lists them in", () => {
    const keys = [
      anchorKey(ORG, { day: "2026-10-23", seq: 10, hash: H("1") }),
      anchorKey(ORG, { day: "2026-10-25", seq: 30, hash: H("3") }),
      anchorKey(ORG, { day: "2026-10-24", seq: 20, hash: H("2") }),
      `chat-ledger-anchors/${ORG}/notes.json`,
    ];
    expect(latestAnchor(keys, ORG)).toEqual({ day: "2026-10-25", seq: 30, hash: H("3") });
  });

  it("prefers seq over day — a later day with a lower seq cannot hide the higher one", () => {
    const keys = [
      anchorKey(ORG, { day: "2026-10-26", seq: 5, hash: H("5") }),
      anchorKey(ORG, { day: "2026-10-25", seq: 30, hash: H("3") }),
    ];
    expect(latestAnchor(keys, ORG)!.seq).toBe(30);
  });

  it("is null for an empty or unrelated listing", () => {
    expect(latestAnchor([], ORG)).toBeNull();
    expect(latestAnchor([`chat-ledger-anchors/other/2026-10-24-000000000001-${H("a")}.json`], ORG)).toBeNull();
  });
});

describe("judgeAnchor", () => {
  const anchor = { day: "2026-10-24", seq: 100, hash: H("c") };

  it("has nothing to say without an anchor — the first night", () => {
    expect(judgeAnchor(null, { seq: 3, hash: H("x") }, null)).toBeNull();
  });

  it("holds when the anchored row is still there with its hash and the head is at or past it", () => {
    expect(judgeAnchor(anchor, { seq: 100, hash: H("c") }, { hash: H("c") })).toBeNull();
    expect(judgeAnchor(anchor, { seq: 250, hash: H("d") }, { hash: H("c") })).toBeNull();
  });

  it("names a tail cut off: the head is below the anchor, or the ledger is empty", () => {
    expect(judgeAnchor(anchor, { seq: 99, hash: H("c") }, { hash: H("c") })).toBe("ledger truncated below its anchor");
    expect(judgeAnchor(anchor, null, null)).toBe("ledger truncated below its anchor");
  });

  it("names a rewrite: the anchored row is gone, or carries another hash", () => {
    expect(judgeAnchor(anchor, { seq: 120, hash: H("d") }, null)).toBe("anchored ledger entry missing");
    expect(judgeAnchor(anchor, { seq: 120, hash: H("d") }, { hash: H("e") })).toBe("anchored ledger entry altered");
  });
});

describe("the store", () => {
  it("writes an anchor the next night can list and read back, with the previous one named inside", async () => {
    const store = memoryStore();
    expect(await readLatestAnchor(store, ORG)).toBeNull();
    const first = { day: "2026-10-24", seq: 12, hash: H("1") };
    await writeAnchor(store, ORG, first, { checked: 12, previous: null, writtenAt: "2026-10-24T10:00:03Z" });
    expect(await readLatestAnchor(store, ORG)).toEqual(first);

    const second = { day: "2026-10-25", seq: 40, hash: H("2") };
    const key = await writeAnchor(store, ORG, second, { checked: 40, previous: first, writtenAt: "2026-10-25T10:00:02Z" });
    expect(await readLatestAnchor(store, ORG)).toEqual(second);
    const body = JSON.parse(store.objects.get(key)!) as Record<string, unknown>;
    expect(body).toMatchObject({ org: ORG, day: "2026-10-25", seq: 40, hash: H("2"), checked: 40, previous: first });
    expect(typeof body.note).toBe("string");
  });
});
