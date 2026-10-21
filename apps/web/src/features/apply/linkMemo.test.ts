import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { effectScope, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { APPLY_COPY } from "./strings";
import {
  LINK_MEMO_GRACE_MS,
  LINK_MEMO_VERSION,
  deadLinkWording,
  linkMemoKey,
  readLinkMemo,
  rememberLink,
  useLinkMemo,
  type LinkFacts,
  type LinkMemo,
} from "./linkMemo";

/**
 * The link memo (Q-AW56 (e)) against a real IndexedDB implementation, for the reason `partOneLocal.test.ts`
 * gives. Pinned: what is kept (a hash, three booleans, two dates — never the token), that the memo outlives the
 * link by the grace and no longer, which dead links get the finished card and which stay neutral, that the
 * composable writes on a live load and reads on a refusal, and that a browser without WebCrypto still works.
 *
 * jsdom has no `crypto.subtle`; the browser does. Node's is put in its place so the hash is the real one.
 */

const NOW = new Date("2026-10-21T12:00:00Z");
const LINK_EXPIRED = "2026-10-15T00:00:00Z";
const LINK_LIVE = "2026-11-01T00:00:00Z";
// A short made-up link token; a hex-looking one reads as a key to the secret scanner.
const TOKEN = "the-link-in-the-text";

const facts = (over: Partial<LinkFacts["phases"]> = {}, expiresAt = LINK_EXPIRED): LinkFacts => ({
  expiresAt,
  phases: { releasesCompletedAt: null, applicationSentAt: null, submittedAt: null, ...over },
});

const memo = (over: Partial<LinkMemo> = {}): LinkMemo => ({
  key: "k",
  version: LINK_MEMO_VERSION,
  expiresAt: "2099-01-01T00:00:00Z",
  linkExpiresAt: LINK_EXPIRED,
  partOneDone: true,
  applicationSent: false,
  submitted: false,
  ...over,
});

/** IndexedDB answers on the macrotask queue, which `flushPromises` does not drain. */
const settled = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !done(); i += 1) await new Promise((r) => setTimeout(r, 5));
};

const subtleWas = globalThis.crypto?.subtle;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
});
afterEach(() => {
  if (!subtleWas) Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
});

describe("the link memo", () => {
  it("keys the memo by a hash that is neither the token nor the database's own", async () => {
    const key = await linkMemoKey(TOKEN);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(TOKEN);
    const bare = Array.from(
      new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    expect(key).not.toBe(bare);
  });

  it("remembers the three phase facts and the link's expiry, and outlives the link by the grace", async () => {
    await rememberLink(TOKEN, facts({ releasesCompletedAt: "2026-10-01T15:00:00Z" }), NOW);
    const row = await readLinkMemo(TOKEN, NOW);
    expect(row).toMatchObject({ partOneDone: true, applicationSent: false, submitted: false, linkExpiresAt: LINK_EXPIRED });
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(Date.parse(row!.expiresAt)).toBe(Date.parse(LINK_EXPIRED) + LINK_MEMO_GRACE_MS);
  });

  it("is rewritten by a later load, so a revived link and a passed phase both land", async () => {
    await rememberLink(TOKEN, facts({}, LINK_EXPIRED), NOW);
    await rememberLink(TOKEN, facts({ releasesCompletedAt: "2026-10-21T12:00:00Z" }, LINK_LIVE), NOW);
    expect(await readLinkMemo(TOKEN, NOW)).toMatchObject({ partOneDone: true, linkExpiresAt: LINK_LIVE });
  });

  it("sweeps a memo past its grace, and one of another shape", async () => {
    await rememberLink(TOKEN, facts({ releasesCompletedAt: "2026-10-01T15:00:00Z" }), NOW);
    const later = new Date(Date.parse(LINK_EXPIRED) + LINK_MEMO_GRACE_MS + 1);
    expect(await readLinkMemo(TOKEN, later)).toBeNull();
    expect(await readLinkMemo(TOKEN, NOW)).toBeNull();
  });

  it("keeps nothing, and throws nothing, where the browser has no WebCrypto", async () => {
    Object.defineProperty(globalThis, "crypto", { value: { subtle: undefined }, configurable: true });
    await expect(rememberLink(TOKEN, facts({ releasesCompletedAt: "x" }), NOW)).resolves.toBeUndefined();
    expect(await linkMemoKey(TOKEN)).toBeNull();
    expect(await readLinkMemo(TOKEN, NOW)).toBeNull();
  });
});

describe("which card a dead link gets", () => {
  it("is finished only when Part 1 was done, nothing was left to fill, and the link's time ran out", () => {
    expect(deadLinkWording(memo(), NOW)).toBe("finished");
    expect(deadLinkWording(memo({ applicationSent: true, submitted: true }), NOW)).toBe("finished");
  });

  it("stays neutral with no memo, with Part 1 unfinished, or with the form sent and never sent back", () => {
    expect(deadLinkWording(null, NOW)).toBe("neutral");
    expect(deadLinkWording(memo({ partOneDone: false }), NOW)).toBe("neutral");
    expect(deadLinkWording(memo({ applicationSent: true }), NOW)).toBe("neutral");
  });

  it("stays neutral for a link dead before its time — revoked or replaced, which the memo cannot speak to", () => {
    expect(deadLinkWording(memo({ linkExpiresAt: LINK_LIVE }), NOW)).toBe("neutral");
  });
});

describe("useLinkMemo", () => {
  const run = () => {
    const token = ref(TOKEN);
    const data = ref<LinkFacts | undefined>(undefined);
    const isError = ref(false);
    const scope = effectScope();
    const copy = scope.run(() => useLinkMemo(token, { data, isError }, () => NOW))!;
    return { token, data, isError, copy, stop: () => scope.stop() };
  };

  it("remembers the link on a live load and says the finished words once the server refuses it", async () => {
    const live = run();
    live.data.value = facts({ releasesCompletedAt: "2026-10-01T15:00:00Z" });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));
    expect(await readLinkMemo(TOKEN, NOW)).not.toBeNull();
    live.stop();

    const reopened = run();
    expect(reopened.copy.value).toEqual({ heading: APPLY_COPY.dead.heading, body: APPLY_COPY.dead.body });
    reopened.isError.value = true;
    await settled(() => reopened.copy.value.heading !== APPLY_COPY.dead.heading);
    expect(reopened.copy.value).toEqual(APPLY_COPY.dead.finished);
    expect(reopened.copy.value.body).toContain("the carrier has it");
    reopened.stop();
  });

  it("keeps the neutral words for a link this device never finished", async () => {
    const live = run();
    live.data.value = facts();
    await flushPromises();
    live.stop();

    const reopened = run();
    reopened.isError.value = true;
    await new Promise((r) => setTimeout(r, 50));
    expect(reopened.copy.value.heading).toBe(APPLY_COPY.dead.heading);
    reopened.stop();
  });
});
