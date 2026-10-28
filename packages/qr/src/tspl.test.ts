import { describe, expect, it } from "vitest";
import { createBitmap, fillRect } from "./raster.js";
import { toTspl, TSPL_COMMANDS_USED } from "./tspl.js";

/**
 * The RW403B drops a whole job, silently, on any command outside its subset (plan §2) — so the
 * first thing pinned is that nothing else is ever emitted. Then the two facts a wrong guess would
 * turn into a blank or a negative label: the bit polarity and the row width.
 */

const SUBSET = new Set(["SIZE", "GAP", "BLINE", "REFERENCE", "OFFSET", "SETC", "DENSITY", "SPEED", "DIRECTION", "CLS", "BITMAP", "PRINT"]);
const OPTS = { widthMm: 50.8, heightMm: 50.8, gapMm: 3 };

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
      const widthBytes = Number(header[2]);
      const height = Number(header[3]);
      const bodyStart = i + header.slice(0, 5).join(",").length + 1;
      out.push(word);
      i = bodyStart + widthBytes * height + 2; // the body, then "\r\n"
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
    const job = toTspl([b], OPTS);
    const text = String.fromCharCode(...job);
    const at = text.indexOf("BITMAP 0,0,2,1,1,") + "BITMAP 0,0,2,1,1,".length;
    expect(job[at]).toBe(0b00001111);
    expect(job[at + 1]).toBe(0xff);
  });

  it("...and the other way for a printer that says so", () => {
    const b = createBitmap(8, 1);
    fillRect(b, 0, 0, 1, 1);
    const job = toTspl([b], { ...OPTS, blackIsOne: true });
    const text = String.fromCharCode(...job);
    const at = text.indexOf("BITMAP 0,0,1,1,1,") + "BITMAP 0,0,1,1,1,".length;
    expect(job[at]).toBe(0b10000000);
  });

  it("pads a row to whole bytes, white", () => {
    const b = createBitmap(406, 1);
    const job = toTspl([b], OPTS);
    const text = String.fromCharCode(...job);
    expect(text).toContain("BITMAP 0,0,51,1,1,");
  });

  it("states the stock in millimetres", () => {
    const text = String.fromCharCode(...toTspl([createBitmap(8, 8)], OPTS));
    expect(text.startsWith("SIZE 50.8 mm,50.8 mm\r\nGAP 3 mm,0 mm\r\n")).toBe(true);
  });

  it("refuses an empty job and an out-of-range density", () => {
    expect(() => toTspl([], OPTS)).toThrow(/at least one label/);
    expect(() => toTspl([createBitmap(8, 8)], { ...OPTS, density: 20 })).toThrow(/Density/);
  });
});
