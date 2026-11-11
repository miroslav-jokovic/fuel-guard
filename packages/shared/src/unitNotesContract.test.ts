import { describe, expect, it } from "vitest";
import { chatMentionIds, chatMentionToken } from "./chatContract.js";
import {
  UNIT_NOTE_MAX_LENGTH,
  UNIT_NOTE_MAX_SUBJECTS,
  formatNotesParam,
  formatUnitNoteCursor,
  formatUnitNoteSubjects,
  orderUnitNotes,
  parseNotesParam,
  parseUnitNoteCursor,
  parseUnitNoteSubjects,
  unitNoteCreateSchema,
  unitNoteListQuerySchema,
  unitNoteSummaryQuerySchema,
} from "./unitNotesContract.js";

/**
 * UN0's frozen contract (`docs/plans/notes/UNIT-NOTES-PLAN.md` §4.2). The database's own reading of
 * the same rules (length CHECK, one pin, append-only guard) is UN1's matrix, not this file.
 */
const TRUCK = "aaaaaaaa-1111-4111-8111-11111111abcd";
const DRIVER = "bbbbbbbb-2222-4222-8222-22222222beef";
const TRAILER = "00000000-0000-0000-0000-0000000000a1"; // staging's shape: version nibble 0 (recordId.ts)

describe("unit note subjects in a URL or a query", () => {
  it("reads kind:id pairs, lower-cases ids, and drops anything malformed, unknown or repeated", () => {
    const raw = `vehicle:${TRUCK.toUpperCase()}, driver:${DRIVER},applicant:${DRIVER},trailer:nope,driver:${DRIVER},trailer:${TRAILER}:x,trailer:${TRAILER}`;
    expect(parseUnitNoteSubjects(raw)).toEqual([
      { kind: "vehicle", id: TRUCK },
      { kind: "driver", id: DRIVER },
      { kind: "trailer", id: TRAILER },
    ]);
  });

  it("keeps the same id under two kinds — a kind is part of the subject", () => {
    expect(parseUnitNoteSubjects(`vehicle:${TRUCK},trailer:${TRUCK}`)).toHaveLength(2);
  });

  it("stops at the most one drawer may hold", () => {
    const many = Array.from({ length: UNIT_NOTE_MAX_SUBJECTS + 3 }, (_, i) => `driver:${TRUCK.slice(0, -2)}${String(i).padStart(2, "0")}`);
    expect(parseUnitNoteSubjects(many.join(","))).toHaveLength(UNIT_NOTE_MAX_SUBJECTS);
  });

  it("reads nothing from nothing", () => {
    expect(parseUnitNoteSubjects(undefined)).toEqual([]);
    expect(parseUnitNoteSubjects("")).toEqual([]);
    expect(parseNotesParam("garbage", DRIVER)).toBeNull();
  });

  it("round-trips the drawer's state through the two query values", () => {
    const state = { subjects: [{ kind: "vehicle" as const, id: TRUCK }, { kind: "trailer" as const, id: TRAILER }], noteId: DRIVER };
    const q = formatNotesParam(state);
    expect(q).toEqual({ notes: `vehicle:${TRUCK},trailer:${TRAILER}`, note: DRIVER });
    expect(parseNotesParam(q.notes, q.note)).toEqual(state);
  });

  it("opens the drawer on its units even when the named note is not an id", () => {
    expect(parseNotesParam(`driver:${DRIVER}`, "abc")).toEqual({ subjects: [{ kind: "driver", id: DRIVER }], noteId: null });
    expect(formatNotesParam({ subjects: [{ kind: "driver", id: DRIVER }], noteId: null }).note).toBeUndefined();
    expect(formatUnitNoteSubjects([{ kind: "driver", id: DRIVER.toUpperCase() }])).toBe(`driver:${DRIVER}`);
  });
});

describe("writing a note", () => {
  it("trims the body before measuring it, as the table's CHECK does", () => {
    const ok = unitNoteCreateSchema.parse({ kind: "trailer", subjectId: TRAILER, body: "  door seal torn  " });
    expect(ok.body).toBe("door seal torn");
    expect(unitNoteCreateSchema.safeParse({ kind: "trailer", subjectId: TRAILER, body: "    " }).success).toBe(false);
  });

  it("allows exactly the table's length and not one character more", () => {
    const at = "x".repeat(UNIT_NOTE_MAX_LENGTH);
    expect(unitNoteCreateSchema.safeParse({ kind: "vehicle", subjectId: TRUCK, body: at }).success).toBe(true);
    expect(unitNoteCreateSchema.safeParse({ kind: "vehicle", subjectId: TRUCK, body: `${at}x` }).success).toBe(false);
  });

  it("refuses a kind that is not a unit and a subject that is not an id", () => {
    expect(unitNoteCreateSchema.safeParse({ kind: "applicant", subjectId: DRIVER, body: "x" }).success).toBe(false);
    expect(unitNoteCreateSchema.safeParse({ kind: "driver", subjectId: "D-1042", body: "x" }).success).toBe(false);
  });

  it("carries mentions as chat's token, read by chat's one parser (D-UN8)", () => {
    const body = `${chatMentionToken(DRIVER)} call before loading`;
    const note = unitNoteCreateSchema.parse({ kind: "vehicle", subjectId: TRUCK, body });
    expect(chatMentionIds(note.body)).toEqual([DRIVER]);
  });
});

