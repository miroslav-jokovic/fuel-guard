import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFDocument,
} from "pdf-lib";
import { PACKET_SPELLING, type PacketSpelling } from "../../packetSpelling.js";

/**
 * The carrier's packet with its typing errors corrected, on the carrier's own pages (D-PKT20).
 *
 * ── HOW, AND WHY NOT A NEW PDF ────────────────────────────────────────────────────────────────
 * `application-11.pdf` is Microsoft Print-to-PDF output: every printed line is ONE `TJ` array of
 * two-byte glyph ids in a fully embedded CID TrueType font, positioned by its own `Tm`. So a word can
 * be corrected by re-spelling it in glyph ids inside the line that holds it, and nothing else on the
 * page moves — every rule, box and coordinate `packetMarkGeometry.ts` and `packetFieldGeometry.ts`
 * measured stays where it was measured. A re-exported PDF would have re-laid every page and voided
 * all of that geometry; an overlay patched on top would have left the misspelling in the text layer
 * underneath the correction, where an auditor's copy-and-paste finds it.
 *
 * The carrier's file stays byte-for-byte in the repository as the record of what they gave us, and
 * `PACKET_SPELLING` is the whole difference between it and what prints — one list a reviewer can
 * read, where a second binary asset would be a diff nobody could.
 *
 * ⚠ **Every entry must land exactly as often as it says, or the render throws.** A correction that
 * silently stopped matching (an earlier entry consumed its text, a phrase was re-typed) would print
 * the misspelling again with nothing to say so. Failing the render is loud on purpose: the test suite
 * renders the packet, so a register that no longer fits the paper cannot merge.
 *
 * ⚠ A letter is drawn only from glyphs the font already uses on the carrier's paper, with the width
 * the file already declares for it. A correction needing a glyph the font does not carry throws
 * rather than drawing a missing-glyph box.
 */

interface FontMaps {
  /** glyph id → the text it stands for, from the font's own ToUnicode map. */
  toText: Map<number, string>;
  /** single character → glyph id: the inverse, for drawing a corrected word. */
  toGlyph: Map<string, number>;
  /** glyph id → advance width in thousandths of an em, as the file declares it. */
  width: Map<number, number>;
}

function parseToUnicode(cmap: string): Map<number, string> {
  const out = new Map<number, string>();
  const text = (hex: string): string =>
    String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, gid, uni] of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      out.set(parseInt(gid!, 16), text(uni!));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, start] of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const first = parseInt(start!, 16);
      for (let g = parseInt(lo!, 16); g <= parseInt(hi!, 16); g++) out.set(g, String.fromCharCode(first + g - parseInt(lo!, 16)));
    }
  }
  return out;
}

