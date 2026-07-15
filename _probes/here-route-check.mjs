// HERE truck-routing live verification (READ-ONLY). Confirms the real v8 response shape matches our parser
// and that our Flexible Polyline decoder works on ACTUAL HERE output.
//   HERE_API_KEY=xxxx node _probes/here-route-check.mjs
// Prints: HTTP status, section/summary shape, decoded distance + point count, and first/last decoded points
// (should sit near Chicago and Kansas City). Nothing is written.

const KEY = process.env.HERE_API_KEY;
if (!KEY) { console.error("Set HERE_API_KEY"); process.exit(1); }
const BASE = process.env.HERE_ROUTER_URL || "https://router.hereapi.com/v8/routes";

// Chicago, IL -> Kansas City, MO with a full 80k-lb 5-axle truck profile (kg/cm, matching our builder).
const params = [
  ["transportMode", "truck"],
  ["origin", "41.8781,-87.6298"],
  ["destination", "39.0997,-94.5786"],
  ["return", "polyline,summary"],
  ["vehicle[grossWeight]", "36287"],
  ["vehicle[height]", "411"],
  ["vehicle[width]", "259"],
  ["vehicle[length]", "2134"],
  ["vehicle[axleCount]", "5"],
  ["apiKey", KEY],
];
const url = `${BASE}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;

// Minimal Flexible Polyline decoder (same algorithm as packages/shared/src/smartFueling/flexPolyline.ts).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const M = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));
function* varints(s) { let r = 0n, sh = 0n; for (const ch of s) { const v = M.get(ch); if (v === undefined) throw new Error("bad char"); r |= (v & 0x1fn) << sh; if ((v & 0x20n) === 0n) { yield r; r = 0n; sh = 0n; } else sh += 5n; } }
const unzig = (v) => ((v & 1n) === 1n ? ~(v >> 1n) : v >> 1n);
function decode(enc) {
  const it = varints(enc); if (it.next().value !== 1n) throw new Error("ver");
  const h = it.next().value; const prec = Number(h & 15n); const third = Number((h >> 4n) & 7n);
  const f = 10 ** prec; const dims = third ? 3 : 2; const out = []; let lat = 0n, lng = 0n; const buf = [];
  for (const v of it) { buf.push(unzig(v)); if (buf.length === dims) { lat += buf[0]; lng += buf[1]; out.push([Number(lat) / f, Number(lng) / f]); buf.length = 0; } }
  return out;
}

(async () => {
  console.log(`\n=== HERE truck route check — ${new Date().toISOString()} ===\n`);
  const res = await fetch(url);
  console.log(`HTTP: ${res.status} ${res.statusText}`);
  if (!res.ok) { console.log((await res.text()).slice(0, 500)); process.exit(1); }
  const j = await res.json();
  const route = j.routes?.[0];
  console.log(`routes: ${j.routes?.length ?? 0};  sections: ${route?.sections?.length ?? 0}`);
  if (!route?.sections?.length) { console.log("NO SECTIONS — parser assumption broken. Raw:", JSON.stringify(j).slice(0, 400)); process.exit(1); }
  const s0 = route.sections[0];
  console.log(`section[0] keys: [${Object.keys(s0).join(", ")}]`);
  console.log(`summary keys: [${Object.keys(s0.summary ?? {}).join(", ")}]  (expect length, duration)`);
  console.log(`polyline present: ${!!s0.polyline};  prefix: ${String(s0.polyline).slice(0, 24)}...`);
  let totalM = 0, totalS = 0, pts = [];
  for (const sec of route.sections) { totalM += sec.summary?.length ?? 0; totalS += sec.summary?.duration ?? 0; if (sec.polyline) pts = pts.concat(decode(sec.polyline)); }
  console.log(`\nDECODED: ${pts.length} points;  distance ${(totalM / 1609.344).toFixed(1)} mi;  duration ${(totalS / 3600).toFixed(1)} h`);
  console.log(`  first point: ${pts[0]?.map((n) => n.toFixed(4)).join(", ")}  (expect ~41.88, -87.63 Chicago)`);
  console.log(`  last point:  ${pts[pts.length - 1]?.map((n) => n.toFixed(4)).join(", ")}  (expect ~39.10, -94.58 Kansas City)`);
  console.log(`\n✓ If distance ~500 mi and endpoints match, the HERE integration + decoder are verified on live data.\n`);
})().catch((e) => { console.error("PROBE ERROR:", e.message); process.exit(1); });
