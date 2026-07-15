// Tests whether HERE reroutes hazmat trucks around Columbus OH city center
// Route: Indianapolis IN -> Pittsburgh PA (I-70 corridor naturally passes through Columbus)
// We check if the polyline passes near Columbus downtown vs the I-270 outer belt bypass.

const KEY = "kcpTVPS1Qjxw8fiMLBvbk7zngnTRfKWEwx5H1tATUHw";
const BASE = "https://router.hereapi.com/v8/routes";

// Indianapolis IN -> Pittsburgh PA (natural I-70 path through Columbus)
const ORIGIN = "39.7684,-86.1581";
const DEST   = "40.4406,-79.9959";

// Columbus city center (downtown near I-70/I-71 interchange)
const COLUMBUS_CENTER = { lat: 39.9612, lng: -82.9988 };
// I-270 outer belt approximate center (bypass corridor ~10 mi from downtown)
const BYPASS_CENTER   = { lat: 39.9300, lng: -82.9500 };

function haversineMin(polyline, point) {
  let minMi = Infinity;
  for (const p of polyline) {
    const dLat = (p.lat - point.lat) * Math.PI / 180;
    const dLng = (p.lng - point.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p.lat*Math.PI/180) * Math.cos(point.lat*Math.PI/180) * Math.sin(dLng/2)**2;
    const mi = 3958.8 * 2 * Math.asin(Math.sqrt(a));
    if (mi < minMi) minMi = mi;
  }
  return minMi;
}

// HERE Flexible Polyline decoder — ported from packages/shared/src/smartFueling/flexPolyline.ts
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CHAR_TO_VAL = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));

function* varints(s) {
  let result = 0n, shift = 0n;
  for (const ch of s) {
    const v = CHAR_TO_VAL.get(ch);
    if (v === undefined) throw new Error(`flexpolyline: invalid char '${ch}'`);
    result |= (v & 0x1fn) << shift;
    if ((v & 0x20n) === 0n) { yield result; result = 0n; shift = 0n; }
    else shift += 5n;
  }
}

const unzig = (v) => ((v & 1n) === 1n ? ~(v >> 1n) : v >> 1n);

function decodeFlexPolyline(encoded) {
  const it = varints(encoded);
  const version = it.next();
  if (version.done || version.value !== 1n) throw new Error("flexpolyline: unsupported version");
  const header = it.next();
  if (header.done) throw new Error("flexpolyline: missing header");
  const h = header.value;
  const precision = Number(h & 15n);
  const thirdDim  = Number((h >> 4n) & 7n);
  const factor    = 10 ** precision;
  const dims      = thirdDim ? 3 : 2;
  const out = [];
  let lat = 0n, lng = 0n;
  const buf = [];
  for (const v of it) {
    buf.push(unzig(v));
    if (buf.length === dims) {
      lat += buf[0]; lng += buf[1];
      out.push({ lat: Number(lat) / factor, lng: Number(lng) / factor });
      buf.length = 0;
    }
  }
  return out;
}

async function testRoute(label, hazmat, tunnel) {
  const p = new URLSearchParams({
    transportMode: "truck",
    origin: ORIGIN,
    destination: DEST,
    return: "polyline,summary",
    "vehicle[grossWeight]": "36287",
    "vehicle[height]": "411",
    "vehicle[width]":  "259",
    "vehicle[length]": "2134",
    "vehicle[axleCount]": "5",
    apiKey: KEY,
  });
  if (hazmat) p.set("vehicle[shippedHazardousGoods]", hazmat);
  if (tunnel) p.set("vehicle[tunnelCategory]", tunnel);

  const res = await fetch(`${BASE}?${p}`);
  const d = await res.json();

  if (!d.routes) {
    console.log(`ERROR    ${label}: ${JSON.stringify(d).slice(0, 200)}`);
    return;
  }

  const sec = d.routes[0].sections[0];
  const s = sec.summary;
  const notices = sec.notices ?? [];
  const sevs = notices.map((n) => n.severity);
  const tag = sevs.includes("critical") ? "CRITICAL" : sevs.includes("warning") ? "WARNING " : "CLEAN   ";
  const dist = (s.length / 1609.34).toFixed(1);
  const dur  = (s.duration / 3600).toFixed(2);

  const rawPoly = sec.polyline ?? "";
  const polyPoints = rawPoly.length > 10 ? decodeFlexPolyline(rawPoly) : [];

  const closestToDowntown = polyPoints.length ? haversineMin(polyPoints, COLUMBUS_CENTER).toFixed(2) : "n/a";
  const closestToBypass   = polyPoints.length ? haversineMin(polyPoints, BYPASS_CENTER).toFixed(2) : "n/a";
  const viaDowntown = polyPoints.length && parseFloat(closestToDowntown) < 3.0;

  console.log(`\n${tag} | ${label}`);
  console.log(`         distance: ${dist} mi,  duration: ${dur} h`);
  console.log(`         closest to Columbus downtown: ${closestToDowntown} mi  -> ${viaDowntown ? "THROUGH CITY" : "BYPASS/OUTER"}`);
  console.log(`         closest to I-270 belt:        ${closestToBypass} mi`);
  console.log(`         notices: ${sevs.length ? JSON.stringify(notices.map(n => ({ sev: n.severity, code: n.code }))) : "none"}`);
}

console.log(`\n=== HERE hazmat corridor test: Indianapolis → Pittsburgh (via Columbus OH) ===`);
console.log(`    Columbus downtown coords: ${COLUMBUS_CENTER.lat}, ${COLUMBUS_CENTER.lng}`);
console.log(`    I-270 belt approx:        ${BYPASS_CENTER.lat}, ${BYPASS_CENTER.lng}\n`);

await testRoute("no hazmat (baseline)",     null,          null);
await testRoute("flammable",                "flammable",   null);
await testRoute("flammable + tunnelCat=D",  "flammable",   "D");
await testRoute("explosive + tunnelCat=B",  "explosive",   "B");
await testRoute("explosive + tunnelCat=D",  "explosive",   "D");
