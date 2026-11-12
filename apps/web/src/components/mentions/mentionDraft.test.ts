import { describe, expect, it } from "vitest";
import { fromDraft, mentionQueryAt, toDraft } from "./mentionDraft";

/**
 * What is typed versus what is sent (D-CHAT22): `@Name` in the field, `<@id>` in the body. Whoever
 * reads the body — the database's trigger, the ledger, the export — sees only tokens, so these are the
 * conversions every send and every edit go through.
 */
const ANA = "aaaaaaaa-1111-4111-8111-11111111abcd";
const ANABEL = "bbbbbbbb-2222-4222-8222-22222222beef";
const ANA_RUIZ = "cccccccc-3333-4333-8333-33333333cafe";

describe("fromDraft", () => {
  it("turns every remembered label into its token, and leaves the words around it alone", () => {
    expect(fromDraft("@Ana can you, @Ana?", new Map([["@Ana", ANA]]))).toBe(`<@${ANA}> can you, <@${ANA}>?`);
  });

  it("names nobody inside a longer word: @Ana is not in @Anabel", () => {
    expect(fromDraft("ask @Anabel", new Map([["@Ana", ANA]]))).toBe("ask @Anabel");
  });

  it("replaces the longest label first, so a full name is not cut at its first word", () => {
    const picks = new Map([["@Ana", ANA], ["@Ana Ruiz", ANA_RUIZ]]);
    expect(fromDraft("@Ana Ruiz and @Ana", picks)).toBe(`<@${ANA_RUIZ}> and <@${ANA}>`);
  });

  it("sends a label the writer has since changed as the words it now is", () => {
    expect(fromDraft("@Ana Ru said", new Map([["@Ana Ruiz", ANA_RUIZ]]))).toBe("@Ana Ru said");
  });

  it("reads a label's punctuation as itself, not as a pattern", () => {
    expect(fromDraft("@J.R. and @JxR", new Map([["@J.R.", ANA]]))).toBe(`<@${ANA}> and @JxR`);
  });
});

describe("toDraft", () => {
  it("writes each token as its label, remembers it, and keeps a token nobody can name as a token", () => {
    const names: Record<string, string> = { [ANA]: "Ana", [ANABEL]: "Anabel" };
    const d = toDraft(`<@${ANA}> and <@${ANABEL}> and <@${ANA_RUIZ}>`, (id) => names[id] ?? null);
    expect(d.text).toBe(`@Ana and @Anabel and <@${ANA_RUIZ}>`);
    expect(fromDraft(d.text, d.picks)).toBe(`<@${ANA}> and <@${ANABEL}> and <@${ANA_RUIZ}>`);
  });
});

describe("mentionQueryAt", () => {
  it("is the word after an @ that the caret ends, with where the @ is", () => {
    expect(mentionQueryAt("hi @be", 6)).toEqual({ query: "be", start: 3 });
    expect(mentionQueryAt("@", 1)).toEqual({ query: "", start: 0 });
  });

  it("opens nothing inside a word, after a space, or with the caret elsewhere", () => {
    expect(mentionQueryAt("ana@example.com", 15)).toBeNull();
    expect(mentionQueryAt("hi @ben ", 8)).toBeNull();
    expect(mentionQueryAt("hi @ben and", 11)).toBeNull();
  });
});
