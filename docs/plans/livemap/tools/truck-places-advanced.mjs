// D-DR34 / Q-DR34 (c): which truck categories HERE's ADVANCED vector tile carries, measured, not read
// off a docs page. For each place in a HERE Browse JSON (from here-browse-truck-places.mjs), fetch the
// zoom-13 tile it sits in with `content=default,advanced_pois` (once per tile) and report whether a
// POI with the same category and name word is in it; then list every truck-category POI the tiles held.
//   node --env-file=apps/api/.env docs/plans/livemap/tools/truck-places-advanced.mjs places.json
// ⚠ Each distinct tile is one request billed at the Advanced rate ($0.239 per 1 000). 40 places → ~24.
// ⚠ "not found" means "no same-category POI whose name holds that word", not proof of absence.
import { readFileSync } from "node:fs";
const k = process.env.HERE_API_KEY;
const varint=(b,st)=>{let r=0,s=0,c;do{c=b[st.p++];r+=(c&0x7f)*2**s;s+=7;}while(c&0x80);return r;};
function fields(b,cb){const st={p:0};while(st.p<b.length){const key=varint(b,st);const f=key>>3,t=key&7;if(t===0)cb(f,t,varint(b,st));else if(t===2){const l=varint(b,st);cb(f,t,b.subarray(st.p,st.p+l));st.p+=l;}else if(t===5){st.p+=4;cb(f,t,0);}else if(t===1){st.p+=8;cb(f,t,0);}}}
const dec=new TextDecoder();
function pois(buf){const out=[];fields(buf,(f,_t,lv)=>{if(f!==3)return;let name="";const keys=[],vals=[],feats=[];fields(lv,(g,_u,v)=>{if(g===1)name=dec.decode(v);else if(g===3)keys.push(dec.decode(v));else if(g===4){let val;fields(v,(h,_w,vv)=>{val=h===1?dec.decode(vv):vv;});vals.push(val);}else if(g===2)feats.push(v);});if(name!=="pois")return;for(const fv of feats){let tags=[];fields(fv,(h,_w,v)=>{if(h===2){const st={p:0};while(st.p<v.length)tags.push(varint(v,st));}});const o={};for(let i=0;i<tags.length;i+=2)o[keys[tags[i]]]=vals[tags[i+1]];out.push(o);}});return out;}
const stops = JSON.parse(readFileSync(process.argv[2], "utf8"));
const cache = new Map();
for (const s of stops) {
  const z = 13, n = 2 ** z, x = Math.floor(((s.lng + 180) / 360) * n), r = (s.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  const key = `${z}/${x}/${y}`;
  if (!cache.has(key)) {
    const res = await fetch(`https://vector.hereapi.com/v2/vectortiles/base/mc/${key}/omv?apikey=${k}&content=default,advanced_pois`);
    cache.set(key, pois(new Uint8Array(await res.arrayBuffer())));
  }
  const word = s.name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const norm = (t) => (t ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const hit = cache.get(key).find((p) => p.pds_category === s.browseCat && norm(p.name).includes(word));
  console.log(`${s.browseCat} | ${s.name.slice(0, 40).padEnd(40)} | ${hit ? `IN: kind=${hit.kind} min_zoom=${hit.min_zoom}` : "not found"}`);
}
console.log(`\nadvanced tile requests: ${cache.size}`);
for (const p of [...cache.values()].flat())
  if (/^700-79|^700-7850-0126|^400-4300/.test(p.pds_category)) console.log(p.pds_category, p.kind, `min_zoom=${p.min_zoom}`, p.name);
