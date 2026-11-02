import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Load and truck numbers in a chat line, as links (CHAT-REDESIGN-PLAN Q-CHATUI6 (a); migration 0547
 * `chat_line_links`). The server decides which words of a line name a record — a seven-digit load
 * reference or "load/order N", a number after "truck/unit/tractor" that is exactly one unit of the
 * reader's organisation — for lines the reader may read; the web only draws the words it was given.
 */

/** One request reads at most this many lines — the database's own ceiling (0547 `limit 200`). */
export const CHAT_LINE_LINKS_MAX = 200;
export const CHAT_LINE_LINK_KINDS = ["load", "vehicle"] as const;
export type ChatLineLinkKind = (typeof CHAT_LINE_LINK_KINDS)[number];

export const chatLineLinksRequestSchema = z.object({
  message_ids: z.array(recordId()).min(1).max(CHAT_LINE_LINKS_MAX),
});
export type ChatLineLinksRequest = z.infer<typeof chatLineLinksRequestSchema>;

/** The words as they stand in the line, and the record they name. */
export const chatLineLinkSchema = z.object({
  message_id: recordId(),
  text: z.string().min(1),
  kind: z.enum(CHAT_LINE_LINK_KINDS),
  record_id: recordId(),
});
export type ChatLineLink = z.infer<typeof chatLineLinkSchema>;
export const chatLineLinksResponseSchema = z.object({ links: z.array(chatLineLinkSchema) });
export type ChatLineLinksResponse = z.infer<typeof chatLineLinksResponseSchema>;

const WORDY = /[0-9A-Za-z]/;
/**
 * Where `word` stands on its own in `text` from `from` on, or -1: not inside a longer word or number, the
 * same edges 0547's patterns draw — so the server's "unit 5" is never cut out of a "unit 50" in the same line.
 */
function standingAt(text: string, word: string, from = 0): number {
  for (let at = text.indexOf(word, from); at >= 0; at = text.indexOf(word, at + 1)) {
    const before = at > 0 ? text[at - 1]! : "";
    const after = text[at + word.length] ?? "";
    if (!WORDY.test(before) && !WORDY.test(after)) return at;
  }
  return -1;
}

/**
 * A line's text cut at every occurrence of the words it links, only where they stand on their own
 * (`standingAt`), the earliest first — so "load 0137581" is taken whole before the bare "0137581" inside
 * it can be; what is left stays text. Pure, so the web draws and a test reads it.
 */
export function chatLinkParts(text: string, links: readonly Pick<ChatLineLink, "text" | "kind" | "record_id">[]):
  Array<{ text: string } | { link: string; kind: ChatLineLinkKind; record_id: string }> {
  const out: Array<{ text: string } | { link: string; kind: ChatLineLinkKind; record_id: string }> = [];
  let from = 0;
  while (from < text.length) {
    let best: { at: number; l: (typeof links)[number] } | null = null;
    for (const l of links) {
      const at = standingAt(text, l.text, from);
      if (at >= 0 && (!best || at < best.at)) best = { at, l };
    }
    if (!best) { out.push({ text: text.slice(from) }); break; }
    if (best.at > from) out.push({ text: text.slice(from, best.at) });
    out.push({ link: best.l.text, kind: best.l.kind, record_id: best.l.record_id });
    from = best.at + best.l.text.length;
  }
  return out;
}
