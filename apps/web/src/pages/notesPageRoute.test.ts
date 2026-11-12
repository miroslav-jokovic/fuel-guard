import { describe, expect, it } from "vitest";
import { buildNavGroups } from "@/lib/nav";

/**
 * Where the Notes page is reached (UNIT-NOTES-PLAN D-UN13, D-UN14): `/notes` is the page itself — the
 * placeholder UN0 put there is gone — and the sidebar's Notes entry, in the top group beside Chat,
 * follows the `notes` surface: an admin while it ships dark, any office role a carrier switches it on
 * for, never a driver.
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
  it("is shown to an admin while the screen ships dark, and links to /notes", () => {
    expect(notesItem("admin")).toMatchObject({ name: "Notes", to: "/notes", show: true });
  });

  it("is hidden from an accountant until the carrier switches the screen on, then shown", () => {
    expect(notesItem("accountant")?.show ?? false).toBe(false);
    expect(notesItem("accountant", { notes: true })?.show).toBe(true);
  });

  it("is never shown to a driver, whatever the screen answer says", () => {
    expect(notesItem("driver", { notes: true })?.show ?? false).toBe(false);
  });
});
