import type { ReferenceParagraph } from "./referenceText.js";

/**
 * Find the paragraph a citation's designators name — "(d)(1)(ii)" — in a section's paragraphs as
 * `extractSectionText` returns them: flat, in printed order, each with its own designator only. The nesting is
 * the CFR's: (a) lowercase letter, (1) number, (i) lowercase roman, (A) capital. A roman numeral is read as a
 * letter when it follows a letter-level paragraph ("(h)" then "(i)"), as a numeral when it follows a number or
 * another numeral. A paragraph printed with its first child in the same <P> — "(c)(1) …", or with a heading,
 * "(c) Exceptions. (1) …" — answers both "(c)" and "(c)(1)", and the child sets the depth the next one is read at.
 *
 * Returns the paragraph's text with every child paragraph's text after it (what a reader of "(d)(1)" reads), or
 * null when the path names no paragraph of the section.
 */
const ROMAN = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv)$/;

function levelOf(d: string, previous: number): number {
  if (/^\d+$/.test(d)) return 2;
  if (/^[A-Z]+$/.test(d)) return 4;
  if (ROMAN.test(d) && previous >= 2) return 3;
  return 1;
}

/**
 * Designators printed in a paragraph after its own, before any of its text: "(c)(1)(i) Text" → ["1", "i"], and
 * after a short heading ending in a period: "(c) Exceptions. (1) Text" → ["1"].
 */
function inlineChildren(text: string): string[] {
  const m = /^\s*\([A-Za-z0-9]+\)(?:\s*[^().]{1,80}\.)?\s*((?:\([A-Za-z0-9]+\))*)/.exec(text);
  return m ? [...(m[1] ?? "").matchAll(/\(([A-Za-z0-9]+)\)/g)].map((x) => x[1]!) : [];
}

export function paragraphAt(paragraphs: readonly ReferenceParagraph[], path: readonly string[]): string | null {
  if (path.length === 0) return paragraphs.map((p) => p.text).join("\n");
  const stack: { level: number; d: string }[] = [];
  let level = 0;
  let found = -1;
  let foundDepth = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    if (p.designator === null) continue;
    const own = levelOf(p.designator, level);
    while (stack.length && stack[stack.length - 1]!.level >= own) stack.pop();
    stack.push({ level: own, d: p.designator });
    level = own;
    const own0 = stack.map((s) => s.d);
    for (const d of inlineChildren(p.text)) {
      level = levelOf(d, level);
      stack.push({ level, d });
    }
    const full = stack.map((s) => s.d);
    if (found >= 0) {
      // The cited paragraph ends at the next paragraph at its own depth or shallower.
      if (stack.length <= foundDepth) return paragraphs.slice(found, i).map((x) => x.text).join("\n");
      continue;
    }
    if (path.every((d, k) => full[k] === d) && own0.length <= path.length) {
      found = i;
      foundDepth = path.length;
    }
  }
  return found >= 0 ? paragraphs.slice(found).map((x) => x.text).join("\n") : null;
}
