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
 *  · nobody without the `notes` surface is asked anything (D-UN14);
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
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header><slot /></header>" } }));

const NotesPage = (await import("./NotesPage.vue")).default;

const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const ANA = "44444444-4444-4444-8444-444444444444";
const hit = (id: string, o: Partial<UnitNoteSearchHit>): UnitNoteSearchHit => ({
  id, kind: "vehicle", subjectId: VEH, subjectLabel: "1042", body: "Tire low", authorId: ANA, authorName: "Ana Dispatch",
  pinned: false, createdAt: "2026-11-11T15:00:00+00:00", mentions: [], fuzzy: false, ...o,
});
const ok = <T>(data: T) => ({ ok: true, status: 200, data });
let wall: () => unknown;

let router: Router;
const mounted: VueWrapper[] = [];
async function render(at = "/notes") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/notes", component: { template: "<div/>" } }] });
  await router.push(at);
  await router.isReady();
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

  it("asks nothing for somebody without the notes surface (dark, D-UN14)", async () => {
    who.role = "accountant";
    await render();
    expect(apiFetch.mock.calls.filter((c) => String(c[0]).startsWith("/api/notes"))).toEqual([]);
  });
});
