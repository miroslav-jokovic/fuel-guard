import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { AdsSwipeEntryView } from "@silvicom/shared";

/**
 * Creative studio › Swipe file (V2r, D-AD36). Reading is a view of recruiting; saving, "Read again" and "Archive"
 * are the API's `requireSection("recruitment", "manage")`. Pinned so a viewer is never shown a door the API refuses
 * and a manager is never left without one.
 */
const state = vi.hoisted(() => ({ entries: [] as unknown[], error: null as unknown, acts: [] as Array<{ id: string; act: string }> }));
const who = vi.hoisted(() => ({ manages: false }));
vi.mock("./useAdsSwipe", () => ({
  useAdsSwipe: () => ({ isLoading: ref(false), isFetching: ref(false), data: ref(state.entries), error: ref(state.error), refetch: () => {} }),
  useSwipeAct: () => ({ isPending: ref(false), mutateAsync: async (a: { id: string; act: string }) => void state.acts.push(a) }),
  useSaveSwipe: () => ({ isPending: ref(false), mutateAsync: async () => {} }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => s === "recruitment" && who.manages }) }));
import AdsSwipeCard from "./AdsSwipeCard.vue";

const entry = (over: Partial<AdsSwipeEntryView> = {}): AdsSwipeEntryView => ({
  id: "e1", kind: "page", url: "https://www.carrier.com/jobs", note: null, state: "read",
  reading: [{ topic: "pay", sentence: "Pays $0.70 a mile.", quote: "$0.70 per mile" }],
  dropped: [{ index: 1, reason: "quote_not_on_page" }], last_error: null,
  read_at: "2026-11-18T15:00:00Z", created_at: "2026-11-18T14:00:00Z", created_by_name: "Koni", ...over,
});

const render = () => {
  setActivePinia(createPinia());
  return mount(AdsSwipeCard, { global: { stubs: { AdsSwipeDrawer: true } } });
};

beforeEach(() => {
  state.entries = [entry()];
  state.error = null;
  state.acts = [];
  who.manages = false;
});

describe("AdsSwipeCard", () => {
  it("draws each entry's state, its kept facts with their quotes, and what the check left out", () => {
    const text = render().text();
    for (const s of ["carrier.com/jobs", "Read", "Pay", "Pays $0.70 a mile.", "$0.70 per mile", "1 fact not kept: 1 because its quote is not on the page.", "by Koni"]) {
      expect(text, s).toContain(s);
    }
  });

  it("a viewer reads the list and is offered no door", () => {
    const w = render();
    for (const t of ["save-page", "save-picture", "swipe-read-again", "swipe-archive"]) expect(w.find(`[data-test="${t}"]`).exists(), t).toBe(false);
  });

  it("a manager may save, read again and archive; an entry being read is not offered a second read", async () => {
    who.manages = true;
    state.entries = [entry(), entry({ id: "e2", state: "waiting", reading: null, dropped: [] })];
    const w = render();
    expect(w.find('[data-test="save-page"]').exists()).toBe(true);
    expect(w.find('[data-test="save-picture"]').exists()).toBe(true);
    expect(w.findAll('[data-test="swipe-read-again"]')).toHaveLength(1);
    expect(w.findAll('[data-test="swipe-archive"]')).toHaveLength(2);
    await w.find('[data-test="swipe-read-again"]').trigger("click");
    await w.findAll('[data-test="swipe-archive"]')[1]!.trigger("click");
    await flushPromises();
    expect(state.acts).toEqual([{ id: "e1", act: "read" }, { id: "e2", act: "archive" }]);
  });

  it("an empty file says the Researcher has nothing to read; a failed read offers no save", () => {
    who.manages = true;
    state.entries = [];
    expect(render().text()).toContain("Nothing saved yet, so the Researcher has nothing to read");
    state.error = new Error("down");
    const w = render();
    expect(w.text()).toContain("Could not load the swipe file.");
    expect(w.find('[data-test="save-page"]').exists()).toBe(false);
  });
});
