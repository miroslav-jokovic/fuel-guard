import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { useConfirmStore } from "@silvicom/ui";
import type { UnitNoteSearchHit } from "@silvicom/shared";

/**
 * One note's row since v3 (UNIT-NOTES-PLAN §9): Edit and Remove for the author and for a holder of
 * `notes.manage_all` only (D-UN19) — the menu is never an offer the API refuses; Remove asks first and
 * then sends DELETE (D-UN16); Edit opens the words in place with every mention kept and sends PATCH
 * (D-UN15); an edited note says "Edited"; a `<#vehicle:id>` token reads as `@848` (D-UN17).
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const who = vi.hoisted(() => ({ role: "dispatcher", userId: "", grants: {} as Record<string, boolean> }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("dispatcher"), { isAuthenticated: true, orgId: "org-1", userId: "" });
  return {
    useSessionStore: () => {
      s.role = who.role as typeof s.role;
      s.userId = who.userId;
      const base = fakeSession(who.role as typeof s.role).hasPermission;
      s.hasPermission = (k) => who.grants[k] ?? base(k);
      return s;
    },
  };
});
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => new Set<string>()) }) };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import NoteRow from "./NoteRow.vue";

const ME = "44444444-4444-4444-8444-444444444444";
const SOMEONE = "55555555-5555-4555-8555-555555555555";
const ANA = "66666666-6666-4666-8666-666666666666";
const T848 = "77777777-7777-4777-8777-777777777777";
const NOTE = "11111111-1111-4111-8111-111111111111";
const note = (o: Partial<UnitNoteSearchHit> = {}): UnitNoteSearchHit => ({
  id: NOTE, kind: "driver", subjectId: "d-1", subjectLabel: "Marcus Hill", body: "Tire low", authorId: ME, authorName: "Dana Dispatch",
  pinned: false, createdAt: "2026-11-10T15:00:00+00:00", mentions: [], fuzzy: false, editedAt: null, units: [], ...o,
});
const ok = <T>(data: T) => ({ ok: true, status: 200, data });

const mounted: VueWrapper[] = [];
function render(n: UnitNoteSearchHit) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mount(NoteRow, { props: { note: n, nameOf: (id: string) => (id === ANA ? "Ana Ruiz" : null) }, attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } });
  mounted.push(w);
  return w;
}
const menu = () => document.body.querySelector("[data-note-actions] button[aria-haspopup='menu']") as HTMLButtonElement | null;
const item = (sel: string) => document.body.querySelector(sel) as HTMLButtonElement | null;
const calls = () => apiFetch.mock.calls.map((c) => ({ path: String(c[0]), init: c[1] as { method?: string; body?: unknown } | undefined }));

beforeEach(() => {
  setActivePinia(createPinia());
  who.role = "dispatcher";
  who.userId = ME;
  who.grants = {};
  apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/notes/people") return ok({ people: [{ id: ANA, name: "Ana Ruiz" }, { id: ME, name: "Dana Dispatch" }] });
    if (init?.method === "DELETE") return ok({ removed: true });
    if (init?.method === "PATCH") return ok({ note: note({ body: "changed" }) });
    return ok({});
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  document.body.innerHTML = "";
});

describe("NoteRow — who may change a note (D-UN19)", () => {
  it("offers Edit and Remove on the author's own note", async () => {
    render(note());
    menu()!.click();
    await flushPromises();
    expect(item("[data-note-edit]")).not.toBeNull();
    expect(item("[data-note-remove]")).not.toBeNull();
  });

  it("offers nothing on somebody else's note without the permission", () => {
    render(note({ authorId: SOMEONE, authorName: "Sam" }));
    expect(menu()).toBeNull();
  });

  it("offers both on anybody's note to a role the admin switched notes.manage_all on for", () => {
    who.grants = { "notes.manage_all": true };
    render(note({ authorId: SOMEONE }));
    expect(menu()).not.toBeNull();
  });

  it("offers both to the admin on anybody's note — the admin holds every permission", () => {
    who.role = "admin";
    render(note({ authorId: SOMEONE }));
    expect(menu()).not.toBeNull();
  });

  it("offers nothing on a note whose author's login is gone, to anybody without the permission", () => {
    who.userId = "";
    render(note({ authorId: null }));
    expect(menu()).toBeNull();
  });
});

describe("NoteRow — removing (D-UN16)", () => {
  it("asks first, and a no sends nothing", async () => {
    render(note());
    menu()!.click();
    await flushPromises();
    item("[data-note-remove]")!.click();
    await flushPromises();
    const confirm = useConfirmStore();
    expect(confirm.pending?.title).toBe("Remove this note?");
    confirm.answer(false);
    await flushPromises();
    expect(calls().filter((c) => c.init?.method === "DELETE")).toEqual([]);
  });

  it("sends DELETE for the note on a yes, and says whose note it is when it is not yours", async () => {
    who.role = "admin";
    render(note({ authorId: SOMEONE, authorName: "Sam Safety" }));
    menu()!.click();
    await flushPromises();
    item("[data-note-remove]")!.click();
    await flushPromises();
    const confirm = useConfirmStore();
    expect(confirm.pending?.message).toContain("Sam Safety's note");
    confirm.answer(true);
    await flushPromises();
    expect(calls().find((c) => c.init?.method === "DELETE")?.path).toBe(`/api/notes/${NOTE}`);
  });
});

describe("NoteRow — editing (D-UN15)", () => {
  it("opens the words in place with every mention kept, and saves through PATCH", async () => {
    const w = render(note({ body: `Ask <@${ANA}> about <#vehicle:${T848}>`, mentions: [ANA], units: [{ kind: "vehicle", id: T848, label: "848" }] }));
    menu()!.click();
    await flushPromises();
    item("[data-note-edit]")!.click();
    await flushPromises();
    const box = w.find("[data-note-editor] textarea");
    expect((box.element as HTMLTextAreaElement).value).toBe("Ask @Ana Ruiz about @848");
    await box.setValue("Ask @Ana Ruiz about @848 today");
    await w.find("[data-note-editor]").trigger("submit");
    await flushPromises();
    const sent = calls().find((c) => c.init?.method === "PATCH");
    expect(sent?.path).toBe(`/api/notes/${NOTE}`);
    expect(sent?.init?.body).toEqual({ body: `Ask <@${ANA}> about <#vehicle:${T848}> today` });
  });

  it("Cancel closes the editor and sends nothing", async () => {
    const w = render(note());
    menu()!.click();
    await flushPromises();
    item("[data-note-edit]")!.click();
    await flushPromises();
    await w.find("[data-note-edit-cancel]").trigger("click");
    expect(w.find("[data-note-editor]").exists()).toBe(false);
    expect(calls().filter((c) => c.init?.method === "PATCH")).toEqual([]);
  });
});

describe("NoteRow — what it shows", () => {
  it("says Edited on an edited note, with the time on hover", () => {
    const w = render(note({ editedAt: "2026-11-12T16:30:00+00:00" }));
    const edited = w.find("[data-note-edited]");
    expect(edited.text()).toBe("Edited");
    expect(edited.attributes("title")).toMatch(/^Edited 11\/12\/2026/);
  });

  it("reads a unit token as the unit's number, and a unit the carrier no longer has as its kind", () => {
    const GONE = "88888888-8888-4888-8888-888888888888";
    const w = render(note({ body: `Swap to <#vehicle:${T848}> from <#driver:${GONE}>`, units: [{ kind: "vehicle", id: T848, label: "848" }, { kind: "driver", id: GONE, label: null }] }));
    expect(w.findAll("[data-note-unit-mention]").map((c) => c.text())).toEqual(["@848", "@a driver"]);
    expect(w.find("[data-note-body]").text()).toBe("Swap to @848 from @a driver");
  });
});
