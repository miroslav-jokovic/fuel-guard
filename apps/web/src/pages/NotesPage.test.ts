import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { UnitNoteSearchHit } from "@silvicom/shared";

/**
 * The Notes page — the wall (UNIT-NOTES-PLAN D-UN13). What the office relies on:
 *  · every note of the carrier, newest first, each naming its unit — no `subjects`, so it is the wall;
 *  · the drawer's search and filters (unit kind, author, days) are in the URL, so a link is the view;
 *  · a row's unit opens that unit's drawer on that note, in place;
 *  · nobody without the `notes` surface — the driver role, since UN9 switched it on for every office
 *    role (D-UN4, D-UN14) — is asked anything;
 *  · a failed read says so and is never "no notes".
 * The route and the sidebar entry are pinned at the bottom.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const who = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("admin"), { isAuthenticated: true, orgId: null });
  return { useSessionStore: () => Object.assign(s, { role: who.role }) };
});
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => new Set<string>()) }) };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header><slot /></header>" } }));

const NotesPage = (await import("./NotesPage.vue")).default;

const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const ANA = "44444444-4444-4444-8444-444444444444";
const hit = (id: string, o: Partial<UnitNoteSearchHit>): UnitNoteSearchHit => ({
  id, kind: "vehicle", subjectId: VEH, subjectLabel: "1042", body: "Tire low", authorId: ANA, authorName: "Ana Dispatch",
  pinned: false, createdAt: "2026-11-11T15:00:00+00:00", mentions: [], fuzzy: false, editedAt: null, units: [], ...o,
});
const ok = <T>(data: T) => ({ ok: true, status: 200, data });
let wall: () => unknown;

let router: Router;
let replaces: ReturnType<typeof vi.spyOn>;
const mounted: VueWrapper[] = [];
async function render(at = "/notes") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/notes", component: { template: "<div/>" } }] });
  await router.push(at);
  await router.isReady();
  replaces = vi.spyOn(router, "replace");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({ setup: () => () => h(NotesPage) });
  const w = mount(Host, { attachTo: document.body, global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]] } });
  mounted.push(w);
  await flushPromises();
  return w;
}
const wallCalls = () => apiFetch.mock.calls.map((c) => String(c[0])).filter((p) => p === "/api/notes" || p.startsWith("/api/notes?"));
const rows = () => [...document.body.querySelectorAll("[data-notes-wall] [data-note]")];

beforeEach(() => {
  who.role = "admin";
  wall = () => ok({
    notes: [
      hit(N2, { kind: "trailer", subjectId: TRL, subjectLabel: "53-007", body: "Reefer alarm at 2 AM", createdAt: "2026-11-11T16:00:00+00:00" }),
      hit(N1, { pinned: true, body: "Owner-op, call first", createdAt: "2026-11-10T15:00:00+00:00" }),
    ],
    fuzzy: false,
    next: null,
  });
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/api/notes/people") return ok({ people: [{ id: ANA, name: "Ana Dispatch" }] });
    if (path === "/api/notes" || path.startsWith("/api/notes?")) return wall();
    return ok({ notes: [], fuzzy: false, next: null });
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  toast.error.mockReset();
  document.body.innerHTML = "";
});

describe("the Notes page", () => {
  it("is the wall: every note of the carrier, newest first, each naming its unit — a pin does not jump the queue", async () => {
    await render();
    expect(wallCalls()[0]).toBe("/api/notes");
    expect(rows().map((r) => r.id)).toEqual([`note-${N2}`, `note-${N1}`]);
    expect([...document.body.querySelectorAll("[data-notes-wall] [data-note-unit]")].map((b) => b.textContent)).toEqual(["Trailer 53-007", "Truck 1042"]);
    expect(document.body.querySelector("[data-note-composer]")).toBeNull();
  });

  it("reads its search and filters from the URL, so a link is the view", async () => {
    await render(`/notes?q=reefer&kind=trailer&author=${ANA}&from=2026-11-01&to=2026-11-11`);
    expect(wallCalls()[0]).toBe(`/api/notes?q=reefer&kind=trailer&author=${ANA}&from=2026-11-01&to=2026-11-11`);
  });

  it("ignores a unit kind it does not know rather than asking the API for it", async () => {
    await render("/notes?kind=forklift");
    expect(wallCalls()[0]).toBe("/api/notes");
  });

  it("says the filters found nothing, apart from the carrier having no notes", async () => {
    wall = () => ok({ notes: [], fuzzy: false, next: null });
    await render("/notes?kind=driver");
    expect(document.body.querySelector("[data-notes-empty]")?.textContent).toBe("No notes match these filters.");
  });

  it("opens the unit's drawer on that note, in place", async () => {
    await render();
    (document.body.querySelector(`#note-${N2} [data-note-unit]`) as HTMLButtonElement).click();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/notes");
    expect(router.currentRoute.value.query).toMatchObject({ notes: `trailer:${TRL}`, note: N2 });
    expect(document.body.querySelector("[data-notes-drawer]")).not.toBeNull();
    expect(document.body.textContent).toContain("Notes · Trailer 53-007");
  });

  it("says a failed read failed — never 'no notes'", async () => {
    wall = () => ({ ok: false, status: 500, error: { code: "error", message: "boom" } });
    await render();
    expect(document.body.textContent).toContain("Could not load the notes.");
    expect(document.body.querySelector("[data-notes-empty]")).toBeNull();
  });

  it("asks nothing for somebody without the notes surface (the driver role, D-UN4)", async () => {
    who.role = "driver";
    await render();
    expect(apiFetch.mock.calls.filter((c) => String(c[0]).startsWith("/api/notes"))).toEqual([]);
  });
});

/**
 * B3, ruled (a) 2026-11-12: a mention's bell lands on `/notes?note=<id>` (`notificationRoute`), because
 * the notification row names the note and not its unit. The page asks `GET /api/notes/:id` and REPLACES
 * the URL with the drawer's full address, so the drawer opens on that unit, marking that note.
 */
