import type { MonoBitmap } from "./raster.js";

/**
 * Labels as TSPL — the language the MUNBYN RW403B speaks (PRINTERS-AND-SCANNERS-PLAN.md D-PS2).
 *
 * ── ONLY COMMANDS THIS FIRMWARE HONOURS ──────────────────────────────────────────────────────
 * Over USB the RW403B accepts `SIZE`, `GAP`/`BLINE`, `REFERENCE`, `OFFSET`, `SETC AUTODOTTED OFF`,
 * `DENSITY`, `SPEED`, `DIRECTION`, `CLS`, `BITMAP` (mode 1) and `PRINT`; anything else makes it drop
 * the WHOLE job silently — no error, no feed (plan §2, measured on the hardware by
 * `m0n01d/munbyn-print`). So this encoder emits nothing outside that list, and a test pins the list:
 * one stray `TEXT` would turn every print into a blank that looks like a paper fault.
 *
 * ── BIT 0 BURNS ──────────────────────────────────────────────────────────────────────────────
 * In a TSPL bitmap a CLEAR bit is black and a set bit is white — the reverse of almost every image
 * format. Confirmed on this model by the same project; `blackIsOne` exists for the day a different
 * printer answers the other way, and is a property of the printer, never of a label.
 *
 * ── NO CALIBRATION COMMAND ───────────────────────────────────────────────────────────────────
 * `GAPDETECT` does nothing on this firmware. The printer learns the label gap from its own feed
 * button (hold until it beeps) or by closing the cover; this file only states the gap so the printer
 * stops at the right place once it has learnt it.
 */

export interface TsplOptions {
  /** Label size in millimetres — the stock, not the drawing. */
  widthMm: number;
  heightMm: number;
  /** Gap between labels on the roll, in millimetres. */
  gapMm: number;
  /** 0–15. Darkness of the burn; the printer's own default is 8. */
  density?: number;
  /** Inches per second; the printer's own default is 4. */
  speed?: number;
  /** True only for a printer that burns SET bits (see the header). */
  blackIsOne?: boolean;
}

/** The commands this encoder may emit, and nothing else (see the header). */
export const TSPL_COMMANDS_USED = ["SIZE", "GAP", "DIRECTION", "REFERENCE", "DENSITY", "SPEED", "CLS", "BITMAP", "PRINT"] as const;

/** Commands are plain ASCII; no TextEncoder, because this package is pure TS with no platform lib. */
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0x7f);

/** One bitmap row packed eight dots to a byte, most significant bit leftmost. */
function packRows(bitmap: MonoBitmap, blackIsOne: boolean): { widthBytes: number; bytes: Uint8Array } {
  const widthBytes = Math.ceil(bitmap.width / 8);
  // Start all-white in this printer's polarity, then flip the dark dots.
  const bytes = new Uint8Array(widthBytes * bitmap.height).fill(blackIsOne ? 0x00 : 0xff);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (!bitmap.dark[y * bitmap.width + x]) continue;
      const i = y * widthBytes + (x >> 3);
      const bit = 0x80 >> (x & 7);
      bytes[i] = blackIsOne ? bytes[i]! | bit : bytes[i]! & ~bit;
    }
  }
  return { widthBytes, bytes };
}

const mm = (n: number): string => `${Number(n.toFixed(2))} mm`;

/**
 * One job: every bitmap is one label, in order. Each label is its own `CLS … PRINT 1,1` block, so a
 * job of forty labels comes out as forty labels rather than one label printed forty times.
 */
export function toTspl(labels: readonly MonoBitmap[], options: TsplOptions): Uint8Array {
  if (labels.length === 0) throw new Error("A print job needs at least one label.");
  const density = options.density ?? 8;
  const speed = options.speed ?? 4;
  if (!Number.isInteger(density) || density < 0 || density > 15) throw new Error(`Density must be 0–15; got ${density}.`);
  if (!Number.isInteger(speed) || speed < 1 || speed > 6) throw new Error(`Speed must be 1–6; got ${speed}.`);

  const parts: Uint8Array[] = [
    ascii(
      [
        `SIZE ${mm(options.widthMm)},${mm(options.heightMm)}`,
        `GAP ${mm(options.gapMm)},0 mm`,
        "DIRECTION 1",
        "REFERENCE 0,0",
        `DENSITY ${density}`,
        `SPEED ${speed}`,
        "",
      ].join("\r\n"),
    ),
  ];
  for (const label of labels) {
    const { widthBytes, bytes } = packRows(label, options.blackIsOne ?? false);
    parts.push(ascii(`CLS\r\nBITMAP 0,0,${widthBytes},${label.height},1,`), bytes, ascii("\r\nPRINT 1,1\r\n"));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
