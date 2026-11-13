import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { UnitNoteSearchHit } from "@silvicom/shared";

/**
 * Mentions in a unit's notes (UNIT-NOTES-PLAN D-UN8, step UN7), in the drawer as an office user meets
 * them. What a writer relies on: `@` and a few letters offers the office by name, never themselves;
 * Enter picks rather than sends; the note is SAVED with the person's `<@id>` token (the API rings the
 * bell from it, UN3) while the field reads their name; Esc closes the list, not the drawer. What a
 * reader relies on: a token reads as the person's name, their own as the stronger chip, someone gone
 * as "@someone", never an id.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const ME = vi.hoisted(() => "99999999-9999-4999-8999-999999999999");
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("admin"), { isAuthenticated: true, orgId: null, userId: ME });
  return { useSessionStore: () => s };
});
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => new Set<string>()) }) };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import NotesDrawer from "./NotesDrawer.vue";

const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const N1 = "11111111-1111-4111-8111-111111111111";
const N3 = "33333333-3333-4333-8333-333333333333";
const ANA = "44444444-4444-4444-8444-444444444444";
const ARTURO = "55555555-5555-4555-8555-555555555555";
const GONE = "66666666-6666-4666-8666-666666666666";
const people = [
  { id: ANA, name: "Ana Dispatch" },
  { id: ARTURO, name: "Arturo Billing" },
  { id: ME, name: "Mia Safety" },
];
const note = (id: string, o: Partial<UnitNoteSearchHit> = {}): UnitNoteSearchHit => ({
  id, kind: "vehicle", subjectId: VEH, subjectLabel: "1042", body: "Tire low", authorId: ANA, authorName: "Ana Dispatch",
  pinned: false, createdAt: "2026-11-10T15:00:00+00:00", mentions: [], fuzzy: false, editedAt: null, units: [], ...o,
});
const ok = <T>(data: T) => ({ ok: true, status: 200, data });

let listNotes: UnitNoteSearchHit[];
let router: Router;
const mounted: VueWrapper[] = [];
async function render() {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles", component: { template: "<div/>" } }] });
  await router.push(`/vehicles?notes=vehicle:${VEH}`);
  await router.isReady();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({ setup: () => () => h(NotesDrawer) });
  mounted.push(mount(Host, { attachTo: document.body, global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]] } }));
  await flushPromises();
}
const field = () => document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="Write a note"]')!;
/** One input event, as a browser sends one per key: value and caret first, then the event. */
async function type(text: string) {
  const el = field();
  el.value = text;
  el.setSelectionRange(text.length, text.length);
  el.dispatchEvent(new Event("input"));
  await flushPromises();
}
async function key(k: string, init: KeyboardEventInit = {}) {
  field().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  await flushPromises();
}
const options = () => [...document.body.querySelectorAll('[role="option"]')].map((o) => o.querySelector("span.truncate")?.textContent?.trim());
const posted = () => apiFetch.mock.calls.filter((c) => c[0] === "/api/notes" && (c[1] as { method?: string })?.method === "POST").map((c) => (c[1] as { body: { body: string } }).body.body);

beforeEach(() => {
  listNotes = [note(N1)];
  apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/notes/people") return ok({ people });
    if (path === "/api/notes" && init?.method === "POST") return ok({ note: note(N3) });
    if (path.startsWith("/api/notes")) return ok({ notes: listNotes, fuzzy: false, next: null });
    return ok({});
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  document.body.innerHTML = "";
});

describe("the note composer's @ list", () => {
  it("offers the office by any word of the name, and never the writer", async () => {
    await render();
    await type("call @");
    expect(options()).toEqual(["Ana Dispatch", "Arturo Billing"]);
    await type("call @bi");
    expect(options()).toEqual(["Arturo Billing"]);
    await type("call @mi");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it("Enter picks rather than sends; the field reads the name and the note is saved with the token", async () => {
    await render();
    await type("call @an");
    await key("Enter");
    expect(field().value).toBe("call @Ana Dispatch ");
    expect(posted()).toEqual([]);
    await type("call @Ana Dispatch about the tire");
    await key("Enter", { metaKey: true });
    expect(posted()).toEqual([`call <@${ANA}> about the tire`]);
  });

  it("walks the list with the arrows and Tab picks", async () => {
    await render();
    await type("@a");
    await key("ArrowDown");
    expect(document.body.querySelector('[aria-selected="true"]')?.textContent).toContain("Arturo Billing");
    await key("Tab");
    expect(field().value).toBe("@Arturo Billing ");
  });

  it("Esc closes the list and leaves the drawer open", async () => {
    await render();
    await type("@an");
    await key("Escape");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.body.querySelector("[data-notes-drawer]")).not.toBeNull();
    expect(router.currentRoute.value.query.notes).toBe(`vehicle:${VEH}`);
  });
});

describe("a mention in a note", () => {
  it("reads as the person's name, the reader's own as the stronger chip, someone gone as @someone", async () => {
    listNotes = [note(N1, { body: `<@${ANA}> and <@${ME}>, ask <@${GONE}>`, mentions: [ANA, ME, GONE] })];
    await render();
    const chips = [...document.body.querySelectorAll("[data-note-mention]")];
    expect(chips.map((c) => c.textContent)).toEqual(["@Ana Dispatch", "@Mia Safety", "@someone"]);
    expect(chips[1]!.classList).toContain("bg-brand-accent-strong");
    expect(chips[0]!.classList).not.toContain("bg-brand-accent-strong");
    expect(document.body.querySelector("[data-note-body]")?.textContent).toBe("@Ana Dispatch and @Mia Safety, ask @someone");
  });
});