function fontMaps(doc: PDFDocument, font: PDFDict): FontMaps {
  const stream = doc.context.lookup(font.get(PDFName.of("ToUnicode"))) as PDFRawStream;
  const toText = parseToUnicode(Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"));
  // Widths: only a glyph the file declares a width for may be drawn, or a viewer falls back to 1000.
  const desc = doc.context.lookup(font.lookup(PDFName.of("DescendantFonts"), PDFArray).get(0), PDFDict);
  const w = desc.lookup(PDFName.of("W"), PDFArray).asArray().map((o) => o.toString());
  const width = new Map<number, number>();
  for (let i = 0; i < w.length; ) {
    const first = Number(w[i]);
    if (w[i + 1]!.startsWith("[")) {
      w[i + 1]!.replace(/[[\]]/g, "").trim().split(/\s+/).forEach((v, k) => width.set(first + k, Number(v)));
      i += 2;
    } else {
      for (let g = first; g <= Number(w[i + 1]); g++) width.set(g, Number(w[i + 2]));
      i += 3;
    }
  }
  const toGlyph = new Map<string, number>();
  for (const [gid, t] of toText) if (t.length === 1 && width.has(gid) && !toGlyph.has(t)) toGlyph.set(t, gid);
  return { toText, toGlyph, width };
}

interface Glyph {
  gid: number;
  /** The TJ adjustment that followed it on the carrier's paper, verbatim; "" when none. */
  adj: string;
}

function decodeTJ(body: string): Glyph[] {
  const out: Glyph[] = [];
  for (const [, hex, adj] of body.matchAll(/<([0-9A-Fa-f]+)>(-?[\d.]*)/g)) {
    for (const g of hex!.match(/.{4}/g) ?? []) out.push({ gid: parseInt(g, 16), adj: "" });
    out[out.length - 1]!.adj = adj ?? "";
  }
  return out;
}

/** A line's advance in text-space thousandths: glyph widths less the TJ adjustments between them. */
const lineWidth = (glyphs: readonly Glyph[], maps: FontMaps): number =>
  glyphs.reduce((sum, g) => sum + (maps.width.get(g.gid) ?? 0) - (g.adj ? Number(g.adj) : 0), 0);

const encodeTJ = (glyphs: readonly Glyph[]): string =>
  glyphs.map((g) => `<${g.gid.toString(16).toUpperCase().padStart(4, "0")}>${g.adj}`).join("");

/** Apply one page's corrections to one line; returns the new glyphs and how often each entry hit. */
function correctLine(glyphs: Glyph[], maps: FontMaps, entries: readonly PacketSpelling[], hits: Map<PacketSpelling, number>): Glyph[] {
  let line = glyphs;
  for (const entry of entries) {
    // ⚠ Resume AFTER each correction: `wil` → `will` would otherwise find its own output for ever.
    let from = 0;
    for (;;) {
      // The text, and for each character the glyph it came from (a ligature is one glyph, two chars).
      let text = "";
      const owner: number[] = [];
      line.forEach((g, i) => {
        const t = maps.toText.get(g.gid) ?? "�";
        text += t;
        for (let k = 0; k < t.length; k++) owner.push(i);
      });
      const at = text.indexOf(entry.wrong, from);
      if (at < 0) break;
      from = at + entry.right.length;
      const first = owner[at]!;
      const last = owner[at + entry.wrong.length - 1]!;
      const drawn = [...entry.right].map((ch) => {
        const gid = maps.toGlyph.get(ch);
        if (gid === undefined) {
          throw new Error(`packet p${entry.page}: "${entry.right}" needs "${ch}", which this font does not carry`);
        }
        return { gid, adj: "" };
      });
      // The adjustment after the last replaced glyph belongs to the gap before the next word: keep it.
      drawn[drawn.length - 1]!.adj = line[last]!.adj;
      line = [...line.slice(0, first), ...drawn, ...line.slice(last + 1)];
      hits.set(entry, (hits.get(entry) ?? 0) + 1);
    }
  }
  return line;
}

function contentStreams(doc: PDFDocument, pageIndex: number): Array<{ ref: PDFRef | null; stream: PDFRawStream }> {
  const c = doc.getPage(pageIndex).node.Contents();
  if (!c) return [];
  const items = c instanceof PDFArray ? c.asArray() : [c];
  return items.map((item) => ({
    ref: item instanceof PDFRef ? item : null,
    stream: (item instanceof PDFRef ? doc.context.lookup(item) : item) as PDFRawStream,
  }));
}

/** Each printed line of one page, as its glyphs spell it — for tests, and for writing the register. */
export function packetLineTexts(doc: PDFDocument, pageIndex: number): string[] {
  const fonts = doc.getPage(pageIndex).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const out: string[] = [];
  for (const { stream } of contentStreams(doc, pageIndex)) {
    const source = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    let font = "";
    for (const m of source.matchAll(/\/(\w+) [\d.]+ Tf|\[([^\]]*)\] TJ/g)) {
      if (m[1]) font = m[1];
      else {
        const maps = fontMaps(doc, doc.context.lookup(fonts.get(PDFName.of(font))!, PDFDict));
        out.push(decodeTJ(m[2]!).map((g) => maps.toText.get(g.gid) ?? "\uFFFD").join(""));
      }
    }
  }
  return out;
}

/** A clip rectangle in the page's content space. */
interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** One printed run: its line of glyphs, where it starts, and the cell rectangle it is clipped to. */
interface Run {
  stream: number;
  font: string;
  size: number;
  x: number;
  /** Where in the stream source the `Tm`'s x, and the TJ array, sit — for editing in place. */
  xAt: [number, number];
  tjAt: [number, number];
  clip: Box | null;
  clipAt: [number, number] | null;
  clipSource: string;
  glyphs: Glyph[];
}