describe("a link that names only a note", () => {
  const noteCalls = () => apiFetch.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith("/api/notes/") && p !== "/api/notes/people");
  const answer = (res: unknown) => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path: string) => (path === `/api/notes/${N2}` ? res : base(path)));
  };

  it("opens the note's unit's drawer on that note, replacing the address rather than adding to history", async () => {
    answer(ok({ note: hit(N2, { kind: "trailer", subjectId: TRL, subjectLabel: "53-007" }) }));
    await render(`/notes?note=${N2}`);
    expect(noteCalls()).toEqual([`/api/notes/${N2}`]);
    expect(router.currentRoute.value.query).toEqual({ notes: `trailer:${TRL}`, note: N2 });
    expect(replaces).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[data-notes-drawer]")).not.toBeNull();
    expect(document.body.textContent).toContain("Notes · Trailer 53-007");
  });

  it("closes quietly on a note the API will not give — another carrier's, or gone (404)", async () => {
    answer({ ok: false, status: 404, error: { code: "not_found", message: "Note not found" } });
    await render(`/notes?note=${N2}`);
    expect(router.currentRoute.value.query).toEqual({});
    expect(document.body.querySelector("[data-notes-drawer]")).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it("closes and says so when the read itself failed, where trying again can help", async () => {
    answer({ ok: false, status: 500, error: { code: "db_error", message: "Could not load the note" } });
    await render(`/notes?note=${N2}`);
    expect(router.currentRoute.value.query).toEqual({});
    expect(toast.error).toHaveBeenCalledWith("Could not open the note", "Could not load the note");
  });

  it("asks nothing for a note id that is not one, and drops it", async () => {
    await render("/notes?note=not-a-note");
    expect(noteCalls()).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("leaves a link that already names the unit alone", async () => {
    await render(`/notes?notes=trailer:${TRL}&note=${N2}`);
    expect(noteCalls()).toEqual([]);
    expect(replaces).not.toHaveBeenCalled();
  });

  it("does not drag back a reader who moved on while the answer was in flight", async () => {
    let release!: (v: unknown) => void;
    answer(new Promise((r) => (release = r)));
    await render(`/notes?note=${N2}`);
    await router.push("/notes?q=reefer");
    release(ok({ note: hit(N2, { kind: "trailer", subjectId: TRL, subjectLabel: "53-007" }) }));
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ q: "reefer" });
  });

  it("asks nothing for somebody without the notes surface (the driver role, D-UN4)", async () => {
    who.role = "driver";
    await render(`/notes?note=${N2}`);
    expect(noteCalls()).toEqual([]);
  });
});
