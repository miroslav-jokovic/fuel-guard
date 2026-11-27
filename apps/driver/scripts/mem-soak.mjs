#!/usr/bin/env node
// Memory soak for the driver app on a USB-connected Android device (DRIVER-APP-ENTERPRISE-PLAN S2.3).
//
// WHY: on 2026-11-25 the scan screen held ~1 GB PSS on the Galaxy Tab A9 (3.7 GB RAM) and swap grew
// ~50 MB in 4 minutes — on a cheap tablet the low-memory killer ends a scan mid-page. A fix is a fix
// only when this number says so, so the pass bar is measured, not judged: over the run, no
// low-memory kill of the app, and TOTAL PSS at the end within +5 % of the reading at minute 2.
//
// Usage: node scripts/mem-soak.mjs [--minutes 10] [--every 15] [--package com.silvicom.fuelguard.driver]
// Open the screen under test first; the script only reads (dumpsys meminfo, logcat events).
import { execFileSync } from "node:child_process";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const PKG = arg("package", "com.silvicom.fuelguard.driver");
const MINUTES = Number(arg("minutes", "10"));
const EVERY = Number(arg("every", "15"));
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

function sample() {
  const out = adb("shell", "dumpsys", "meminfo", PKG);
  const kb = (label) => {
    const m = out.match(new RegExp(`^\\s*${label}\\s+(\\d+)`, "m"));
    return m ? Number(m[1]) : null;
  };
  const total = out.match(/TOTAL PSS:\s+(\d+)/) ?? out.match(/^\s*TOTAL\s+(\d+)/m);
  const swap = out.match(/TOTAL SWAP PSS:\s+(\d+)/);
  return { pss: total ? Number(total[1]) : null, nativeHeap: kb("Native Heap"), swap: swap ? Number(swap[1]) : null };
}

adb("logcat", "-b", "events", "-c");
const start = Date.now();
const rows = [];
const mb = (k) => (k == null ? "   ?" : (k / 1024).toFixed(0).padStart(5));
console.log("  t(s)   PSS MB  native MB  swap MB");
while (Date.now() - start < MINUTES * 60_000) {
  const t = Math.round((Date.now() - start) / 1000);
  const s = sample();
  rows.push({ t, ...s });
  console.log(`${String(t).padStart(6)}  ${mb(s.pss)}    ${mb(s.nativeHeap)}    ${mb(s.swap)}`);
  await new Promise((r) => setTimeout(r, EVERY * 1000));
}

const kills = adb("logcat", "-b", "events", "-d")
  .split("\n")
  .filter((l) => /am_kill|am_low_memory|lowmemorykiller/i.test(l) && l.includes(PKG));
const at2 = rows.find((r) => r.t >= 120) ?? rows[0];
const end = rows[rows.length - 1];
const growth = at2?.pss && end?.pss ? (end.pss - at2.pss) / at2.pss : null;
console.log(`\nPSS at minute 2: ${mb(at2?.pss)} MB · at end: ${mb(end?.pss)} MB · growth ${growth == null ? "?" : (growth * 100).toFixed(1) + " %"}`);
console.log(`low-memory kills of ${PKG}: ${kills.length}`);
const pass = kills.length === 0 && growth != null && growth <= 0.05;
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(pass ? 0 : 1);