const CLIP = /(-?[\d.]+) (-?[\d.]+) m\n(-?[\d.]+) (-?[\d.]+) l\n(-?[\d.]+) (-?[\d.]+) l\n(-?[\d.]+) (-?[\d.]+) l\nh\nW\*? n\n/g;

function runsOf(sources: readonly string[]): Run[] {
  const runs: Run[] = [];
  sources.forEach((source, stream) => {
    for (const m of source.matchAll(/\/(\w+) ([\d.]+) Tf\n1 0 -?[\d.]+ -1 (-?[\d.]+) (-?[\d.]+) Tm\n\[([^\]]*)\] TJ/g)) {
      const font = m[1]!;
      const size = Number(m[2]);
      const at = m.index!;
      const xStart = at + m[0].indexOf(" -1 ") + 4;
      const tjStart = at + m[0].lastIndexOf("[");
      // The clip is the last rectangle drawn in this run's own `q` block, before its `BT`.
      const q = source.lastIndexOf("\nq\n", at);
      let clip: Box | null = null;
      let clipAt: [number, number] | null = null;
      let clipSource = "";
      for (const c of source.slice(q, at).matchAll(CLIP)) {
        const xs = [c[1], c[3], c[5], c[7]].map(Number);
        const ys = [c[2], c[4], c[6], c[8]].map(Number);
        clip = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
        clipAt = [q + c.index!, q + c.index! + c[0].length];
        clipSource = c[0];
      }
      runs.push({
        stream, font, size, x: Number(m[3]),
        xAt: [xStart, xStart + m[3]!.length],
        tjAt: [tjStart, at + m[0].length],
        clip, clipAt, clipSource,
        glyphs: decodeTJ(m[5]!),
      });
    }
  });
  return runs;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.minX < b.maxX - 0.5 && a.maxX > b.minX + 0.5 && a.minY < b.maxY - 0.5 && a.maxY > b.minY + 0.5;

/** What one corrected run needed so that it prints whole, inside space nothing else uses. */
export interface PacketSpellingFit {
  page: number;
  text: string;
  how: "fits" | "recentred" | "clip widened" | "condensed";
  /** Horizontal scale, percent; 100 unless condensed. */
  scale: number;
}

/**
 * Correct the loaded template in place, and say how each corrected line was fitted. Throws if any
 * entry lands a different number of times than it declares — see the header.
 *
 * ⚠ **How a line that grew is fitted, in order of preference** — every run on the carrier's paper is
 * clipped to a rectangle (`W* n`), usually its cell and sometimes only its own glyphs, so a letter
 * added past the edge is cut off. Measured before this existed: `numbe` on page 23, `employment o`
 * on page 11, `each vehicle an` on page 24.
 *  1. it still fits its rectangle — nothing more;
 *  2. it was CENTRED in its rectangle (a heading in a box) — moved left by half the growth;
 *  3. the space to the rectangle's right is empty on the page — the rectangle is widened to fit;
 *  4. only then condensed (Tz) to the width available — and the fit report says by how much.
 */
