import { HEATSHRINK_LOOKAHEAD_BITS, HEATSHRINK_WINDOW_BITS } from "./heatshrink.js";

/**
 * Test-only: heatshrink's decoder, transcribed — the stand-in for the printer, which is the real
 * decoder and says nothing when it disagrees (PS5). The same transcription, tried over every window
 * and lookahead, is what found 11/4 in MUNBYN's own driver output; nothing in production imports it.
 */
export function inflate(data: Uint8Array): Uint8Array {
  let pos = 0;
  let mask = 0x80;
  const read = (bits: number): number | null => {
    let v = 0;
    for (let b = 0; b < bits; b += 1) {
      if (pos >= data.length) return null;
      v = (v << 1) | (data[pos]! & mask ? 1 : 0);
      mask >>= 1;
      if (mask === 0) {
        mask = 0x80;
        pos += 1;
      }
    }
    return v;
  };
  const out: number[] = [];
  for (;;) {
    const tag = read(1);
    if (tag === null) break;
    if (tag === 1) {
      const byte = read(8);
      if (byte === null) break;
      out.push(byte);
      continue;
    }
    const back = read(HEATSHRINK_WINDOW_BITS);
    const count = read(HEATSHRINK_LOOKAHEAD_BITS);
    if (back === null || count === null) break;
    for (let k = 0; k <= count; k += 1) out.push(out[out.length - back - 1]!);
  }
  return Uint8Array.from(out);
}
