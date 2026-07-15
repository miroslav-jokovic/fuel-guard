/**
 * HERE Flexible Polyline decoder (pure, no dependency). `return=polyline` in HERE Routing v8 yields this
 * self-describing encoding PER SECTION; we decode from the header (never hard-code precision). BigInt varints
 * so high 3rd-dim precisions can't silently overflow. Algorithm + test vectors: github.com/heremaps/flexible-polyline.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CHAR_TO_VAL = new Map<string, bigint>([...ALPHABET].map((c, i) => [c, BigInt(i)]));

export interface LatLng {
  lat: number;
  lng: number;
}

function* varints(s: string): Generator<bigint> {
  let result = 0n;
  let shift = 0n;
  for (const ch of s) {
    const v = CHAR_TO_VAL.get(ch);
    if (v === undefined) throw new Error(`flexpolyline: invalid char '${ch}'`);
    result |= (v & 0x1fn) << shift;
    if ((v & 0x20n) === 0n) {
      yield result;
      result = 0n;
      shift = 0n;
    } else {
      shift += 5n;
    }
  }
}

/** Zig-zag decode: even → +n/2, odd → the negative it encoded. */
const unzig = (v: bigint): bigint => ((v & 1n) === 1n ? ~(v >> 1n) : v >> 1n);

/** Decode an encoded Flexible Polyline into ordered lat/lng points (drops any 3rd dimension). */
export function decodeFlexPolyline(encoded: string): LatLng[] {
  const it = varints(encoded);
  const version = it.next();
  if (version.done || version.value !== 1n) throw new Error("flexpolyline: unsupported version");
  const header = it.next();
  if (header.done) throw new Error("flexpolyline: missing header");
  const h = header.value;
  const precision = Number(h & 15n);
  const thirdDim = Number((h >> 4n) & 7n);
  const factor = 10 ** precision;
  const dims = thirdDim ? 3 : 2;

  const out: LatLng[] = [];
  let lat = 0n;
  let lng = 0n;
  const buf: bigint[] = [];
  for (const v of it) {
    buf.push(unzig(v));
    if (buf.length === dims) {
      lat += buf[0]!;
      lng += buf[1]!;
      out.push({ lat: Number(lat) / factor, lng: Number(lng) / factor });
      buf.length = 0;
    }
  }
  if (buf.length) throw new Error("flexpolyline: premature ending");
  return out;
}