export function applyPacketSpelling(doc: PDFDocument, register: readonly PacketSpelling[] = PACKET_SPELLING): PacketSpellingFit[] {
  const hits = new Map<PacketSpelling, number>();
  const cache = new Map<string, FontMaps>();
  const fits: PacketSpellingFit[] = [];
  for (let p = 0; p < doc.getPageCount(); p++) {
    const entries = register.filter((e) => e.page === p + 1);
    if (entries.length === 0) continue;
    const fonts = doc.getPage(p).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const mapsFor = (name: string): FontMaps => {
      const ref = fonts.get(PDFName.of(name))!;
      const key = ref.toString();
      if (!cache.has(key)) cache.set(key, fontMaps(doc, doc.context.lookup(ref, PDFDict)));
      return cache.get(key)!;
    };
    const streams = contentStreams(doc, p);
    const sources = streams.map(({ stream }) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"));
    const runs = runsOf(sources);
    // Everything else on the page a widened rectangle must not reach into.
    const occupied = runs.map((r) => r.clip).filter((b): b is Box => b !== null);
    const edits = sources.map(() => [] as Array<{ at: [number, number]; text: string }>);

    for (const run of runs) {
      const maps = mapsFor(run.font);
      const corrected = correctLine(run.glyphs, maps, entries, hits);
      if (corrected === run.glyphs) continue;
      const text = corrected.map((g) => maps.toText.get(g.gid) ?? "").join("");
      const oldW = (lineWidth(run.glyphs, maps) / 1000) * run.size;
      const newW = (lineWidth(corrected, maps) / 1000) * run.size;
      const grow = newW - oldW;
      let x = run.x;
      let tz = 100;
      let how: PacketSpellingFit["how"] = "fits";
      const clip = run.clip;
      if (clip && x + newW > clip.maxX - 0.5) {
        const left = run.x - clip.minX;
        const right = clip.maxX - (run.x + oldW);
        if (left > 3 && Math.abs(left - right) < 3 && run.x - grow / 2 >= clip.minX + 0.5) {
          x = run.x - grow / 2;
          how = "recentred";
        } else {
          const need = x + newW + 1;
          const strip: Box = { minX: clip.maxX, maxX: need, minY: clip.minY, maxY: clip.maxY };
          if (!occupied.some((b) => b !== clip && overlaps(b, strip)) && need <= 612 / 0.75) {
            const widened = run.clipSource.replaceAll(String(clip.maxX.toFixed(6)), need.toFixed(6));
            edits[run.stream]!.push({ at: run.clipAt!, text: widened });
            clip.maxX = need;
            how = "clip widened";
          } else {
            tz = (100 * (clip.maxX - 0.5 - x)) / newW;
            how = "condensed";
          }
        }
      }
      if (x !== run.x) edits[run.stream]!.push({ at: run.xAt, text: x.toFixed(6) });
      const tj = `[${encodeTJ(corrected)}] TJ`;
      edits[run.stream]!.push({ at: run.tjAt, text: tz < 100 ? `${tz.toFixed(3)} Tz ${tj} 100 Tz` : tj });
      fits.push({ page: p + 1, text, how, scale: Math.round(tz * 10) / 10 });
    }

    edits.forEach((list, i) => {
      if (list.length === 0) return;
      let out = sources[i]!;
      for (const e of [...list].sort((a, b) => b.at[0] - a.at[0])) out = out.slice(0, e.at[0]) + e.text + out.slice(e.at[1]);
      const { ref } = streams[i]!;
      if (!ref) throw new Error(`packet p${p + 1}: an inline content stream cannot be replaced`);
      doc.context.assign(ref, doc.context.flateStream(Buffer.from(out, "latin1")));
    });
  }
  const wrong = register.filter((e) => (hits.get(e) ?? 0) !== (e.times ?? 1));
  if (wrong.length > 0) {
    throw new Error(
      `packet spelling register does not fit the paper: ${wrong
        .map((e) => `p${e.page} "${e.wrong}" landed ${hits.get(e) ?? 0}× (expected ${e.times ?? 1})`)
        .join("; ")}`,
    );
  }
  return fits;
}

/**
 * The page's layout facts a correction could break, read back from a document — for the test that
 * holds `applyPacketSpelling` to its promise. Per page: every run whose glyphs reach past the right
 * edge of its own clip rectangle, and every pair of clip rectangles that overlap.
 */
export function packetClipReport(doc: PDFDocument, page: number): { overruns: string[]; overlaps: number } {
  const fonts = doc.getPage(page - 1).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const sources = contentStreams(doc, page - 1).map(({ stream }) =>
    Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"),
  );
  const runs = runsOf(sources);
  const overruns: string[] = [];
  for (const run of runs) {
    if (!run.clip) continue;
    const maps = fontMaps(doc, doc.context.lookup(fonts.get(PDFName.of(run.font))!, PDFDict));
    const tz = Number(/(-?[\d.]+) Tz \[[^\]]*\] TJ\s*$/.exec(sources[run.stream]!.slice(0, run.tjAt[1]))?.[1] ?? 100);
    const right = run.x + ((lineWidth(run.glyphs, maps) / 1000) * run.size * tz) / 100;
    if (right > run.clip.maxX + 0.5) overruns.push(run.glyphs.map((g) => maps.toText.get(g.gid) ?? "").join(""));
  }
  const clips = runs.map((r) => r.clip).filter((b): b is Box => b !== null);
  let pairs = 0;
  for (let i = 0; i < clips.length; i++) for (let j = i + 1; j < clips.length; j++) if (overlaps(clips[i]!, clips[j]!)) pairs++;
  return { overruns, overlaps: pairs };
}
