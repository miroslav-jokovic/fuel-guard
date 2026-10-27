import { chatBodyParts, chatMentionToken } from "@silvicom/shared";

/**
 * What a person types versus what is sent (D-CHAT22). The field shows `@Ana Ruiz`; the body carries
 * `<@id>`, because the body is the one record and a name is neither unique nor permanent. Each person
 * picked from the typeahead is remembered as a label → id pair, and on send every label still in the
 * text becomes its token. A label the writer has since edited ("@Ana Ru") no longer matches, so it is
 * sent as the words it now is — nobody is named by a fragment.
 *
 * An edit goes the other way first (`toDraft`): the line's tokens become their labels so the field reads
 * as words, and a token whose person cannot be named stays a token, so saving keeps that mention.
 * Two different people of exactly the same name in one draft are one label; the last picked wins.
 */
export type MentionPicks = ReadonlyMap<string, string>;

export const mentionLabel = (name: string) => `@${name.trim()}`;

/** A label stands for its person only where it ends: "@Ana" does not name anybody inside "@Anabel". */
function labelPattern(label: string): RegExp {
  return new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "gu");
}

export function fromDraft(text: string, picks: MentionPicks): string {
  // Longest first, so "@Ana Ruiz" is replaced before "@Ana" can take its first word.
  const labels = [...picks.keys()].sort((a, b) => b.length - a.length);
  return labels.reduce((out, label) => out.replace(labelPattern(label), chatMentionToken(picks.get(label)!)), text);
}

export function toDraft(body: string, nameOf: (id: string) => string | null): { text: string; picks: Map<string, string> } {
  const picks = new Map<string, string>();
  const text = chatBodyParts(body)
    .map((p) => {
      if ("text" in p) return p.text;
      const name = nameOf(p.mention)?.trim();
      if (!name) return chatMentionToken(p.mention);
      picks.set(mentionLabel(name), p.mention);
      return mentionLabel(name);
    })
    .join("");
  return { text, picks };
}

/**
 * The word being typed after an `@`, when the caret sits at its end: the typeahead's query, and where
 * it starts so a pick can replace it. An `@` inside a word (an email address) opens nothing.
 */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
  return m ? { query: m[2]!, start: caret - m[2]!.length - 1 } : null;
}
