import { describe, expect, it } from "vitest";
import { HEATSHRINK_LOOKAHEAD_BITS, HEATSHRINK_WINDOW_BITS, heatshrinkEncode } from "./heatshrink.js";
import { inflate } from "./heatshrinkInflate.js";

/**
 * The printer is the real decoder and it says nothing when it disagrees — a job it cannot unpack
 * simply does not print (PS5). So the bit layout is pinned by hand-worked vectors that do not go
 * through any decoder, and the round trip runs through `inflate` (./heatshrinkInflate.ts).
 */

const bits = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(2).padStart(8, "0")).join("");

describe("heatshrinkEncode", () => {
  it("uses the driver's window and lookahead", () => {
    expect([HEATSHRINK_WINDOW_BITS, HEATSHRINK_LOOKAHEAD_BITS]).toEqual([11, 4]);
  });

  it("writes a lone byte as a 1 bit and the byte, zero-padded", () => {
    expect(bits(heatshrinkEncode(Uint8Array.of(0x41)))).toBe("1" + "01000001" + "0000000");
  });

  it("writes a run as one literal then a back-reference of distance 1", () => {
    // 17 white bytes: the first is a literal, the next 16 are "copy from 1 back, 16 long".
    const run = new Uint8Array(17).fill(0xff);
    expect(bits(heatshrinkEncode(run))).toBe("1" + "11111111" + "0" + "00000000000" + "1111" + "0000000");
  });

  it("keeps two different bytes as literals", () => {
    expect(bits(heatshrinkEncode(Uint8Array.of(0x00, 0xff)))).toBe("1" + "00000000" + "1" + "11111111" + "000000");
  });

  it("round-trips a label-shaped bitmap and shrinks it", () => {
    const src = new Uint8Array(51 * 406).fill(0xff);
    for (let i = 0; i < src.length; i += 1) if ((i * 2654435761) % 97 < 9) src[i] = (i * 31) & 0xff;
    const packed = heatshrinkEncode(src);
    expect(inflate(packed)).toEqual(src);
    expect(packed.length).toBeLessThan(src.length / 2);
  });

  it("round-trips matches longer than the window reaches back", () => {
    const src = new Uint8Array(5000);
    for (let i = 0; i < src.length; i += 1) src[i] = i % 2100 < 3 ? 7 : (i * 13) & 0xff;
    expect(inflate(heatshrinkEncode(src))).toEqual(src);
  });

  it("never reaches back further than 11 bits can say", () => {
    // The same sixteen bytes 2,049 apart: one byte beyond the 2,048 the window holds, so the second
    // copy must be literals — a back-reference there would wrap to distance 1 and garble the label.
    const token = Uint8Array.from({ length: 16 }, (_, k) => 0x10 + k);
    const src = new Uint8Array(2049 + 16);
    src.set(token, 0);
    src.set(token, 2049);
    expect(inflate(heatshrinkEncode(src))).toEqual(src);
  });

  it("encodes nothing as nothing", () => {
    expect(heatshrinkEncode(new Uint8Array(0))).toHaveLength(0);
  });
});
