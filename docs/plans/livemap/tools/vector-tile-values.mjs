// Count the values of chosen properties in HERE vector tiles (D-DR31 handoff, 2026-11-10).
// Run from apps/api so .env supplies HERE_API_KEY (the key never goes on the command line):
//   node --env-file=.env ../../docs/plans/livemap/tools/vector-tile-values.mjs \
//     '["9/131/190","14/4201/6091"]' '{"road_labels":["network"],"pois":["kind"],"landuse":["kind"]}'
// No dependencies: it decodes the MVT protobuf by hand. Each tile is one billed HERE request.
// Count values of chosen properties per layer across a set of tiles (MVT decode, no deps).
const k = process.env.HERE_API_KEY;
const tiles = JSON.parse(process.argv[2]); const want = JSON.parse(process.argv[3]);
const varint = (b, st) => { let r = 0, s = 0, c; do { c = b[st.p++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return r; };
function fields(b, cb) { const st = { p: 0 }; while (st.p < b.length) { const key = varint(b, st); const f = key >> 3, t = key & 7;
  if (t === 0) cb(f, t, varint(b, st)); else if (t === 2) { const l = varint(b, st); cb(f, t, b.subarray(st.p, st.p + l)); st.p += l; } else if (t === 5) { cb(f, t, new DataView(b.buffer, b.byteOffset + st.p, 4).getFloat32(0, true)); st.p += 4; } else if (t === 1) { cb(f, t, new DataView(b.buffer, b.byteOffset + st.p, 8).getFloat64(0, true)); st.p += 8; } } }
const dec = new TextDecoder(); const counts = {};
for (const t of tiles) {
  const buf = new Uint8Array(await (await fetch(`https://vector.hereapi.com/v2/vectortiles/base/mc/${t}/omv?apikey=${k}`)).arrayBuffer());
  fields(buf, (f, _t, v) => { if (f !== 3) return; let name = "", keys = [], vals = [], feats = [];
    fields(v, (lf, _lt, lv) => { if (lf === 1) name = dec.decode(lv); else if (lf === 3) keys.push(dec.decode(lv)); else if (lf === 2) feats.push(lv); else if (lf === 4) { let val = null; fields(lv, (_vf, vt, vv) => { val = vt === 2 ? dec.decode(vv) : vv; }); vals.push(val); } });
    if (!want[name]) return;
    for (const fb of feats) fields(fb, (ff, _ft, fv) => { if (ff !== 2) return; const st = { p: 0 }, tags = []; while (st.p < fv.length) tags.push(varint(fv, st));
      for (let i = 0; i < tags.length; i += 2) { const key = keys[tags[i]]; if (want[name].includes(key)) { const kk = `${name}.${key}=${vals[tags[i + 1]]}`; counts[kk] = (counts[kk] ?? 0) + 1; } } });
  });
}
const byKey = {}; for (const [kk, n] of Object.entries(counts)) { const [lk] = kk.split("="); (byKey[lk] ??= []).push([kk.slice(lk.length + 1), n]); }
for (const [lk, arr] of Object.entries(byKey)) console.log(lk, "→", arr.sort((a, b) => b[1] - a[1]).slice(0, 25).map(([v, n]) => `${v}(${n})`).join("  "));
