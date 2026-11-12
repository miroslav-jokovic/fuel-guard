import { describe, expect, it } from "vitest";
import { NOTES_COLUMN, withNotesColumn } from "./notesColumn";
import { noteAge, noteCount } from "./noteWords";

/**
 * The Notes column (UNIT-NOTES-PLAN D-UN12, D-UN14): placed after the File column, shown by default, and
 * absent — not merely empty — for a viewer without the `notes` surface; and the words its cell uses.
 */
const cols = [{ key: "unit_number", label: "Unit" }, { key: "file", label: "File" }, { key: "status", label: "Status" }];

describe("withNotesColumn", () => {
  it("puts Notes right after the column it is told to follow", () => {
    expect(withNotesColumn(cols, true, "file").map((c) => c.key)).toEqual(["unit_number", "file", "notes", "status"]);
  });

  it("leaves Notes out for a viewer without the notes surface, even when the catalogue lists it", () => {
    expect(withNotesColumn([...cols, NOTES_COLUMN], false, "file").map((c) => c.key)).toEqual(["unit_number", "file", "status"]);
  });

  it("never shows Notes twice when the catalogue already carries it", () => {
    const keys = withNotesColumn([cols[0]!, cols[1]!, NOTES_COLUMN, cols[2]!], true, "file").map((c) => c.key);
    expect(keys.filter((k) => k === "notes")).toHaveLength(1);
  });

  it("puts Notes last when the table has no such column", () => {
    expect(withNotesColumn(cols, true, "nope").map((c) => c.key).at(-1)).toBe("notes");
  });

  it("is not sortable — a count of notes is not an order", () => {
    expect(NOTES_COLUMN.sortable).toBeFalsy();
  });
});

describe("the cell's words", () => {
  const now = new Date("2026-11-11T18:00:00Z");
  it("says today, then days, then the day itself past a week (MM/DD/YYYY)", () => {
    expect(noteAge("2026-11-11T09:00:00Z", now)).toBe("today");
    expect(noteAge("2026-11-09T17:00:00Z", now)).toBe("2 d ago");
    expect(noteAge("2026-11-05T19:00:00Z", now)).toBe("5 d ago");
    expect(noteAge("2026-10-01T15:00:00Z", now)).toBe("10/01/2026");
  });

  it("never says a negative age for a note stamped a moment ahead of this clock", () => {
    expect(noteAge("2026-11-11T18:00:05Z", now)).toBe("today");
  });

  it("counts one note and many notes in words", () => {
    expect(noteCount(1)).toBe("1 note");
    expect(noteCount(3)).toBe("3 notes");
  });
});