describe("the list query", () => {
  const AT = "2026-11-11T20:05:03.123456+00:00";

  it("round-trips a keyset position, including Postgres's microseconds and offset", () => {
    const raw = formatUnitNoteCursor({ at: AT, id: TRUCK.toUpperCase() });
    expect(parseUnitNoteCursor(raw)).toEqual({ at: AT, id: TRUCK });
    expect(parseUnitNoteCursor(`${AT}~${TRUCK.toUpperCase()}`)).toEqual({ at: AT, id: TRUCK });
    expect(parseUnitNoteCursor(`${AT}~nope`)).toBeNull();
    expect(parseUnitNoteCursor(`yesterday~${TRUCK}`)).toBeNull();
    expect(parseUnitNoteCursor(`${AT}~${TRUCK}~x`)).toBeNull();
  });

  it("with nothing given is the wall: every note, newest first", () => {
    const q = unitNoteListQuerySchema.parse({});
    expect(q.subjects).toEqual([]);
    expect(q.q).toBeUndefined();
    expect(q.before).toBeUndefined();
  });

  it("parses units, words, author, days and a page position", () => {
    const q = unitNoteListQuerySchema.parse({
      subjects: `vehicle:${TRUCK}`,
      q: "  reefer  ",
      author: DRIVER,
      from: "2026-11-01",
      to: "2026-11-11",
      before: formatUnitNoteCursor({ at: AT, id: TRUCK }),
    });
    expect(q).toMatchObject({ subjects: [{ kind: "vehicle", id: TRUCK }], q: "reefer", author: DRIVER, from: "2026-11-01", to: "2026-11-11", before: { at: AT, id: TRUCK } });
    expect(unitNoteListQuerySchema.parse({ q: "   " }).q).toBeUndefined();
  });

  it("refuses older and newer at once, a day that is not a day, days out of order, and a forged position", () => {
    const c = formatUnitNoteCursor({ at: AT, id: TRUCK });
    expect(unitNoteListQuerySchema.safeParse({ before: c, after: c }).success).toBe(false);
    expect(unitNoteListQuerySchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
    expect(unitNoteListQuerySchema.safeParse({ from: "11/01/2026" }).success).toBe(false);
    expect(unitNoteListQuerySchema.safeParse({ from: "2026-11-11", to: "2026-11-01" }).success).toBe(false);
    expect(unitNoteListQuerySchema.safeParse({ after: "2026-11-11" }).success).toBe(false);
  });

  it("summary names one or more kinds, each once", () => {
    expect(unitNoteSummaryQuerySchema.parse({ kinds: "vehicle,driver,vehicle" }).kinds).toEqual(["vehicle", "driver"]);
    expect(unitNoteSummaryQuerySchema.safeParse({ kinds: "vehicle,applicant" }).success).toBe(false);
    expect(unitNoteSummaryQuerySchema.safeParse({ kinds: "" }).success).toBe(false);
  });
});

describe("the order notes are shown in", () => {
  it("is the pin, then newest by the instant, then id — whatever the timestamps' spelling", () => {
    const notes = [
      { id: "1", pinned: false, createdAt: "2026-11-11T19:59:59.999Z" },
      { id: "2", pinned: false, createdAt: "2026-11-11T19:00:00+00:00" },
      { id: "3", pinned: true, createdAt: "2026-11-01T08:00:00+00:00" },
      // 15:30 in Chicago is 21:30 UTC — newest, though as text it would sort below 20:00.
      { id: "4", pinned: false, createdAt: "2026-11-11T15:30:00-06:00" },
      { id: "5", pinned: false, createdAt: "2026-11-11T20:00:00.000001+00:00" },
      { id: "6", pinned: false, createdAt: "2026-11-11T20:00:00.000001+00:00" },
      // One microsecond later than 5 and 6: the same millisecond, so only Postgres's text tells them apart.
      { id: "7", pinned: false, createdAt: "2026-11-11T20:00:00.000002+00:00" },
    ];
    expect(orderUnitNotes(notes).map((n) => n.id)).toEqual(["3", "4", "7", "6", "5", "1", "2"]);
  });
});
