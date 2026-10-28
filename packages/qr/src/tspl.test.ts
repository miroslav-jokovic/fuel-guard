import { describe, expect, it } from "vitest";
import { createBitmap, fillRect } from "./raster.js";
import { inflate } from "./heatshrinkInflate.js";
import { toTspl, TSPL_COMMANDS_USED } from "./tspl.js";

/**
 * The RW403B drops a whole job, silently, on any command outside its subset (plan §2) — so the
 * first thing pinned is that nothing else is ever emitted. Then the facts a wrong guess turns into
 * a label that does not come out (PS5): MUNBYN's driver's header, verbatim, and the compressed
 * mode-3 picture; then those it turns into a blank or a negative: the bit polarity and the row width.
 */

const SUBSET = new Set(["SIZE", "GAP", "BLINE", "REFERENCE", "OFFSET", "SETC", "DENSITY", "SPEED", "DIRECTION", "CLS", "BITMAP", "PRINT"]);
const OPTS = { widthMm: 50.8, heightMm: 50.8, gapMm: 3 };

/** Each label's picture, unpacked: `BITMAP x,y,widthBytes,height,3,length,<length bytes>`. */
function pictures(job: Uint8Array): { header: string; bytes: Uint8Array }[] {
  const text = String.fromCharCode(...job);
  const out: { header: string; bytes: Uint8Array }[] = [];
  for (let at = text.indexOf("BITMAP "); at >= 0; at = text.indexOf("BITMAP ", at + 1)) {
    const fields = text.slice(at, at + 60).split(",");
    const header = fields.slice(0, 6).join(",") + ",";
    const start = at + header.length;
    out.push({ header, bytes: inflate(job.slice(start, start + Number(fields[5]))) });
  }
  return out;
}

/** The command words of a job, skipping each bitmap's binary body. */
function commands(job: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < job.length) {
    let j = i;
    while (j < job.length && job[j] !== 0x0d && job[j] !== 0x2c && job[j] !== 0x20) j += 1;
    const word = String.fromCharCode(...job.slice(i, j));
    if (word === "BITMAP") {
      const header = String.fromCharCode(...job.slice(i, i + 40)).split(",");
      const bodyStart = i + header.slice(0, 6).join(",").length + 1;
      out.push(word);
      i = bodyStart + Number(header[5]) + 2; // the compressed body, then "\r\n"
      continue;
    }
    out.push(word);
    while (i < job.length && job[i] !== 0x0a) i += 1;
    i += 1;
  }
  return out.filter(Boolean);
}

describe("toTspl", () => {
  it("emits only commands the RW403B honours", () => {
    const b = createBitmap(406, 406);
    fillRect(b, 10, 10, 50, 50);
    const words = commands(toTspl([b, b], OPTS));
    expect(words.length).toBeGreaterThan(5);
    for (const w of words) expect(SUBSET.has(w), w).toBe(true);
    for (const w of TSPL_COMMANDS_USED) expect(SUBSET.has(w), w).toBe(true);
  });

  it("prints each label once, as its own block", () => {
    const b = createBitmap(16, 16);
    const words = commands(toTspl([b, b, b], OPTS));
    expect(words.filter((w) => w === "PRINT")).toHaveLength(3);
    expect(words.filter((w) => w === "CLS")).toHaveLength(3);
  });

  it("burns CLEAR bits: a dark dot is a 0, a white one a 1", () => {
    const b = createBitmap(16, 1);
    fillRect(b, 0, 0, 4, 1); // the first four dots dark
    const [picture] = pictures(toTspl([b], OPTS));
    expect([...picture!.bytes]).toEqual([0b00001111, 0xff]);
  });

  it("...and the other way for a printer that says so", () => {
    const b = createBitmap(8, 1);
    fillRect(b, 0, 0, 1, 1);
    const [picture] = pictures(toTspl([b], { ...OPTS, blackIsOne: true }));
    expect([...picture!.bytes]).toEqual([0b10000000]);
  });

  it("pads a row to whole bytes, white", () => {
    const [picture] = pictures(toTspl([createBitmap(406, 1)], OPTS));
    expect(picture!.header.startsWith("BITMAP 0,0,51,1,3,")).toBe(true);
    expect(picture!.bytes).toEqual(new Uint8Array(51).fill(0xff));
  });

  it("sends the picture compressed, mode 3, with its length", () => {
    const b = createBitmap(406, 406);
    fillRect(b, 40, 40, 200, 200);
    const job = toTspl([b], OPTS);
    const [picture] = pictures(job);
    expect(picture!.header).toMatch(/^BITMAP 0,0,51,406,3,\d+,$/);
    expect(picture!.bytes).toHaveLength(51 * 406);
    expect(picture!.bytes.filter((x) => x === 0x00).length).toBe(25 * 200); // 200 dark dots from x=40: 25 whole bytes a row
    expect(job.length).toBeLessThan(51 * 406 / 4);
  });

  it("opens with MUNBYN's driver's setup lines, verbatim", () => {
    const text = String.fromCharCode(...toTspl([createBitmap(8, 8)], OPTS));
    expect(text.startsWith(
      "SIZE 50.80 mm,50.80 mm\r\nGAP 3.00 mm,0.00 mm\r\nREFERENCE 0,0\r\nOFFSET 0\r\nDENSITY 8\r\nSPEED 4\r\nDIRECTION 0,0\r\nCLS\r\nBITMAP ",
    )).toBe(true);
  });

  it("refuses an empty job and an out-of-range density", () => {
    expect(() => toTspl([], OPTS)).toThrow(/at least one label/);
    expect(() => toTspl([createBitmap(8, 8)], { ...OPTS, density: 20 })).toThrow(/Density/);
  });
});
