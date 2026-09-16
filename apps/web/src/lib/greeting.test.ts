import { describe, it, expect } from "vitest";
import { dayPart, greeting } from "@/lib/greeting";

/** Local time on purpose — the greeting addresses the reader's clock, not the server's (D-DR14). */
const at = (hour: number) => new Date(2026, 8, 16, hour, 30, 0);

describe("dayPart", () => {
  it("puts each boundary hour on the side the copy expects", () => {
    // The boundaries are the whole risk: an off-by-one here greets somebody with the wrong half-day.
    expect(dayPart(at(5))).toBe("morning");
    expect(dayPart(at(11))).toBe("morning");
    expect(dayPart(at(12))).toBe("afternoon");
    expect(dayPart(at(17))).toBe("afternoon");
    expect(dayPart(at(18))).toBe("evening");
    expect(dayPart(at(23))).toBe("evening");
  });

  /** Dispatch runs overnight; 02:00 is finishing a day, not starting one, so there is no fourth part. */
  it("counts the small hours as evening rather than inventing a fourth part", () => {
    expect(dayPart(at(0))).toBe("evening");
    expect(dayPart(at(4))).toBe("evening");
  });
});

describe("greeting", () => {
  it("addresses the reader by first name only", () => {
    expect(greeting(at(9), "Miroslav Jokovic")).toBe("Good morning, Miroslav");
  });

  /**
   * `session.fullName` is null before `/api/me` returns and for a member who never got one. The
   * comma belongs to the name branch, so its absence reads as a greeting rather than as a bug.
   */
  it("drops the comma entirely when there is no name, rather than trailing one", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(greeting(at(14), empty)).toBe("Good afternoon");
    }
  });

  it("survives a name stored with stray whitespace", () => {
    expect(greeting(at(20), "  Miki  Tanaka ")).toBe("Good evening, Miki");
  });
});
