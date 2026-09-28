import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { effectScope, reactive, ref } from "vue";
import { emptyDraft, toDraftPayload, type ApplicationDraft } from "./draft";
import { DRAFT_COPY_TTL_MS, DRAFT_COPY_VERSION, readDraftCopy, replayVerdict, writeDraftCopy, type DraftCopy } from "./draftLocal";
import { draftStatusLabel, useApplicationDraft } from "./useApplicationDraft";

/**
 * Autosave's revision and its copy on the phone (AW10, C3d1b). Pinned: every save names the revision it
 * was typed on and adopts the one it gets back; a stale-revision refusal stops this tab for good and never
 * leaves its older copy to be replayed; the form is on the phone until a save lands with nothing typed
 * since; and on arrival a copy is put back only onto the revision it was typed on.
 *
 * ⚠ Only `setTimeout` is faked: `fake-indexeddb` schedules its own work on `setImmediate`, and faking that
 * would stop the store it is here to exercise.
 */

const saved = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("./useApplication", () => ({ saveApplicationDraft: saved.fn }));

const KEY = "k".repeat(64);
const LINK = "2099-01-01T00:00:00Z";

function run(draft: ApplicationDraft, revision: number | null = 3, local: { key: string; linkExpiresAt: string } | null = { key: KEY, linkExpiresAt: LINK }) {
  const scope = effectScope();
  const rev = ref<number | null>(revision);
  const api = scope.run(() =>
    useApplicationDraft(ref("t".repeat(43)), draft, { enabled: ref(true), section: ref("identity"), revision: rev, local: ref(local) }),
  )!;
  return { ...api, rev, stop: () => scope.stop() };
}

const conflict = () => Object.assign(new Error("changed"), { code: "draft_revision_conflict" });
/** Past both timers, then let the store's own callbacks run. */
const past = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};
/** One draft, built once: `emptyDraft` mints a random employer key, so two calls never serialise alike. */
const PHONE_DRAFT: ApplicationDraft = { ...emptyDraft(), first_name: "Phone" };
const PHONE_PAYLOAD = JSON.parse(JSON.stringify(toDraftPayload(PHONE_DRAFT))) as Record<string, unknown>;
const copy = (over: Partial<DraftCopy> = {}): DraftCopy => ({
  key: KEY, version: DRAFT_COPY_VERSION, payload: PHONE_PAYLOAD,
  section: "identity", baseRevision: 3, savedAt: "2026-09-28T10:00:00.000Z", expiresAt: LINK, ...over,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  saved.fn.mockReset();
  saved.fn.mockResolvedValue({ updatedAt: "2026-09-28T10:00:00Z", revision: 4 });
});
afterEach(() => vi.useRealTimers());

describe("saving against a revision", () => {
  it("names the revision it holds, and the next save names the one it got back", async () => {
    const draft = reactive(emptyDraft());
    const h = run(draft);
    draft.first_name = "Susan";
    await past(2_100);
    expect(saved.fn.mock.calls[0]![3]).toBe(3);
    expect(h.rev.value).toBe(4);
    draft.first_name = "Sue";
    await past(6_000);
    expect(saved.fn.mock.calls[1]![3]).toBe(4);
    h.stop();
  });

  it("sends no revision when the page was served none", async () => {
    const draft = reactive(emptyDraft());
    const h = run(draft, null);
    saved.fn.mockResolvedValue({ updatedAt: "2026-09-28T10:00:00Z" });
    draft.first_name = "Susan";
    await past(2_100);
    expect(saved.fn.mock.calls[0]![3]).toBeNull();
    expect(h.rev.value).toBeNull();
    h.stop();
  });

  it("stops for good on a stale revision, says so, and leaves no copy to replay", async () => {
    const draft = reactive(emptyDraft());
    const h = run(draft);
    saved.fn.mockRejectedValueOnce(conflict());
    draft.first_name = "Susan";
    await past(2_100);
    expect(h.state.value).toBe("conflict");
    expect(draftStatusLabel(h.state.value)).toBe("Not saved — this application was changed on another screen.");
    expect(await readDraftCopy(KEY)).toBeNull();

    draft.first_name = "Sue";
    await past(10_000);
    expect(saved.fn).toHaveBeenCalledTimes(1);
    expect(await readDraftCopy(KEY)).toBeNull();
    await h.flushNow();
    expect(saved.fn).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("treats any other refusal as a signal problem that the next keystroke retries", async () => {
    const draft = reactive(emptyDraft());
    const h = run(draft);
    saved.fn.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "draft_save_failed" }));
    draft.first_name = "Susan";
    await past(2_100);
    expect(h.state.value).toBe("failed");
    draft.first_name = "Sue";
    await past(6_000);
    expect(saved.fn).toHaveBeenCalledTimes(2);
    h.stop();
  });
});

