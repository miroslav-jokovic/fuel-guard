/**
 * Heatshrink compression, the only way this RW403B accepts a picture (PRINTERS-AND-SCANNERS-PLAN.md
 * PS5, measured 10/28 on the office's printer).
 *
 * MUNBYN's own macOS driver (`/Library/Printers/Munbyn/pdf_to_tspl`) sends every label as
 * `BITMAP …,3,<length>,<bytes>`: mode 3, the bitmap compressed with heatshrink (its log says
 * `hs_enc`). Its output decodes to exactly the 51 × 406 bytes of a 2" label with a window of 11 bits
 * and a lookahead of 4, and with no other pair — so those are fixed here, not options.
 *
 * Heatshrink is LZSS written MSB-first: a 1 bit then an 8-bit literal byte, or a 0 bit then
 * (distance − 1) in WINDOW bits and (length − 1) in LOOKAHEAD bits; the last byte is padded with
 * zeros, which a decoder runs out of input on before it can read a whole back-reference. A match
 * costs 16 bits and two literals 18, so any match of two or more is taken.
 *
 * The search is greedy and brute force: a 2" label is 20,706 bytes, mostly white, where the
 * nearest match is already the longest and the loop stops there. A sheet of labels is still under
 * a second; nothing here is on a request path that waits on it more than once per job.
 */

export const HEATSHRINK_WINDOW_BITS = 11;
export const HEATSHRINK_LOOKAHEAD_BITS = 4;

export function heatshrinkEncode(src: Uint8Array): Uint8Array {
  const window = 1 << HEATSHRINK_WINDOW_BITS;
  const longest = 1 << HEATSHRINK_LOOKAHEAD_BITS;
  const out: number[] = [];
  let acc = 0;
  let filled = 0;
  const put = (value: number, bits: number) => {
    for (let b = bits - 1; b >= 0; b -= 1) {
      acc = (acc << 1) | ((value >> b) & 1);
      filled += 1;
      if (filled === 8) {
        out.push(acc);
        acc = 0;
        filled = 0;
      }
    }
  };

  let i = 0;
  while (i < src.length) {
    const max = Math.min(longest, src.length - i);
    let best = 0;
    let distance = 0;
    for (let j = i - 1; j >= Math.max(0, i - window) && best < max; j -= 1) {
      let n = 0;
      while (n < max && src[j + n] === src[i + n]) n += 1;
      if (n > best) {
        best = n;
        distance = i - j;
      }
    }
    if (best >= 2) {
      put(0, 1);
      put(distance - 1, HEATSHRINK_WINDOW_BITS);
      put(best - 1, HEATSHRINK_LOOKAHEAD_BITS);
      i += best;
    } else {
      put(1, 1);
      put(src[i]!, 8);
      i += 1;
    }
  }
  if (filled > 0) out.push(acc << (8 - filled));
  return Uint8Array.from(out);
}
