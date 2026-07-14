#!/usr/bin/env node
// One-off Samsara schema probe for Driver Performance (docs/16 step B0). Read-only GETs. Safe to delete.
import { readFileSync, writeFileSync } from "node:fs";

function loadEnv() {
  let token = process.env.SAMSARA_API_TOKEN;
  let base = process.env.SAMSARA_API_URL;
  try {
    const txt = readFileSync(new URL("./apps/api/.env", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "SAMSARA_API_TOKEN" && !token) token = val;
      if (m[1] === "SAMSARA_API_URL" && !base) base = val;
    }
  } catch {}
  return { token, base: base || "https://api.samsara.com" };
}
const { token, base } = loadEnv();
if (!token) { console.error("No SAMSARA_API_TOKEN found."); process.exit(1); }

const floorHour = (ms) => new Date(Math.floor(ms / 3600000) * 3600000).toISOString();
const now = Date.now();
const endTime = floorHour(now - 4 * 3600000);
const startTime = floorHour(now - 30 * 86400000);
const redact = (v) => {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = /name|email|phone/i.test(k) && typeof val === "string" ? "REDACTED" : redact(val);
    return o;
  }
  return v;
};
async function probe(path, params) {
  const url = new URL(path, base);
  for (const [k, val] of Object.entries(params || {})) url.searchParams.set(k, val);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, ok: res.ok, body };
  } catch (e) { return { status: 0, ok: false, error: String(e) }; }
}

const report = { window: { startTime, endTime } };
const summary = [];

{
  const r = await probe("/safety-scores/drivers", { startTime, endTime });
  const rec = r.body?.data?.[0];
  report.safety = { status: r.status, ok: r.ok, count: r.body?.data?.length ?? null, sampleKeys: rec ? Object.keys(rec) : null };
  summary.push(`safety-scores      HTTP ${r.status} ${r.ok ? "OK" : "FAIL"}  n=${r.body?.data?.length ?? "-"}`);
}
{
  const r = await probe("/driver-efficiency/drivers", { startTime, endTime, dataFormats: "score,raw" });
  const data = Array.isArray(r.body?.data) ? r.body.data : [];
  const withScoreData = data.filter((d) => d && d.scoreData);
  const nonEmptyId = data.filter((d) => d && d.driverId && d.driverId !== "0");
  const withOverall = withScoreData.filter((d) => d.scoreData.overallScore != null && String(d.scoreData.overallScore) !== "");
  const firstWith = withScoreData.find((d) => d.scoreData && Object.keys(d.scoreData).length) ?? withScoreData[0] ?? null;
  const overallSamples = withOverall.slice(0, 10).map((d) => d.scoreData.overallScore);
  const anyLetter = overallSamples.some((v) => !Number.isFinite(Number(v)));
  report.efficiency = {
    status: r.status, ok: r.ok, count: data.length,
    recordsWithNonZeroDriverId: nonEmptyId.length,
    recordsWithScoreData: withScoreData.length,
    recordsWithOverallScore: withOverall.length,
    firstRecordKeys: data[0] ? Object.keys(data[0]) : null,
    firstWithScoreDataKeys: firstWith ? Object.keys(firstWith) : null,
    scoreDataKeys: firstWith?.scoreData ? Object.keys(firstWith.scoreData) : null,
    rawDataKeys: firstWith?.rawData ? Object.keys(firstWith.rawData) : null,
    overallScoreSamples: overallSamples,
    overallScoreType: overallSamples.length ? (anyLetter ? "letter" : "numeric-string") : null,
    pagination: r.body?.pagination ?? null,
    sampleWithData: redact(firstWith),
  };
  summary.push(`driver-efficiency  HTTP ${r.status} ${r.ok ? "OK" : "FAIL"}  n=${data.length}  nonZeroId=${nonEmptyId.length}  withScoreData=${withScoreData.length}  withOverall=${withOverall.length}`);
  summary.push(`  overallScore type=${report.efficiency.overallScoreType ?? "-"}  samples=${JSON.stringify(overallSamples)}`);
  summary.push(`  scoreDataKeys=${JSON.stringify(report.efficiency.scoreDataKeys)}`);
}

writeFileSync(new URL("./samsara-probe-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log("\n=== Samsara Driver-Performance probe (v2) ===");
console.log("window:", startTime, "->", endTime);
for (const s of summary) console.log("  " + s);
console.log("\nFull redacted report -> samsara-probe-report.json\n");
