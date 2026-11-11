// Ask HERE Browse (Geocoding & Search, billed per request) for truck places near three cities, printing
// JSON for vector-poi-match.mjs (D-DR31 handoff).
//   node --env-file=.env ../../docs/plans/livemap/tools/here-browse-truck-places.mjs > places.json
const k = process.env.HERE_API_KEY; const out = [];
for (const [cat, at] of [["700-7900-0132", "41.52,-88.08"], ["700-7900-0132", "39.80,-86.15"], ["700-7900-0132", "32.78,-96.80"], ["700-7900-0131", "41.52,-88.08"], ["700-7850-0126", "41.52,-88.08"]]) {
  const r = await (await fetch(`https://browse.search.hereapi.com/v1/browse?at=${at}&categories=${cat}&limit=8&apiKey=${k}`)).json();
  for (const i of r.items ?? []) out.push({ browseCat: cat, name: i.title, lat: i.position.lat, lng: i.position.lng });
}
console.log(JSON.stringify(out));
