import { computed } from "vue";

/**
 * For a page's own tests, which are about something other than notes: the notes pieces answer "this
 * viewer has no `notes` surface", so the page renders exactly as it did before UN5 and its tests need
 * no query client for a feature they are not testing. Notes' behaviour on the pages is pinned in
 * `components/notes/notesOnPages.test.ts`, not by every page test restating it.
 *
 *   vi.mock("@/components/notes/useUnitNotes", async () => (await import("@/components/notes/notesTesting")).notesOff());
 *   vi.mock("@/components/notes/NotesDrawer.vue", async () => (await import("@/components/notes/notesTesting")).notesStub());
 */
export function notesOff() {
  return {
    useNotesAccess: () => computed(() => false),
    useUnitNoteSummary: () => ({ on: computed(() => false), summary: computed(() => ({})) }),
  };
}

export function notesStub() {
  return { default: { name: "NotesStub", render: () => null } };
}
