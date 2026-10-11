/**
 * The assistant's answer, read into blocks the template can render (F21 W2).
 *
 * The model answers in markdown — it writes rankings as pipe tables because its system prompt asks
 * for "compact tables". The old page printed that text with `whitespace-pre-wrap`, so a ranking
 * reached the reader as rows of pipes and dashes. This reads the small subset the assistant actually
 * writes (paragraphs, headings, bullet and numbered lists, pipe tables, `**bold**` and `` `code` ``)
 * into typed blocks.
 *
 * ⚠ Deliberately NOT a markdown library rendered through `v-html`. The answer is model output built
 * from tool results, and those results carry text other people typed — a station name off a vendor
 * report, an import filename (AUDIT A7). Rendering it as HTML would hand that text the page. Blocks
 * of plain strings, rendered as text nodes by Vue, cannot inject anything; and there are no links,
 * because an answer's links must come from structured data rather than from what the model wrote
 * (PLAN D-AI8). Anything this does not recognise stays a paragraph of its own text, never dropped.
 */

export type Inline = { kind: "text" | "strong" | "code"; text: string };

export type AnswerBlock =
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "heading"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][]; numeric: boolean[] };

/** `**bold**` and `` `code` `` — the only inline marks the assistant uses. Unclosed marks stay text. */
export function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push(m[1] != null ? { kind: "strong", text: m[1] } : { kind: "code", text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/**
 * A column is numeric when every non-empty cell reads as a figure — `$1,234`, `7.1`, `42%`, `-3` —
 * so it right-aligns with tabular figures like every other number in the product (D-DS1). A column
 * holding one name among numbers is text: left-aligning a few numbers is a smaller harm than
 * right-aligning a name.
 */
const FIGURE = /^[-+−]?\$?\s?[\d,]+(\.\d+)?\s?(%|mpg|gal|h|hrs|mi)?$/i;
function numericColumns(rows: string[][], width: number): boolean[] {
  return Array.from({ length: width }, (_, i) => {
    const vals = rows.map((r) => r[i] ?? "").filter((v) => v !== "" && v !== "—" && v !== "-");
    return vals.length > 0 && vals.every((v) => FIGURE.test(v.replace(/\*\*/g, "")));
  });
}

export function parseAnswer(source: string): AnswerBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: AnswerBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", inlines: parseInlines(para.join(" ")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) { flush(); continue; }

    // A table is a header row followed by a rule row; a lone pipe line is just text.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) body.push(cells(lines[i++]!));
      i -= 1;
      blocks.push({
        type: "table",
        head: head.map(parseInlines),
        rows: body.map((r) => head.map((_, c) => parseInlines(r[c] ?? ""))),
        numeric: numericColumns(body, head.length),
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) { flush(); blocks.push({ type: "heading", inlines: parseInlines(heading[1]!) }); continue; }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const item = parseInlines((bullet ?? numbered)![1]!);
      const prev = blocks[blocks.length - 1];
      if (prev?.type === "list" && prev.ordered === ordered) prev.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
      continue;
    }

    para.push(line.trim());
  }
  flush();
  return blocks;
}
