import { describe, expect, it } from "vitest";
import { aspectCorrection, needsStretch, tiffResolution } from "./tiffResolution.js";

/**
 * A "normal"-mode fax stores 204 × 98 dpi pixels; drawn as stored, every letter is squashed to half height.
 * What must hold: each page's resolution is read from ITS OWN IFD, a short or broken file answers null
 * (the page is then decoded as stored, never refused for it), and only the low-resolution axis grows.
 */

/** A minimal TIFF: a header, then one IFD per page holding only XResolution and YResolution. */
function tiff(pages: { x: [number, number]; y: [number, number] }[], le = true): Uint8Array {
  const ifdSize = 2 + 2 * 12 + 4;
  const pageSize = ifdSize + 16; // the IFD, then its two RATIONALs
  const buf = new DataView(new ArrayBuffer(8 + pages.length * pageSize));
  const u16 = (at: number, v: number) => buf.setUint16(at, v, le);
  const u32 = (at: number, v: number) => buf.setUint32(at, v, le);
  new Uint8Array(buf.buffer).set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  u16(2, 42);
  u32(4, 8);
  pages.forEach((p, i) => {
    const ifd = 8 + i * pageSize;
    const values = ifd + ifdSize;
    u16(ifd, 2);
    const tags: [number, [number, number], number][] = [[282, p.x, values], [283, p.y, values + 8]];
    tags.forEach(([tag, [num, den], at], e) => {
      const entry = ifd + 2 + e * 12;
      u16(entry, tag); u16(entry + 2, 5); u32(entry + 4, 1); u32(entry + 8, at);
      u32(at, num); u32(at + 4, den);
    });
    u32(ifd + 2 + 2 * 12, i + 1 < pages.length ? ifd + pageSize : 0);
  });
  return new Uint8Array(buf.buffer);
}

describe("tiffResolution", () => {
  it("reads a fax page's 204 × 98, in either byte order", () => {
    expect(tiffResolution(tiff([{ x: [204, 1], y: [98, 1] }]), 0)).toEqual({ x: 204, y: 98 });
    expect(tiffResolution(tiff([{ x: [204, 1], y: [98, 1] }], false), 0)).toEqual({ x: 204, y: 98 });
  });

  it("reads each page from its own IFD — a fax can mix normal and fine pages", () => {
    const mixed = tiff([{ x: [204, 1], y: [196, 1] }, { x: [2040, 10], y: [980, 10] }, { x: [300, 1], y: [300, 1] }]);
    expect([0, 1, 2].map((p) => tiffResolution(mixed, p))).toEqual([{ x: 204, y: 196 }, { x: 204, y: 98 }, { x: 300, y: 300 }]);
  });

  it("answers null for a page past the last, a missing tag, a zero denominator, and bytes that are not a TIFF", () => {
    expect(tiffResolution(tiff([{ x: [204, 1], y: [98, 1] }]), 1)).toBeNull();
    expect(tiffResolution(tiff([{ x: [204, 0], y: [98, 1] }]), 0)).toBeNull();
    expect(tiffResolution(tiff([{ x: [204, 1], y: [98, 1] }]).subarray(0, 30), 0)).toBeNull();
    expect(tiffResolution(new TextEncoder().encode("not a tiff at all"), 0)).toBeNull();
    const noY = tiff([{ x: [204, 1], y: [98, 1] }]);
    new DataView(noY.buffer).setUint16(8 + 2 + 12, 999, true); // YResolution's tag renamed away
    expect(tiffResolution(noY, 0)).toBeNull();
  });

  it("does not spin on an IFD chain that points back at itself", () => {
    const loop = tiff([{ x: [204, 1], y: [98, 1] }]);
    new DataView(loop.buffer).setUint32(8 + 2 + 2 * 12, 8, true);
    expect(tiffResolution(loop, 500)).toBeNull();
  });
});

describe("aspectCorrection", () => {
  it("stretches the low-resolution axis to the high one, and never shrinks", () => {
    expect(aspectCorrection(1728, 1100, { x: 204, y: 98 })).toEqual({ width: 1728, height: 2290 });
    expect(aspectCorrection(1100, 1728, { x: 98, y: 204 })).toEqual({ width: 2290, height: 1728 });
  });

  it("corrects a fine-mode fax's 4% too — its true shape — but leaves square pixels (within 2%) and an unknown resolution as stored", () => {
    expect(aspectCorrection(1728, 2200, { x: 204, y: 196 })).toEqual({ width: 1728, height: 2290 });
    expect(aspectCorrection(2550, 3300, { x: 299.99, y: 300 })).toEqual({ width: 2550, height: 3300 });
    expect(aspectCorrection(1728, 1100, null)).toEqual({ width: 1728, height: 1100 });
    expect([needsStretch({ x: 204, y: 196 }), needsStretch({ x: 202, y: 200 }), needsStretch({ x: 204, y: 98 })]).toEqual([true, false, true]);
  });
});
