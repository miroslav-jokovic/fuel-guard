// For each place in a JSON list (from here-browse-truck-places.mjs), find it in the zoom-17 HERE vector
// tile it sits in and print the kind, pds_category and min_zoom the VECTOR data gives it (D-DR31 handoff).
//   node --env-file=.env ../../docs/plans/livemap/tools/vector-poi-match.mjs places.json
// Matching is on the first word of the name within the tile and its 8 neighbours, so a "NOT IN VECTOR
// TILE" line means "no POI with that word nearby", which is what was measured, not a proof of absence.
// For each HERE Browse place, read the z17 vector tile it sits in (and neighbours) and report the
// nearest POI with a matching first word of the name: its kind, pds_category and min_zoom.
import { readFileSync } from "node:fs";
const k = process.env.HERE_API_KEY; const stops = JSON.parse(readFileSync(process.argv[2], "utf8"));
const varint = (b, st) => { let r = 0, s = 0, c; do { c = b[st.p++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return r; };
function fields(b, cb) { const st = { p: 0 }; while (st.p < b.length) { const key = varint(b, st); const f = key >> 3, t = key & 7;
  if (t === 0) cb(f, t, varint(b, st)); else if (t === 2) { const l = varint(b, st); cb(f, t, b.subarray(st.p, st.p + l)); st.p += l; } else if (t === 5) { st.p += 4; cb(f, t, 0); } else if (t === 1) { st.p += 8; cb(f, t, 0); } } }
const dec = new TextDecoder(); const cache = new Map();
async function pois(z, x, y) { const key = `${z}/${x}/${y}`; if (cache.has(key)) return cache.get(key); const out = [];
  const buf = new Uint8Array(await (await fetch(`https://vector.hereapi.com/v2/vectortiles/base/mc/${key}/omv?apikey=${k}`)).arrayBuffer());
  fields(buf, (f, _t, v) => { if (f !== 3) return; let name = "", keys = [], vals = [], feats = [];
    fields(v, (lf, _lt, lv) => { if (lf === 1) name = dec.decode(lv); else if (lf === 3) keys.push(dec.decode(lv)); else if (lf === 2) feats.push(lv); else if (lf === 4) { let val = null; fields(lv, (_vf, vt, vv) => { val = vt === 2 ? dec.decode(vv) : vv; }); vals.push(val); } });
    if (name !== "pois") return;
    for (const fb of feats) fields(fb, (ff, _ft, fv) => { if (ff !== 2) return; const st = { p: 0 }, tags = []; while (st.p < fv.length) tags.push(varint(fv, st)); const o = {}; for (let i = 0; i < tags.length; i += 2) o[keys[tags[i]]] = vals[tags[i + 1]]; out.push(o); });
  }); cache.set(key, out); return out; }
const rows = [];
for (const s of stops) {
  const z = 17, n = 2 ** z, x = Math.floor(((s.lng + 180) / 360) * n), r = (s.lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  const word = s.name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  let hit = null;
  for (const dx of [0, -1, 1]) for (const dy of [0, -1, 1]) { if (hit) break; for (const p of await pois(z, x + dx, y + dy)) if ((p.name ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(word)) { hit = p; break; } }
  rows.push(`${s.browseCat} | ${s.name.slice(0, 34).padEnd(34)} | ${hit ? `kind=${hit.kind} cat=${hit.pds_category} min_zoom=${hit.min_zoom}` : "NOT IN VECTOR TILE"}`);
}
console.log(rows.join("\n"));
