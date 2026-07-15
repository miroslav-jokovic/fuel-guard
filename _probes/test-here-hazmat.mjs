const KEY = "kcpTVPS1Qjxw8fiMLBvbk7zngnTRfKWEwx5H1tATUHw";
const BASE = "https://router.hereapi.com/v8/routes";
const ORIGIN = "33.645916,-100.936387";
const DEST = "32.7767,-96.7970";

const tests = [
  { label: "no hazmat (baseline)",      hazmat: null,             tunnel: null },
  { label: "flammable, no tunnel",       hazmat: "flammable",      tunnel: null },
  { label: "flammable + tunnelCat=B",    hazmat: "flammable",      tunnel: "B"  },
  { label: "flammable + tunnelCat=D",    hazmat: "flammable",      tunnel: "D"  },
  { label: "explosive + tunnelCat=B",    hazmat: "explosive",      tunnel: "B"  },
  { label: "combustible",                hazmat: "combustible",    tunnel: null },
  { label: "harmfulToWater",             hazmat: "harmfulToWater", tunnel: null },
];

for (const t of tests) {
  const p = new URLSearchParams({
    transportMode: "truck",
    origin: ORIGIN,
    destination: DEST,
    return: "summary",
    "vehicle[grossWeight]": "36287",
    apiKey: KEY,
  });
  if (t.hazmat) p.set("vehicle[shippedHazardousGoods]", t.hazmat);
  if (t.tunnel) p.set("vehicle[tunnelCategory]", t.tunnel);

  const res = await fetch(`${BASE}?${p}`);
  const d = await res.json();

  if (!d.routes) {
    console.log(`ERROR    ${t.label.padEnd(42)} -> ${JSON.stringify(d).slice(0, 120)}`);
    continue;
  }
  const sec = d.routes[0].sections[0];
  const s = sec.summary;
  const notices = sec.notices ?? [];
  const sevs = notices.map((n) => n.severity);
  const tag = sevs.includes("critical") ? "CRITICAL" : sevs.includes("warning") ? "WARNING " : "CLEAN   ";
  const dist = (s.length / 1609.34).toFixed(1);
  const dur  = (s.duration / 3600).toFixed(2);
  console.log(`${tag} ${t.label.padEnd(42)} ${dist} mi  ${dur} h  notices=${JSON.stringify(sevs)}`);
}
