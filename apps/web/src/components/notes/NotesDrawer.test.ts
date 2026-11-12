import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { UnitNoteSearchHit } from "@silvicom/shared";

/**
 * The notes drawer (UNIT-NOTES-PLAN D-UN6/7/10/12/14). What the office relies on:
 *  · the URL opens it on the unit, the pinned note above the rest, newest first;
 *  · only a viewer holding the `notes` surface gets a drawer — and no request is made for anybody else;
 *  · a note is written through the contract's own schema (trimmed, about exactly one unit);
 *  · pin and unpin, the search's "All units", its "No exact match. Close matches:";
 *  · a failed read says so and retries, an empty unit invites the first note;
 *  · `&note=` marks that note (the bell, UN7); closing takes `notes`/`note` off the URL and nothing else;
 *  · D-UN10: every 10 s it asks only for notes after the newest it holds and lays them on top.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const who = vi.hoisted(() => ({ role: "admin", surfaces: null as Record<string, boolean> | null }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("admin"), { isAuthenticated: true, orgId: null });
  return {
    useSessionStore: () => {
      s.role = who.role as typeof s.role;
      s.surfaces = who.surfaces;
      return s;
    },
  };
});
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => new Set<string>()) }) };
});
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: toastError }) }));

import NotesDrawer from "./NotesDrawer.vue";

const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const N3 = "33333333-3333-4333-8333-333333333333";
const ANA = "44444444-4444-4444-8444-444444444444";
const note = (id: string, o: Partial<UnitNoteSearchHit> = {}): UnitNoteSearchHit => ({
  id, kind: "vehicle", subjectId: VEH, subjectLabel: "1042", body: "Tire low on the left steer", authorId: ANA, authorName: "Ana Dispatch",
  pinned: false, createdAt: "2026-11-10T15:00:00+00:00", mentions: [], fuzzy: false, ...o,
});
const ok = <T>(data: T) => ({ ok: true, status: 200, data });
const fail = { ok: false, status: 500, error: { code: "error", message: "boom" } };

let listAnswer: () => unknown;
let router: Router;
const mounted: VueWrapper[] = [];
async function render(at: string) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles", component: { template: "<div/>" } }] });
  await router.push(at);
  await router.isReady();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({ setup: () => () => h(NotesDrawer) });
  const w = mount(Host, { attachTo: document.body, global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]] } });
  mounted.push(w);
  await flushPromises();
  return w;
}
const calls = () => apiFetch.mock.calls.map((c) => ({ path: String(c[0]), init: c[1] as { method?: string; body?: unknown } | undefined }));
const listCalls = () => calls().filter((c) => c.path.startsWith("/api/notes?") || c.path === "/api/notes" && !c.init?.method);
const rows = () => [...document.body.querySelectorAll("[data-note]")];
const drawer = () => document.body.querySelector("[data-notes-drawer]");
const button = (text: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  who.role = "admin";
  who.surfaces = null;
  listAnswer = () => ok({ notes: [note(N2, { createdAt: "2026-11-11T15:00:00+00:00" }), note(N1, { pinned: true, body: "Owner-op, call before dispatch" })], fuzzy: false, next: null });
  apiFetch.mockImplementation(async (path: string, init?: { method?: string; body?: { pinned?: boolean } }) => {
    if (path === "/api/notes/people") return ok({ people: [{ id: ANA, name: "Ana Dispatch" }] });
    if (path === "/api/notes" && init?.method === "POST") return ok({ note: note(N3, { body: "x" }) });
    if (path.endsWith("/pin")) return ok({ pinned: init?.body?.pinned });
    if (path.startsWith("/api/notes")) return listAnswer();
    return ok({});
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  toastError.mockReset();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("NotesDrawer", () => {
  it("opens from ?notes= on that unit, the pinned note above the newer one", async () => {
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(drawer()).not.toBeNull();
    expect(listCalls()[0]!.path).toBe(`/api/notes?subjects=vehicle%3A${VEH}`);
    expect(rows().map((r) => r.id)).toEqual([`note-${N1}`, `note-${N2}`]);
    expect(document.body.querySelector("[aria-label='Pinned']")?.textContent).toContain("Owner-op");
    // A pasted link carries no name; the drawer reads it off the notes.
    expect(document.body.textContent).toContain("Notes · Truck 1042");
    expect(document.body.textContent).toContain("Visible to the whole office. No medical or test results.");
  });

  it("shows newest first even when an answer arrives out of order, the pin still on top", async () => {
    listAnswer = () => ok({ notes: [note(N2, { createdAt: "2026-11-09T15:00:00+00:00" }), note(N3, { createdAt: "2026-11-11T15:00:00+00:00" }), note(N1, { pinned: true })], fuzzy: false, next: null });
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(rows().map((r) => r.id)).toEqual([`note-${N1}`, `note-${N3}`, `note-${N2}`]);
  });

  it("is no drawer, and asks nothing, for a viewer without the notes surface (dark, D-UN14)", async () => {
    who.role = "dispatcher";
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(drawer()).toBeNull();
    expect(calls().filter((c) => c.path.startsWith("/api/notes"))).toEqual([]);
  });

  it("opens for a dispatcher once the carrier switches the screen on for the role", async () => {
    who.role = "dispatcher";
    who.surfaces = { notes: true };
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(drawer()).not.toBeNull();
  });

  it("never opens for the driver role, whatever the screen answer says", async () => {
    who.role = "driver";
    who.surfaces = { notes: true };
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(drawer()).toBeNull();
  });

  it("writes a note about the unit, trimmed, and only once there are words", async () => {
    await render(`/vehicles?notes=vehicle:${VEH}`);
    const add = button("Add note")!;
    expect(add.disabled).toBe(true);
    const box = document.body.querySelector("textarea")!;
    box.value = "   ";
    box.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(add.disabled).toBe(true);
    box.value = "  Tire low  ";
    box.dispatchEvent(new Event("input"));
    await flushPromises();
    add.click();
    await flushPromises();
    const post = calls().find((c) => c.init?.method === "POST" && c.path === "/api/notes");
    expect(post?.init?.body).toEqual({ kind: "vehicle", subjectId: VEH, body: "Tire low" });
    expect(box.value).toBe("");
  });

  it("pins a note and unpins the pinned one", async () => {
    await render(`/vehicles?notes=vehicle:${VEH}`);
    (document.body.querySelector(`#note-${N2} [data-note-pin]`) as HTMLButtonElement).click();
    await flushPromises();
    (document.body.querySelector(`#note-${N1} [data-note-pin]`) as HTMLButtonElement).click();
    await flushPromises();
    const pins = calls().filter((c) => c.path.endsWith("/pin"));
    expect(pins.map((c) => [c.path, c.init?.body])).toEqual([
      [`/api/notes/${N2}/pin`, { pinned: true }],
      [`/api/notes/${N1}/pin`, { pinned: false }],
    ]);
  });

  it("widens to every unit with All units, and each hit then names its unit", async () => {
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(document.body.querySelector("[data-note-unit]")).toBeNull();
    listAnswer = () => ok({ notes: [note(N3, { kind: "trailer", subjectId: TRL, subjectLabel: "53-007" })], fuzzy: false, next: null });
    (document.body.querySelector("[role='switch']") as HTMLButtonElement).click();
    await flushPromises();
    expect(listCalls().at(-1)!.path).toBe("/api/notes");
    expect(document.body.querySelector("[data-note-unit]")?.textContent).toBe("Trailer 53-007");
  });

  it("says when the words found nothing and these are close matches", async () => {
    listAnswer = () => ok({ notes: [note(N2, { fuzzy: true })], fuzzy: true, next: null });
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(document.body.querySelector("[data-notes-fuzzy]")?.textContent).toBe("No exact match. Close matches:");
  });

  it("says a failed read failed — never 'no notes' — and retries it in place", async () => {
    listAnswer = () => fail;
    await render(`/vehicles?notes=vehicle:${VEH}`);
    expect(document.body.textContent).toContain("Could not load the notes.");
    expect(document.body.querySelector("[data-notes-empty]")).toBeNull();
    const before = listCalls().length;
    listAnswer = () => ok({ notes: [], fuzzy: false, next: null });
    button("Retry")?.click();
    await flushPromises();
    expect(listCalls().length).toBe(before + 1);
    expect(document.body.querySelector("[data-notes-empty]")?.textContent).toBe("No notes yet. Write the first one above.");
  });

  it("marks the note the link names", async () => {
    await render(`/vehicles?notes=vehicle:${VEH}&note=${N2}`);
    expect(document.body.querySelector(`#note-${N2}`)?.getAttribute("aria-current")).toBe("true");
    expect(document.body.querySelector(`#note-${N1}`)?.getAttribute("aria-current")).toBeNull();
  });

  it("closing takes notes and note off the URL and keeps the list's own filters", async () => {
    await render(`/vehicles?status=any&notes=vehicle:${VEH}&note=${N2}`);
    (document.body.querySelector("[aria-label='Close drawer']") as HTMLButtonElement).click();
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ status: "any" });
  });

  it("asks every 10 s only for notes after the newest it holds, and lays them on top", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await render(`/vehicles?notes=vehicle:${VEH}`);
    listAnswer = () => ok({ notes: [note(N3, { createdAt: "2026-11-11T16:00:00+00:00", body: "Back from the shop" })], fuzzy: false, next: null });
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(listCalls().at(-1)!.path).toBe(`/api/notes?subjects=vehicle%3A${VEH}&after=2026-11-11T15%3A00%3A00%2B00%3A00%7E${N2}`);
    expect(rows().map((r) => r.id)).toEqual([`note-${N1}`, `note-${N3}`, `note-${N2}`]);
  });

  it("does not poll close matches — 'newer than a close match' is nobody's question", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    listAnswer = () => ok({ notes: [note(N2, { fuzzy: true })], fuzzy: true, next: null });
    await render(`/vehicles?notes=vehicle:${VEH}`);
    const before = listCalls().length;
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(listCalls().length).toBe(before);
  });
});