describe("the copy on the phone", () => {
  it("is written as the driver types — the payload autosave sends, its section, the revision it was typed on", async () => {
    const draft = reactive(emptyDraft());
    const h = run(draft);
    saved.fn.mockRejectedValue(new Error("offline"));
    draft.first_name = "Susan";
    await past(400);
    const kept = await readDraftCopy(KEY);
    expect(kept).toMatchObject({ payload: JSON.parse(JSON.stringify(toDraftPayload(draft))), section: "identity", baseRevision: 3 });
    h.stop();
  });

  it("outlives a failed save, and is deleted by the save that lands with nothing typed since", async () => {
    const draft = reactive(emptyDraft());
    const h = run(draft);
    saved.fn.mockRejectedValueOnce(new Error("offline"));
    draft.first_name = "Susan";
    await past(2_100);
    expect(h.state.value).toBe("failed");
    expect((await readDraftCopy(KEY))?.payload).toMatchObject({ first_name: "Susan" });

    draft.last_name = "Godfrey";
    await past(6_000);
    expect(h.state.value).toBe("saved");
    expect(await readDraftCopy(KEY)).toBeNull();
    h.stop();
  });

  it("stays when the driver typed while the save was in flight", async () => {
    const draft = reactive(emptyDraft());
    let land: (v: unknown) => void = () => {};
    saved.fn.mockImplementationOnce(() => new Promise((r) => (land = r)));
    const h = run(draft);
    draft.first_name = "Susan";
    await past(2_100);
    draft.last_name = "Godfrey";
    await past(400);
    land({ updatedAt: "2026-09-28T10:00:00Z", revision: 4 });
    await past(0);
    expect((await readDraftCopy(KEY))?.payload).toMatchObject({ last_name: "Godfrey" });
    h.stop();
  });

  it("dies with the link when the link lapses before the 72 hours do", async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const draft = reactive(emptyDraft());
    const h = run(draft, 3, { key: KEY, linkExpiresAt: soon });
    saved.fn.mockRejectedValue(new Error("offline"));
    draft.first_name = "Susan";
    await past(400);
    expect(await readDraftCopy(KEY)).not.toBeNull();
    expect(await readDraftCopy(KEY, new Date(Date.now() + 2 * 60 * 60 * 1000))).toBeNull();
    expect(DRAFT_COPY_TTL_MS).toBe(72 * 60 * 60 * 1000);
    h.stop();
  });

  it("keeps nothing for a page served no key", async () => {
    const draft = reactive(emptyDraft());
    const h = run(draft, 3, null);
    saved.fn.mockRejectedValue(new Error("offline"));
    draft.first_name = "Susan";
    await past(2_100);
    expect(await readDraftCopy(KEY)).toBeNull();
    expect(await h.replay()).toBe(false);
    h.stop();
  });
});

describe("on arrival", () => {
  it("puts back a copy typed on the revision the server still holds, and says so", async () => {
    await writeDraftCopy(copy());
    const draft = reactive(emptyDraft());
    const h = run(draft, 3);
    expect(await h.replay()).toBe(true);
    expect(draft.first_name).toBe("Phone");
    expect(h.notice.value).toBe("restored");
    h.stop();
  });

  it("drops a copy the server has moved on from, and says the answers were not put back", async () => {
    await writeDraftCopy(copy({ baseRevision: 2 }));
    const draft = reactive({ ...emptyDraft(), first_name: "Server" });
    const h = run(draft, 3);
    expect(await h.replay()).toBe(false);
    expect(draft.first_name).toBe("Server");
    expect(h.notice.value).toBe("dropped");
    expect(await readDraftCopy(KEY)).toBeNull();
    h.stop();
  });

  it("deletes, silently, a copy that holds what the server already holds", async () => {
    const draft = reactive(structuredClone(PHONE_DRAFT));
    await writeDraftCopy(copy({ baseRevision: 1 }));
    const h = run(draft, 3);
    expect(await h.replay()).toBe(false);
    expect(h.notice.value).toBeNull();
    expect(await readDraftCopy(KEY)).toBeNull();
    h.stop();
  });

  it("never puts back a copy whose age nothing can prove", () => {
    const current = toDraftPayload(emptyDraft());
    expect(replayVerdict(copy({ baseRevision: null }), 3, current)).toBe("stale");
    expect(replayVerdict(copy({ baseRevision: 3 }), null, current)).toBe("stale");
    expect(replayVerdict(copy({ baseRevision: null }), null, current)).toBe("stale");
    expect(replayVerdict(copy({ baseRevision: 3 }), 3, current)).toBe("apply");
    expect(replayVerdict(copy({ baseRevision: 9 }), 3, PHONE_PAYLOAD)).toBe("same");
  });
});
