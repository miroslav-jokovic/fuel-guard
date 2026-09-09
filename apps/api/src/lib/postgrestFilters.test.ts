import { describe, expect, it } from "vitest";
import { orFilterValue } from "./postgrestFilters.js";

/**
 * `.or()` values (close-out of I0–I9).
 *
 * The separators PostgREST's filter grammar reserves are `,` `(` `)` and `.`, and a raw search term
 * containing any of them either fails the parse or builds a filter tree nobody wrote. What is
 * asserted here is that the value is QUOTED rather than stripped: a person searching for a part
 * number with a comma must get the search they asked for, not a quietly different one.
 */
describe("a value inside an or() filter", () => {
  it("wraps the value so a separator cannot be read as one", () => {
    expect(orFilterValue("%LF,9080%")).toBe('"%LF,9080%"');
    expect(orFilterValue("%filter (spin-on)%")).toBe('"%filter (spin-on)%"');
    expect(orFilterValue("%a.b%")).toBe('"%a.b%"');
  });

  it("escapes the quote and the backslash, which are the only two that can end the quoting", () => {
    expect(orFilterValue('%6" hose%')).toBe('"%6\\" hose%"');
    expect(orFilterValue("%back\\slash%")).toBe('"%back\\\\slash%"');
  });

  /**
   * ⚠ Not a character filter. Stripping the separators would change what the person asked for and
   * would be a denylist the next grammar change outdates — so the ordinary term must come back
   * intact, quoted and otherwise untouched.
   */
  it("leaves an ordinary term alone apart from the quoting", () => {
    expect(orFilterValue("%oil filter%")).toBe('"%oil filter%"');
  });
});
