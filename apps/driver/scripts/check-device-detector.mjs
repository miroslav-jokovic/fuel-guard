#!/usr/bin/env node
// On-device check of the live-edge corner model (LIVE-EDGE-DETECTION-PLAN §8 "Open check", 2026-11-27).
//
// WHY: the model was converted and verified against ONNX with the PYTHON runtime (ai-edge-litert 2.4.0),
// but Android ships LiteRT 1.4.2. This runs the SHIPPED path on a USB-connected Android debug build —
// JPEG → RGBA → DocAlignerDecode.input → LiteRT 1.4.2 → decode — on the fixture's five SmartDoc frames,
// and holds the corners to the ONNX answers in packages/capture-engine/fixtures/edges/docaligner-decode.json
// (the 640 × 360 decode, SmartDoc's own aspect). Tolerance 1 px at 640 × 360 (≈ 3 px on the 1920 × 1080
// frame): JPEG decoders differ by a pixel value here and there, which moves a heatmap peak by far less.
//
// Needs: the debug app running with Metro (`npx expo start --dev-client`, adb reverse), and the frames in
// ~/.cache/silvicom-datasets/smartdoc15/frames (tools/edges/README.md).
// Usage: node scripts/check-device-detector.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const PKG = "com.silvicom.fuelguard.driver";
const FRAMES = join(homedir(), ".cache/silvicom-datasets/smartdoc15/frames");
const FIXTURE = new URL("../../../packages/capture-engine/fixtures/edges/docaligner-decode.json", import.meta.url);
const TOLERANCE_PX = 1;
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const cases = fixture.real.map((r) => {
  const exp = r.expected.find((e) => e.W === 640 && e.H === 360);
  if (!exp) throw new Error(`${r.name}: no 640x360 answer in the fixture`);
  return { name: r.name, file: r.name.replaceAll("/", "__"), quad: exp.quad };
});

// Into the app's PRIVATE files folder through `run-as` (debuggable builds only): a file adb pushes into
// /sdcard/Android/data/<pkg>/ belongs to the shell user, and scoped storage keeps the app from reading it.
const dir = `/data/data/${PKG}/files/detector-check`;
adb("shell", "run-as", PKG, "mkdir", "-p", "files/detector-check");
for (const c of cases) {
  adb("push", join(FRAMES, c.name), `/data/local/tmp/${c.file}`);
  adb("shell", "run-as", PKG, "cp", `/data/local/tmp/${c.file}`, `files/detector-check/${c.file}`);
  adb("shell", "rm", `/data/local/tmp/${c.file}`);
}

adb("logcat", "-c");
const url = `fuelguard://detector-check?dir=${encodeURIComponent(dir)}&files=${encodeURIComponent(cases.map((c) => c.file).join(","))}`;
adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url}'`);

let lines = [];
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const log = adb("logcat", "-d", "-s", "ReactNativeJS:*");
  if (log.includes("DETECTOR_CHECK_DONE")) {
    lines = log.split("\n").filter((l) => l.includes("DETECTOR_CHECK {"));
    break;
  }
}
if (lines.length === 0) {
  console.error("no DETECTOR_CHECK output within 60 s — is the debug app running with Metro?");
  process.exit(2);
}
const results = new Map(
  lines.map((l) => {
    const r = JSON.parse(l.slice(l.indexOf("DETECTOR_CHECK ") + "DETECTOR_CHECK ".length));
    return [r.name, r];
  }),
);

let worst = 0;
let ok = true;
for (const c of cases) {
  const r = results.get(c.file);
  if (!r || r.error || !r.corners) {
    ok = false;
    console.log(`FAIL  ${c.name}: ${r?.error ?? "no corners"}`);
    continue;
  }
  const sx = 640 / r.width;
  const sy = 360 / r.height;
  const d = r.corners.map(([x, y], i) => Math.hypot(x * sx - c.quad[i].x, y * sy - c.quad[i].y));
  const max = Math.max(...d);
  worst = Math.max(worst, max);
  const pass = max <= TOLERANCE_PX;
  ok &&= pass;
  console.log(`${pass ? "PASS" : "FAIL"}  ${basename(c.name)}  max corner difference ${max.toFixed(3)} px at 640×360  (confidence ${r.confidence?.toFixed(3)})`);
}
console.log(`\nworst ${worst.toFixed(3)} px, tolerance ${TOLERANCE_PX} px`);
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
