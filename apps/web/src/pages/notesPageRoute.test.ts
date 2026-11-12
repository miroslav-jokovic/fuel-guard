import { describe, expect, it } from "vitest";
import { OFFICE_ROLES } from "@silvicom/shared";
import { buildNavGroups } from "@/lib/nav";

/**
 * Where the Notes page is reached (UNIT-NOTES-PLAN D-UN13, D-UN14): `/notes` is the page itself — the
 * placeholder UN0 put there is gone — and the sidebar's Notes entry, in the top group beside Chat,
 * follows the `notes` surface: every office role, with no carrier answer needed (D-UN4; UN9 removed
 * the `startsOnFor: []` it was built dark behind, D-UN14), never a driver.
 */
const notesItem = (role: Parameters<typeof buildNavGroups>[0], surfaces: Record<string, boolean> | null = null) =>
  buildNavGroups(role, null, {}, null, surfaces)
    .flatMap((g) => g.items)
    .find((i) => i.key === "notes");

describe("the Notes page's route", () => {
  it("opens NotesPage.vue at /notes, not the placeholder", async () => {
    const { router } = await import("@/router");
    const match = router.resolve("/notes").matched.at(-1)!;
    const load = match.components!.default as unknown as () => Promise<{ default: unknown }>;
    expect((await load()).default).toBe((await import("./NotesPage.vue")).default);
  });
});

describe("the sidebar's Notes entry", () => {
  it("is shown to every office role with no carrier answer at all, and links to /notes", () => {
    for (const role of OFFICE_ROLES)
      expect(notesItem(role), role).toMatchObject({ name: "Notes", to: "/notes", show: true });
  });

  it("is never shown to a driver, whatever the screen answer says", () => {
    expect(notesItem("driver", { notes: true })?.show ?? false).toBe(false);
  });
});
